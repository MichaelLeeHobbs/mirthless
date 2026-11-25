// ===========================================
// DICOM Receiver (Source Connector)
// ===========================================
// A dcmjs-dimse DICOM SCP that receives C-STORE associations and dispatches each
// received instance as a message into the pipeline.
// Content = file path; metadata goes into sourceMap.
// storageDir and moveToDirectory are limited to FILE_CONNECTOR_ROOTS, as the
// File connector's directories are (D-315, #313).

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tryCatch, type Result } from '@galvanigraph/core-util';
import type { SourceConnectorRuntime, SourceHealthHandler, MessageDispatcher, RawMessage, DispatchResult } from '../base.js';
import { dispatchFailure } from '../base.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
import { isMissing, resolveWithinRoots, type FileRoots } from '../file/file-roots.js';
import { createDimseReceiver, DIMSE_SOURCE } from './dcmjs-dimse-adapter.js';
import { fileHash, resolveImage, withoutPath } from './image-path.js';
import { PendingAssociations, pendingDirectory, type PendingAssociation } from './pending-associations.js';

const DICOM_POST_ACTION = {
  DELETE: 'DELETE',
  MOVE: 'MOVE',
  NONE: 'NONE',
} as const;
type DicomPostAction = typeof DICOM_POST_ACTION[keyof typeof DICOM_POST_ACTION];

const DICOM_DISPATCH_MODE = {
  PER_FILE: 'PER_FILE',
  PER_ASSOCIATION: 'PER_ASSOCIATION',
} as const;
type DicomDispatchMode = typeof DICOM_DISPATCH_MODE[keyof typeof DICOM_DISPATCH_MODE];

export interface DicomReceiverConfig {
  readonly port: number;
  readonly storageDir: string;
  readonly aeTitle: string;
  readonly connectionTimeoutMs: number;
  readonly dispatchMode: DicomDispatchMode;
  readonly postAction: DicomPostAction;
  readonly moveToDirectory: string;
  /** The directories storageDir and moveToDirectory must be in (FILE_CONNECTOR_ROOTS). */
  readonly roots: FileRoots;
  readonly channelId: string;
}

export interface DcmtkFileData {
  readonly filePath: string;
  readonly associationId: string;
  readonly associationDir: string;
  readonly callingAE: string;
  readonly calledAE: string;
  readonly source: string;
  readonly instance: {
    readonly dataset: Readonly<Record<string, unknown>>;
  };
}

export interface DcmtkAssociationData {
  readonly associationId: string;
  readonly associationDir: string;
  readonly callingAE: string;
  readonly calledAE: string;
  readonly source: string;
  readonly files: readonly string[];
  readonly durationMs: number;
  /** False when the sender aborted or hung up instead: there may be images it never sent. */
  readonly released: boolean;
}

export interface DcmtkErrorData {
  readonly error: Error;
  readonly associationId?: string;
  /** The file of the image that was refused. */
  readonly filePath?: string | undefined;
}

export interface DcmtkReceiver {
  /** The sender's answer waits for the listener: stored when it resolves, failed when it rejects. The file is the listener's. */
  onFileReceived(listener: (data: DcmtkFileData) => Promise<void>): void;
  onAssociationComplete(listener: (data: DcmtkAssociationData) => void): void;
  onEvent(event: 'error', listener: (data: DcmtkErrorData) => void): void;
  start(): Promise<Result<void>>;
  /** Answers what it took first, for a bounded time. */
  stop(): Promise<void>;
  /** Cuts off what is open. */
  halt(): Promise<void>;
}

export type ReceiverFactory = (options: {
  readonly port: number;
  readonly storageDir: string;
  readonly aeTitle: string;
  readonly connectionTimeoutMs: number;
  /** Checked before each file is written, as well as at deploy. */
  readonly roots: FileRoots;
}) => Result<DcmtkReceiver>;

/** The file paths in what the receiver dispatched: a JSON list of paths, or one path. */
function filesIn(content: string): string[] {
  const text = content.trim();
  if (!text.startsWith('[')) return [text];
  try {
    const list: unknown = JSON.parse(text);
    return Array.isArray(list) ? list.filter((f): f is string => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

/** How often a listener looks for associations whose message still has to be made. */
const SWEEP_MS = 30_000;

// ----- Receiver -----

export { DICOM_POST_ACTION, DICOM_DISPATCH_MODE };
export type { DicomPostAction, DicomDispatchMode };

export class DicomReceiver implements SourceConnectorRuntime {
  private readonly config: DicomReceiverConfig;
  private readonly createReceiver: ReceiverFactory;
  private readonly logger: ConnectorLogger = createConnectorLogger('DICOM');
  private dispatcher: MessageDispatcher | null = null;
  private health: SourceHealthHandler = () => undefined;
  private receiver: DcmtkReceiver | null = null;
  private readonly pending: PendingAssociations;
  private stopping = false;
  private sweeping = false;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: DicomReceiverConfig, createReceiver?: ReceiverFactory, private readonly sweepMs = SWEEP_MS) {
    this.config = config;
    this.createReceiver = createReceiver ?? createDimseReceiver;
    this.pending = new PendingAssociations({ ...config, logger: this.logger });
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
  }

  setHealthHandler(handler: SourceHealthHandler): void {
    this.health = handler;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.config.port < 1 || this.config.port > 65535) {
        throw new Error('Port must be between 1 and 65535');
      }
      if (!this.config.storageDir) {
        throw new Error('Storage directory is required');
      }
      if (this.config.aeTitle.length > 16) {
        throw new Error('AE Title must be 16 characters or fewer');
      }
      if (this.config.postAction === DICOM_POST_ACTION.MOVE && !this.config.moveToDirectory) {
        throw new Error('Move-to directory is required when postAction is MOVE');
      }
      await resolveWithinRoots(this.config.storageDir, this.config.roots);
      if (this.config.postAction === DICOM_POST_ACTION.MOVE) {
        await resolveWithinRoots(this.config.moveToDirectory, this.config.roots);
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.dispatcher) {
        throw new Error('Dispatcher not set — call setDispatcher before start');
      }

      const result = this.createReceiver({
        port: this.config.port,
        storageDir: this.config.storageDir,
        aeTitle: this.config.aeTitle,
        connectionTimeoutMs: this.config.connectionTimeoutMs,
        roots: this.config.roots,
      });
      if (!result.ok) {
        throw result.error;
      }

      this.receiver = result.value;

      // Subscribe to the receiver's error event. Without a listener a dcmtk
      // emitter error would surface as an uncaughtException and kill the engine.
      this.receiver.onEvent('error', ({ error, associationId, filePath }) => {
        this.logger.error({ ...this.failed(error), associationId, ...(filePath === undefined ? {} : { file: fileHash(filePath) }) }, 'DICOM receiver error');
      });

      this.stopping = false;
      this.receiver.onFileReceived((data) => this.takeFile(data));
      if (this.config.dispatchMode === DICOM_DISPATCH_MODE.PER_ASSOCIATION) {
        this.receiver.onAssociationComplete((data) => {
          this.handleAssociationComplete(data).catch((err: unknown) => {
            this.logger.error({ ...this.failed(err), associationId: data.associationId }, 'DICOM association could not be finished');
          });
        });
      }

      const startResult = await this.receiver.start();
      if (!startResult.ok) {
        throw startResult.error;
      }
      // In either mode: lists may be left from before the mode was changed.
      void this.sweep();
      this.sweepTimer = setInterval(() => { void this.sweep(); }, this.sweepMs);
      this.sweepTimer.unref();
    });
  }

  private withoutImage(err: unknown): Error {
    const { moveToDirectory, roots } = this.config;
    // The storage directory is above the pending one.
    return withoutPath(err, [pendingDirectory(this.config), moveToDirectory, ...roots.allowed, ...roots.denied]);
  }

  /** What a log line says of a failure. */
  private failed(err: unknown): Readonly<Record<string, unknown>> {
    return { ...errorInfo(this.withoutImage(err)), directory: this.config.storageDir };
  }

  private endSweeps(): void {
    this.stopping = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.endSweeps();
      if (this.receiver) {
        await this.receiver.stop();
      }
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.endSweeps();
      if (this.receiver) {
        await this.receiver.halt();
      }
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.endSweeps();
      this.receiver = null;
      this.dispatcher = null;
    });
  }

  /**
   * Take a file the SCP has written. The sender is told "stored" once this resolves, so in PER_FILE
   * it resolves when the message is in the store, and in PER_ASSOCIATION when the file is on the
   * list its message is made from. When it rejects, the sender is told the store failed and keeps
   * the image.
   */
  private async takeFile(data: DcmtkFileData): Promise<void> {
    if (this.config.dispatchMode === DICOM_DISPATCH_MODE.PER_ASSOCIATION) {
      const list = await this.orDiscard(data.filePath, () => this.pending.prepare(data.associationId));
      await this.pending.append(list, data, data.filePath);
      return;
    }
    const raw: RawMessage = {
      content: data.filePath,
      sourceMap: {
        ...data.instance.dataset,
        callingAE: data.callingAE,
        calledAE: data.calledAE,
        associationId: data.associationId,
        source: data.source,
      },
    };
    const dispatched = await this.orDiscard(data.filePath, async () => {
      const { stored, done } = this.dispatch(raw);
      await stored;
      return { done };
    });
    // Not awaited: the destinations can take longer than a sender waits for its answer.
    const context = { associationId: data.associationId, callingAE: data.callingAE, file: fileHash(data.filePath) };
    void dispatched.done.then((result) => this.finish(result, [data.filePath], context));
  }

  /** Nothing has the file if the step fails, and its sender has the image: copies of it would fill the disk during an outage. */
  private async orDiscard<T>(filePath: string, step: () => Promise<T>): Promise<T> {
    try {
      if (this.stopping) throw new Error('The DICOM Listener is stopping');
      return await step();
    } catch (err) {
      await fs.rm(filePath, { force: true });
      throw err;
    }
  }

  private async handleAssociationComplete(data: DcmtkAssociationData): Promise<void> {
    if (data.files.length === 0) {
      // A C-ECHO, or images that were all refused.
      await this.pending.remove(data.associationId);
      return;
    }
    const context = { associationId: data.associationId, callingAE: data.callingAE, fileCount: data.files.length };
    if (!data.released) {
      this.logger.warn(context, 'DICOM association ended without a release; its message has the files stored until then');
    }
    if (this.stopping) {
      // The destinations are being stopped too. The next start makes the message.
      this.pending.release(data.associationId);
      return;
    }
    await this.dispatchAssociation(data, { source: data.source, durationMs: data.durationMs });
  }

  /** False when the pipeline could not store the message, so its files wait for the next sweep. */
  private async dispatchAssociation(association: PendingAssociation, extra: Readonly<Record<string, unknown>>): Promise<boolean> {
    const { associationId, callingAE, calledAE, files } = association;
    const { stored, done } = this.dispatch({
      content: JSON.stringify(files),
      sourceMap: { callingAE, calledAE, associationId, associationDir: this.config.storageDir, fileCount: files.length, ...extra },
    });
    const taken = await tryCatch(async () => {
      if (await stored) return;
      // Until it has run, only the list can make such a message again.
      const result = await done;
      if (!result.ok) throw result.error;
    });
    if (!taken.ok) {
      this.logger.error(
        { ...this.failed(taken.error), associationId, fileCount: files.length },
        'DICOM association could not be stored as a message; it is tried again',
      );
      this.pending.release(associationId);
      return false;
    }
    // Before the post-action, so it takes no file that a list names.
    const removed = await this.pending.remove(associationId);
    const result = await done;
    if (removed) await this.finish(result, files, { associationId, fileCount: files.length });
    return true;
  }

  /** Make the messages of associations whose message was not stored: a crash, a stop, or a store that was down. */
  private async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const ids = await this.pending.ids();
      this.reportHealth(null);
      for (const id of ids) {
        // The store is down: the rest would fail too.
        if (this.stopping || !(await this.recover(id))) return;
      }
    } catch (err) {
      this.logger.error(this.failed(err), 'DICOM associations waiting for their message could not be listed; tried again');
      this.reportHealth(new Error(`Associations waiting for their message could not be listed (${this.withoutImage(err).message})`));
    } finally {
      this.sweeping = false;
    }
  }

  private reportHealth(failure: Error | null): void {
    if (!this.stopping) this.health(failure);
  }

  /** False when the pipeline could not store the message. A list that cannot be read is left and does not hold up the others. */
  private async recover(associationId: string): Promise<boolean> {
    let association: PendingAssociation | null;
    try {
      association = await this.pending.open(associationId);
    } catch (err) {
      this.logger.error({ ...this.failed(err), associationId }, 'A DICOM association waiting for its message could not be read; tried again');
      this.reportHealth(new Error(`An association waiting for its message could not be read (${this.withoutImage(err).message})`));
      return true;
    }
    if (association === null) return true;
    // Checked after the wait: what a stop left to the next start must not be taken here.
    if (this.stopping) this.pending.release(associationId);
    else if (association.files.length === 0) await this.pending.remove(associationId);
    else return this.dispatchAssociation(association, { source: DIMSE_SOURCE });
    return true;
  }

  /**
   * `stored` resolves once the message is in the store, with whether a restart can run it again, and
   * rejects when it was not stored. `done` is the pipeline's result.
   */
  private dispatch(raw: RawMessage): { readonly stored: Promise<boolean>; readonly done: Promise<Result<DispatchResult>> } {
    let onStored: NonNullable<RawMessage['onStored']> = () => undefined;
    const inStore = new Promise<boolean>((resolve) => { onStored = ({ recoverable }): void => { resolve(recoverable); }; });
    const done = tryCatch(async () => {
      if (!this.dispatcher) throw new Error('The channel is not deployed');
      const result = await this.dispatcher({ ...raw, onStored });
      if (!result.ok) throw result.error;
      return result.value;
    });
    const ended = done.then((result) => {
      if (!result.ok) throw result.error;
      return true;
    });
    const stored = Promise.race([inStore, ended]);
    return { stored, done };
  }

  /** The message is in the store, so from here the files are its own: act on them, or leave them for it. */
  private async finish(result: Result<DispatchResult>, files: readonly string[], of: Readonly<Record<string, unknown>>): Promise<void> {
    const context = result.ok ? { ...of, messageId: result.value.messageId } : of;
    const failure = dispatchFailure(result);
    if (failure !== null) {
      this.logger.error({ ...this.failed(failure), ...context }, 'DICOM message failed; its files are kept for reprocessing or manual recovery');
      return;
    }
    if (!this.keepsInput(result, context)) await this.applyPostActions(files, context);
  }

  /**
   * Every destination has delivered a message that waited in a queue: apply
   * the post-action now. `content` is what this source dispatched, a file path
   * (PER_FILE) or a JSON list of them (PER_ASSOCIATION). It is read by its
   * shape, not the current mode, since the mode may have changed since.
   */
  async onMessageDelivered(content: string, messageId: number): Promise<void> {
    const failures = await this.applyPostActions(filesIn(content), { messageId });
    // Thrown so the queue consumer raises an alert, not only a log line.
    if (failures.length > 0) {
      throw new Error(`DICOM post-action failed for ${String(failures.length)} file(s), left in place: ${failures.join('; ')}`);
    }
  }

  /**
   * Whether the stored files must stay although the pipeline accepted the
   * message: a queued destination still reads them when it sends, until
   * onMessageDelivered says the last one has (#243, D-325), or a destination
   * failed under a response mode that answers before destinations.
   */
  private keepsInput(result: Result<DispatchResult>, context: Readonly<Record<string, unknown>>): boolean {
    if (!result.ok) return false;
    if (result.value.destinationFailed === true) {
      this.logger.error(
        { ...context, directory: this.config.storageDir },
        'DICOM message had a destination fail; file retained for reprocessing or manual recovery',
      );
      return true;
    }
    return result.value.queued === true;
  }

  /** Apply the post-action to each file; the failures, each already logged. */
  private async applyPostActions(files: readonly string[], context: Readonly<Record<string, unknown>>): Promise<string[]> {
    const results = await Promise.all(files.filter((f) => f !== '').map((f) => this.applyPostAction(f, context)));
    return results.filter((failure) => failure !== null);
  }

  /**
   * Delete or move one stored file. A file already gone is fine: the pipeline
   * and the queue consumer can both finish a message (D-325). Anything else
   * leaves the file where it is, is logged, and is returned.
   */
  private async applyPostAction(filePath: string, context: Readonly<Record<string, unknown>>): Promise<string | null> {
    const { postAction, moveToDirectory } = this.config;
    if (postAction === DICOM_POST_ACTION.NONE) return null;
    try {
      const file = await this.storedFile(filePath);
      if (postAction === DICOM_POST_ACTION.DELETE) {
        await fs.unlink(file);
        return null;
      }
      const target = await resolveWithinRoots(moveToDirectory, this.config.roots);
      await fs.mkdir(target, { recursive: true });
      await fs.rename(file, path.join(target, path.basename(file)));
      return null;
    } catch (err) {
      if (isMissing(err)) return null;
      const file = fileHash(filePath);
      this.logger.error(
        { ...this.failed(err), ...context, file, postAction, moveToDirectory },
        'DICOM post-action failed; file left in place',
      );
      return `${file} (${this.withoutImage(err).message})`;
    }
  }

  /**
   * The real path of a file this listener stored, or throw when the path is
   * not a file directly in the storage directory. The path comes from the
   * stored message when a queue finishes it, so it is checked, not trusted.
   */
  private async storedFile(filePath: string): Promise<string> {
    const dir = await resolveWithinRoots(this.config.storageDir, this.config.roots);
    const file = await resolveImage(filePath, this.config.roots);
    if (path.dirname(file) !== dir) {
      throw new Error(`DICOM file ${fileHash(filePath)} is not a file in the DICOM storage directory`);
    }
    return file;
  }
}

