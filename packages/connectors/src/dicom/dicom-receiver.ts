// ===========================================
// DICOM Receiver (Source Connector)
// ===========================================
// Wraps @ubercode/dcmtk DicomReceiver to receive DICOM C-STORE
// associations and dispatch each file as a message into the pipeline.
// Content = file path; metadata goes into sourceMap.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tryCatch, type Result } from '@mirthless/core-util';
import type { SourceConnectorRuntime, MessageDispatcher, RawMessage } from '../base.js';

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
  readonly minPoolSize: number;
  readonly maxPoolSize: number;
  readonly connectionTimeoutMs: number;
  readonly dispatchMode: DicomDispatchMode;
  readonly postAction: DicomPostAction;
  readonly moveToDirectory: string;
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
  readonly minPoolSize: number;
  readonly maxPoolSize: number;
  readonly connectionTimeoutMs: number;
}) => Result<DcmtkReceiver>;

// ----- Receiver -----

export { DICOM_POST_ACTION, DICOM_DISPATCH_MODE };
export type { DicomPostAction, DicomDispatchMode };

export class DicomReceiver implements SourceConnectorRuntime {
  private readonly config: DicomReceiverConfig;
  private readonly createReceiver: ReceiverFactory;
  private dispatcher: MessageDispatcher | null = null;
  private receiver: DcmtkReceiver | null = null;

  constructor(config: DicomReceiverConfig, createReceiver?: ReceiverFactory) {
    this.config = config;
    this.createReceiver = createReceiver ?? defaultReceiverFactory;
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
      if (this.config.minPoolSize < 1) {
        throw new Error('Min pool size must be at least 1');
      }
      if (this.config.maxPoolSize < this.config.minPoolSize) {
        throw new Error('Max pool size must be >= min pool size');
      }
      if (this.config.postAction === DICOM_POST_ACTION.MOVE && !this.config.moveToDirectory) {
        throw new Error('Move-to directory is required when postAction is MOVE');
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
        minPoolSize: this.config.minPoolSize,
        maxPoolSize: this.config.maxPoolSize,
        connectionTimeoutMs: this.config.connectionTimeoutMs,
      });
      if (!result.ok) {
        throw result.error;
      }

      this.receiver = result.value;

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
    if (result.ok) {
      await this.applyPostAction(data.filePath);
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
    if (result.ok) {
      const postActions: Promise<void>[] = [];
      for (let i = 0; i < data.files.length; i++) {
        const filePath = data.files[i];
        if (filePath) {
          postActions.push(this.applyPostAction(filePath));
        }
      }
      await Promise.allSettled(postActions);
    }
  }

  private async applyPostAction(filePath: string): Promise<void> {
    switch (this.config.postAction) {
      case DICOM_POST_ACTION.DELETE:
        await fs.unlink(filePath).catch(() => { /* best-effort */ });
        break;
      case DICOM_POST_ACTION.MOVE:
        await fs.mkdir(this.config.moveToDirectory, { recursive: true }).catch(() => { /* best-effort */ });
        await fs.rename(filePath, path.join(this.config.moveToDirectory, path.basename(filePath))).catch(() => { /* best-effort */ });
        break;
      case DICOM_POST_ACTION.NONE:
        break;
    }
  }
}

// ----- Default factory (uses @ubercode/dcmtk) -----

function defaultReceiverFactory(options: {
  readonly port: number;
  readonly storageDir: string;
  readonly aeTitle: string;
  readonly minPoolSize: number;
  readonly maxPoolSize: number;
  readonly connectionTimeoutMs: number;
}): Result<DcmtkReceiver> {
  // Dynamic import-style require to avoid bundling issues
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DicomReceiver: DcmtkDicomReceiver } = require('@ubercode/dcmtk') as {
    DicomReceiver: {
      create(opts: Record<string, unknown>): Result<DcmtkReceiver>;
    };
  };
  return DcmtkDicomReceiver.create({
    port: options.port,
    storageDir: options.storageDir,
    aeTitle: options.aeTitle,
    minPoolSize: options.minPoolSize,
    maxPoolSize: options.maxPoolSize,
    connectionTimeoutMs: options.connectionTimeoutMs,
  });
}
