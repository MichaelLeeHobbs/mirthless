import * as path from 'node:path';
import { tempFileName } from '../temp-file.js';
import { withTimeout } from '../timeout.js';
import type { SftpClient } from './sftp-client.js';

export interface SftpFileTarget {
  /** Created if missing. */
  readonly directory: string;
  readonly path: string;
  readonly appendMode: boolean;
  readonly tempFileEnabled: boolean;
}

/** How long a send that is given up waits for a rename under way, and for the temporary file to go. */
const WIND_UP_MS = 2_000;

const NO_SUCH_FILE = 2;
/** What servers answer a rename onto a name that is taken: OpenSSH FAILURE, others FILE_ALREADY_EXISTS. */
const NAME_TAKEN: readonly unknown[] = [4, 11];

/** The SFTP status of an error the server answered; undefined for any other, such as a lost connection. */
function statusOf(err: unknown): number | undefined {
  return err instanceof Error && 'code' in err && typeof err.code === 'number' ? err.code : undefined;
}

/** One message written as one remote file, and what the server may hold of it when that fails. */
export class SftpFileWrite {
  private givenUp = false;
  /** The file put() or append() has open: it may hold part of the message. */
  private partial: string | null = null;
  private temp: string | null = null;
  private renaming = false;
  private renameRefused = false;
  /** The old file is gone and the new one not in place yet. */
  private tempIsOnlyCopy = false;

  constructor(private readonly client: SftpClient, private readonly target: SftpFileTarget) {}

  async run(data: Buffer): Promise<void> {
    const { client, target } = this;
    await client.connect();
    this.stopIfGivenUp();
    await client.mkdir(target.directory);
    this.stopIfGivenUp();
    if (target.appendMode) {
      await client.append(data, target.path, () => { this.partial = target.path; });
    } else if (target.tempFileEnabled) {
      await this.writeThroughTemp(data);
    } else {
      await client.put(data, target.path, () => { this.partial = target.path; });
    }
  }

  /** The error to report, or null when a rename under way put the file in place after all. */
  async giveUp(done: Promise<void>, cause: unknown): Promise<Error | null> {
    this.givenUp = true;
    if (this.renaming && await this.endsWell(done)) return null;
    const left = [...this.filesLeft(), ...await this.removeTemp()];
    const message = cause instanceof Error ? cause.message : String(cause);
    return new Error([message, ...left].join('; '), { cause });
  }

  private stopIfGivenUp(): void {
    if (!this.givenUp) return;
    this.renaming = false;
    throw new Error('SFTP send given up');
  }

  private async writeThroughTemp(data: Buffer): Promise<void> {
    const temp = path.posix.join(path.posix.dirname(this.target.path), tempFileName());
    this.temp = temp;
    await this.client.put(data, temp);
    this.stopIfGivenUp();
    this.renaming = true;
    try {
      await this.putInPlace(temp);
      this.temp = null;
    } catch (err) {
      this.renameRefused = statusOf(err) !== undefined;
      throw err;
    }
  }

  private async putInPlace(temp: string): Promise<void> {
    const { client, target } = this;
    if (await client.replace(temp, target.path)) return;
    try {
      await client.rename(temp, target.path);
      return;
    } catch (err) {
      if (!NAME_TAKEN.includes(statusOf(err)) || !await this.bothThere(temp)) throw err;
    }
    this.stopIfGivenUp();
    // No rename that replaces on this server, so for a moment there is no file of this name.
    this.tempIsOnlyCopy = true;
    await this.deleteOld();
    await client.rename(temp, target.path);
    this.tempIsOnlyCopy = false;
  }

  private async deleteOld(): Promise<void> {
    try {
      await this.client.delete(this.target.path);
    } catch (err) {
      this.tempIsOnlyCopy = statusOf(err) === undefined;
      throw err;
    }
  }

  private async bothThere(temp: string): Promise<boolean> {
    return await this.client.pathKind(this.target.path) === 'file' && await this.client.pathKind(temp) === 'file';
  }

  private async endsWell(done: Promise<void>): Promise<boolean> {
    try {
      await withTimeout(done, WIND_UP_MS, 'SFTP rename');
      return true;
    } catch {
      return false;
    }
  }

  private filesLeft(): readonly string[] {
    const { target, temp } = this;
    if (this.partial !== null) return [`${this.partial} may hold part of this message`];
    if (this.tempIsOnlyCopy) return [`${target.path} may have been removed to be replaced, and ${temp ?? ''} holds this message`];
    if (this.renameRefused) return ['the server refused to put the temporary file in place: turn tempFileEnabled off if it allows no renames or deletes'];
    if (this.renaming) return [`${target.path} may hold this message`];
    return [];
  }

  private async removeTemp(): Promise<readonly string[]> {
    const { temp } = this;
    if (temp === null || this.tempIsOnlyCopy) return [];
    try {
      await withTimeout(this.client.delete(temp), WIND_UP_MS, 'SFTP delete');
      return [];
    } catch (err) {
      return statusOf(err) === NO_SUCH_FILE ? [] : [`the temporary file ${temp} may be left on the server`];
    }
  }
}
