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

interface SetAside {
  readonly temp: string;
  readonly aside: string;
}

/** One message written as one remote file, and what the server may hold of it when that fails. */
export class SftpFileWrite {
  private givenUp = false;
  /** Opened, or perhaps opened, under its final name: it may hold part of the message. */
  private partial: string | null = null;
  private temp: string | null = null;
  private renaming = false;
  /** The server answered that it takes no temporary file, or does not rename it. */
  private tempRefused = false;
  /** The old file may be under another name, and the new one not in place yet. */
  private setAside: SetAside | null = null;
  /** The old file, when it could not be removed after the new one took its place. */
  private oldFileLeft: string | null = null;

  constructor(private readonly client: SftpClient, private readonly target: SftpFileTarget) {}

  /** Once it ends well, the old file under its temporary name if it could not be removed. */
  async run(data: Buffer): Promise<string | null> {
    const { client, target } = this;
    await client.connect();
    this.stopIfGivenUp();
    await client.mkdir(target.directory);
    this.stopIfGivenUp();
    if (target.appendMode) {
      await this.writeInPlace((onOpen) => client.append(data, target.path, onOpen));
    } else if (target.tempFileEnabled) {
      await this.writeThroughTemp(data);
    } else {
      await this.writeInPlace((onOpen) => client.put(data, target.path, onOpen));
    }
    return this.oldFileLeft;
  }

  /** The error to report, or null when a rename under way put the file in place after all. */
  async giveUp(done: Promise<unknown>, cause: unknown): Promise<Error | null> {
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

  private async writeInPlace(write: (onOpen: () => void) => Promise<void>): Promise<void> {
    this.partial = this.target.path;
    const refused = await this.refusedToOpen(write);
    if (refused === null) return;
    this.partial = null;
    throw refused;
  }

  private async writeThroughTemp(data: Buffer): Promise<void> {
    const temp = this.tempPath();
    this.temp = temp;
    const refused = await this.refusedToOpen((onOpen) => this.client.put(data, temp, onOpen));
    if (refused !== null) {
      this.tempRefused = true;
      throw refused;
    }
    this.stopIfGivenUp();
    this.renaming = true;
    try {
      await this.putInPlace(temp);
      this.temp = null;
    } catch (err) {
      this.tempRefused = statusOf(err) !== undefined;
      throw err;
    }
  }

  /** The error when the server answered that it does not open the file, so nothing is in it. Rejects with any other. */
  private async refusedToOpen(write: (onOpen: () => void) => Promise<void>): Promise<unknown> {
    let open = false;
    try {
      await write(() => { open = true; });
      return null;
    } catch (err) {
      if (open || statusOf(err) === undefined) throw err;
      return err;
    }
  }

  private tempPath(): string {
    return path.posix.join(path.posix.dirname(this.target.path), tempFileName());
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
    await this.swap(temp);
  }

  private async bothThere(temp: string): Promise<boolean> {
    return await this.client.pathKind(this.target.path) === 'file' && await this.client.pathKind(temp) === 'file';
  }

  /**
   * For a server with no rename that replaces: for a moment there is no file of this name.
   * The old file is kept until the new one is in place, since a server that answers every
   * rename with the same status allows none.
   */
  private async swap(temp: string): Promise<void> {
    const { client, target } = this;
    const aside = this.tempPath();
    this.setAside = { temp, aside };
    await this.moveAside(aside);
    try {
      await client.rename(temp, target.path);
    } catch (err) {
      await this.moveBack(aside);
      throw err;
    }
    this.setAside = null;
    try {
      await client.delete(aside);
    } catch {
      this.oldFileLeft = aside;
    }
  }

  private async moveAside(aside: string): Promise<void> {
    try {
      await this.client.rename(this.target.path, aside);
    } catch (err) {
      if (statusOf(err) !== undefined) this.setAside = null;
      throw err;
    }
  }

  private async moveBack(aside: string): Promise<void> {
    try {
      await this.client.rename(aside, this.target.path);
      this.setAside = null;
    } catch {
      // Still set aside: the send's error names where.
    }
  }

  private async endsWell(done: Promise<unknown>): Promise<boolean> {
    try {
      await withTimeout(done, WIND_UP_MS, 'SFTP rename');
      return true;
    } catch {
      return false;
    }
  }

  private filesLeft(): readonly string[] {
    const { target, setAside } = this;
    if (this.partial !== null) return [`${this.partial} may hold part of this message`];
    if (setAside !== null) return [`${target.path} may have been renamed to ${setAside.aside}, and ${setAside.temp} may hold this message`];
    if (this.tempRefused) return ['the server refused the temporary file or its rename: turn tempFileEnabled off if it allows none'];
    if (this.renaming) return [`${target.path} may hold this message`];
    return [];
  }

  private async removeTemp(): Promise<readonly string[]> {
    const { temp } = this;
    if (temp === null || this.setAside !== null) return [];
    try {
      await withTimeout(this.client.delete(temp), WIND_UP_MS, 'SFTP delete');
      return [];
    } catch (err) {
      return statusOf(err) === NO_SUCH_FILE ? [] : [`the temporary file ${temp} may be left on the server`];
    }
  }
}
