// PER_ASSOCIATION answers each image as it arrives and makes the message when the association
// ends. Until that message is stored, the list of what was answered is kept beside the images, so
// an abort, a crash or a failed store loses none of them (#410, D-352).

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isPlainObject } from '@galvanigraph/core-util';
import { isMissing, resolveWithinRoots, type FileRoots } from '../file/file-roots.js';
import { errorInfo, type ConnectorLogger } from '../logger.js';
import { makeDirectory, syncDirectory, syncFile } from './durable-file.js';

const PENDING_DIR = '.galvanigraph-pending';
const EXTENSION = '.jsonl';

/**
 * Lists a listener in this process is receiving or dispatching, by path. Process-wide because a
 * redeployed channel's listener starts while the old one may still be dispatching.
 */
const inHand = new Set<string>();

export interface PendingAssociation {
  readonly associationId: string;
  readonly callingAE: string;
  readonly calledAE: string;
  readonly files: readonly string[];
}

interface PendingLine {
  readonly file: string;
  readonly callingAE: string;
  readonly calledAE: string;
}

/** A line of a list, or null: one whose write was cut short was never answered. */
function parseLine(line: string): PendingLine | null {
  try {
    const value: unknown = JSON.parse(line);
    if (!isPlainObject(value)) return null;
    const { file, callingAE, calledAE } = value;
    if (typeof file !== 'string' || typeof callingAE !== 'string' || typeof calledAE !== 'string') return null;
    // Images are directly in the storage directory, and the post-action deletes what a list names.
    return file !== '' && file !== '.' && file !== '..' && path.basename(file) === file ? { file, callingAE, calledAE } : null;
  } catch {
    return null;
  }
}

export class PendingAssociations {
  /** This listener's lists in hand: the path by association. */
  private readonly held = new Map<string, string>();

  constructor(private readonly options: {
    readonly storageDir: string;
    readonly roots: FileRoots;
    /** Listeners may share a storage directory; each reads only its own channel's lists. */
    readonly channelId: string;
    readonly logger: ConnectorLogger;
  }) {}

  /** Take an association's list in hand, until {@link release}, and make the place for it. */
  async prepare(associationId: string): Promise<string> {
    const list = await this.pathOf(associationId);
    this.hold(associationId, list);
    await makeDirectory(path.dirname(list));
    return list;
  }

  /**
   * An image is on the list, and on disk there, once this resolves. When it rejects it may be on the
   * list all the same, so its file must stay: the name would go to another image.
   */
  async append(list: string, association: Omit<PendingAssociation, 'files'>, filePath: string): Promise<void> {
    const line: PendingLine = { file: path.basename(filePath), callingAE: association.callingAE, calledAE: association.calledAE };
    // The newline comes first, so a line cut short by a full disk does not spoil the next one.
    await fs.appendFile(list, `\n${JSON.stringify(line)}`);
    await syncFile(list);
    await syncDirectory(path.dirname(list));
  }

  /** The associations with a list, the oldest first. */
  async ids(): Promise<string[]> {
    const dir = await this.directory();
    const names = await fs.readdir(dir).catch((err: unknown) => {
      if (isMissing(err)) return [];
      throw err;
    });
    const lists = await Promise.all(names.filter((name) => name.endsWith(EXTENSION)).map(async (name) => ({
      id: name.slice(0, -EXTENSION.length),
      // One removed meanwhile is gone when it is opened.
      mtimeMs: await fs.stat(path.join(dir, name)).then((stat) => stat.mtimeMs, () => 0),
    })));
    return lists.sort((a, b) => a.mtimeMs - b.mtimeMs).map(({ id }) => id);
  }

  /** Take a list in hand and read it. Null when it is in hand already, or gone. */
  async open(associationId: string): Promise<PendingAssociation | null> {
    const list = await this.pathOf(associationId);
    if (inHand.has(list)) return null;
    this.hold(associationId, list);
    try {
      const text = await fs.readFile(list, 'utf8');
      return await this.parse(associationId, text);
    } catch (err) {
      this.release(associationId);
      if (isMissing(err)) return null;
      throw err;
    }
  }

  /** Leave a list for the next sweep, or start, to find. */
  release(associationId: string): void {
    const list = this.held.get(associationId);
    if (list !== undefined) inHand.delete(list);
    this.held.delete(associationId);
  }

  /** True when the list is gone. One that cannot be removed stays in hand, so this run makes no second message of it. */
  async remove(associationId: string): Promise<boolean> {
    const list = this.held.get(associationId);
    if (list === undefined) return true;
    try {
      await fs.rm(list, { force: true, recursive: true, maxRetries: 5 });
      this.release(associationId);
      return true;
    } catch (err) {
      this.options.logger.error(
        { ...errorInfo(err), associationId },
        'The list of a stored DICOM association could not be removed; a restart would make a second message of its images',
      );
      return false;
    }
  }

  private async parse(associationId: string, text: string): Promise<PendingAssociation> {
    const lines = text.split('\n').filter((line) => line !== '').map(parseLine);
    const valid = lines.filter((line) => line !== null);
    const dir = await resolveWithinRoots(this.options.storageDir, this.options.roots);
    const listed = [...new Set(valid.map(({ file }) => path.join(dir, file)))];
    const found = await Promise.all(listed.map((file) => fs.access(file).then(() => true, (err: unknown) => {
      if (isMissing(err)) return false;
      throw err;
    })));
    const files = listed.filter((_file, i) => found[i]);
    if (lines.length > valid.length || files.length < listed.length) {
      this.options.logger.error(
        { associationId, unreadable: lines.length - valid.length, missing: listed.length - files.length, files: files.length },
        'A DICOM association is recovered without images whose line cannot be read or whose file is gone',
      );
    }
    return { associationId, callingAE: valid[0]?.callingAE ?? '', calledAE: valid[0]?.calledAE ?? '', files };
  }

  private hold(associationId: string, list: string): void {
    inHand.add(list);
    this.held.set(associationId, list);
  }

  private async directory(): Promise<string> {
    return resolveWithinRoots(path.join(this.options.storageDir, PENDING_DIR, this.options.channelId), this.options.roots);
  }

  private async pathOf(associationId: string): Promise<string> {
    return path.join(await this.directory(), `${associationId}${EXTENSION}`);
  }
}
