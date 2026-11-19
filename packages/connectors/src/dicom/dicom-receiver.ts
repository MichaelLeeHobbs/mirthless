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
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';
import { dispatchFailure } from '../base.js';
import { createConnectorLogger, errorInfo, type ConnectorLogger } from '../logger.js';
import { isMissing, resolveWithinRoots, type FileRoots } from '../file/file-roots.js';
import { createDimseReceiver } from './dcmjs-dimse-adapter.js';

// ----- Constants -----

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

// ----- Config -----

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
}

// ----- dcmtk abstraction (for testability) -----

/** Data emitted by the underlying receiver on FILE_RECEIVED. */
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

/** Data emitted by the underlying receiver on ASSOCIATION_COMPLETE. */
export interface DcmtkAssociationData {
  readonly associationId: string;
  readonly associationDir: string;
  readonly callingAE: string;
  readonly calledAE: string;
  readonly source: string;
  readonly files: readonly string[];
  readonly durationMs: number;
}

/** Minimal interface for the underlying DICOM receiver. */
export interface DcmtkReceiver {
  onFileReceived(listener: (data: DcmtkFileData) => void): void;
  onAssociationComplete(listener: (data: DcmtkAssociationData) => void): void;
  onEvent(event: 'error', listener: (data: { readonly error: Error }) => void): void;
  start(): Promise<Result<void>>;
  stop(): Promise<void>;
}

/** Factory that creates a DcmtkReceiver. */
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

// ----- Receiver -----

export { DICOM_POST_ACTION, DICOM_DISPATCH_MODE };
export type { DicomPostAction, DicomDispatchMode };

export class DicomReceiver implements SourceConnectorRuntime {
  private readonly config: DicomReceiverConfig;
  private readonly createReceiver: ReceiverFactory;
  private readonly logger: ConnectorLogger = createConnectorLogger('DICOM');
  private dispatcher: MessageDispatcher | null = null;
  private receiver: DcmtkReceiver | null = null;

  constructor(config: DicomReceiverConfig, createReceiver?: ReceiverFactory) {
    this.config = config;
    this.createReceiver = createReceiver ?? createDimseReceiver;
  }

  setDispatcher(dispatcher: MessageDispatcher): void {
    this.dispatcher = dispatcher;
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
      this.receiver.onEvent('error', ({ error }) => {
        this.logger.error(errorInfo(error), 'DICOM receiver error');
      });

      if (this.config.dispatchMode === DICOM_DISPATCH_MODE.PER_FILE) {
        this.receiver.onFileReceived((data) => {
          void this.handleFileReceived(data);
        });
      } else {
        this.receiver.onAssociationComplete((data) => {
          void this.handleAssociationComplete(data);
        });
      }

      const startResult = await this.receiver.start();
      if (!startResult.ok) {
        throw startResult.error;
      }
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.receiver) {
        await this.receiver.stop();
      }
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.receiver) {
        await this.receiver.stop();
      }
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.receiver = null;
      this.dispatcher = null;
    });
  }

  // ----- Event handlers -----

  private async handleFileReceived(data: DcmtkFileData): Promise<void> {
    if (!this.dispatcher) return;

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

    const result = await this.dispatcher(raw);
    const failure = dispatchFailure(result);
    if (failure === null) {
      // A queued destination reads the file when it sends, so the file stays
      // until onMessageDelivered says the last one has (#243, D-323).
      if (!(result.ok && result.value.queued === true)) await this.applyPostAction(data.filePath);
    } else {
      // Pipeline rejected the file. This is event-driven (not polled), so the file
      // is never re-dispatched — surface it loudly and leave the file in place
      // (no post-action) for manual recovery instead of losing it silently.
      this.logger.error(
        { ...errorInfo(failure), filePath: data.filePath, callingAE: data.callingAE },
        'DICOM file dispatch failed; file retained for manual recovery',
      );
    }
  }

  private async handleAssociationComplete(data: DcmtkAssociationData): Promise<void> {
    if (!this.dispatcher) return;

    const fileList = JSON.stringify(data.files);
    const raw: RawMessage = {
      content: fileList,
      sourceMap: {
        callingAE: data.callingAE,
        calledAE: data.calledAE,
        associationId: data.associationId,
        associationDir: data.associationDir,
        source: data.source,
        fileCount: data.files.length,
        durationMs: data.durationMs,
      },
    };

    const result = await this.dispatcher(raw);
    const failure = dispatchFailure(result);
    if (failure === null) {
      if (!(result.ok && result.value.queued === true)) await this.applyPostActions(data.files);
    } else {
      this.logger.error(
        { ...errorInfo(failure), associationId: data.associationId, fileCount: data.files.length },
        'DICOM association dispatch failed; files retained for manual recovery',
      );
    }
  }

  /**
   * Every destination has delivered a message that waited in a queue: apply
   * the post-action now. `content` is what this source dispatched, a file path
   * (PER_FILE) or a JSON list of them (PER_ASSOCIATION). It is read by its
   * shape, not the current mode, since the mode may have changed since.
   */
  async onMessageDelivered(content: string): Promise<void> {
    await this.applyPostActions(filesIn(content));
  }

  private async applyPostActions(files: readonly string[]): Promise<void> {
    await Promise.allSettled(files.filter((f) => f !== '').map((f) => this.applyPostAction(f)));
  }

  /**
   * Delete or move one stored file. A file already gone is fine: the pipeline
   * and the queue consumer can both finish a message (D-323). Anything else
   * leaves the file where it is and is logged.
   */
  private async applyPostAction(filePath: string): Promise<void> {
    if (this.config.postAction === DICOM_POST_ACTION.NONE) return;
    try {
      const file = await this.storedFile(filePath);
      if (this.config.postAction === DICOM_POST_ACTION.DELETE) {
        await fs.unlink(file);
        return;
      }
      const target = await resolveWithinRoots(this.config.moveToDirectory, this.config.roots);
      await fs.mkdir(target, { recursive: true });
      await fs.rename(file, path.join(target, path.basename(file)));
    } catch (err) {
      if (isMissing(err)) return;
      this.logger.error(
        { ...errorInfo(err), filePath, postAction: this.config.postAction },
        'DICOM post-action failed; file left in place',
      );
    }
  }

  /**
   * The real path of a file this listener stored, or throw when the path is
   * not a file directly in the storage directory. The path comes from the
   * stored message when a queue finishes it, so it is checked, not trusted.
   */
  private async storedFile(filePath: string): Promise<string> {
    const dir = await resolveWithinRoots(this.config.storageDir, this.config.roots);
    const file = await resolveWithinRoots(filePath, this.config.roots);
    if (path.dirname(file) !== dir) {
      throw new Error(`"${filePath}" is not a file in the DICOM storage directory`);
    }
    return file;
  }
}

