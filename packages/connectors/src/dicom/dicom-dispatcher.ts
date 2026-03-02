// ===========================================
// DICOM Dispatcher (Destination Connector)
// ===========================================
// Wraps @ubercode/dcmtk DicomSender to send DICOM files via C-STORE.
// Expects message content to be a file path.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';

// ----- Config -----

export interface DicomDispatcherConfig {
  readonly host: string;
  readonly port: number;
  readonly calledAETitle: string;
  readonly callingAETitle: string;
  readonly mode: 'single' | 'multiple';
  readonly maxAssociations: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly timeoutMs: number;
}

// ----- dcmtk abstraction (for testability) -----

/** Result of a successful send operation. */
export interface DcmtkSendResult {
  readonly files: readonly string[];
  readonly fileCount: number;
  readonly durationMs: number;
}

/** Minimal interface for the underlying DICOM sender. */
export interface DcmtkSender {
  send(files: readonly string[]): Promise<Result<DcmtkSendResult>>;
  stop(): Promise<void>;
}

/** Factory that creates a DcmtkSender. */
export type SenderFactory = (options: {
  readonly host: string;
  readonly port: number;
  readonly calledAETitle: string;
  readonly callingAETitle: string;
  readonly mode: 'single' | 'multiple';
  readonly maxAssociations: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly timeoutMs: number;
}) => Result<DcmtkSender>;

// ----- Dispatcher -----

export class DicomDispatcher implements DestinationConnectorRuntime {
  private readonly config: DicomDispatcherConfig;
  private readonly createSender: SenderFactory;
  private sender: DcmtkSender | null = null;
  private started = false;

  constructor(config: DicomDispatcherConfig, createSender?: SenderFactory) {
    this.config = config;
    this.createSender = createSender ?? defaultSenderFactory;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.host) {
        throw new Error('Host is required');
      }
      if (this.config.port < 1 || this.config.port > 65535) {
        throw new Error('Port must be between 1 and 65535');
      }
      if (this.config.calledAETitle.length > 16) {
        throw new Error('Called AE Title must be 16 characters or fewer');
      }
      if (this.config.callingAETitle.length > 16) {
        throw new Error('Calling AE Title must be 16 characters or fewer');
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      const result = this.createSender({
        host: this.config.host,
        port: this.config.port,
        calledAETitle: this.config.calledAETitle,
        callingAETitle: this.config.callingAETitle,
        mode: this.config.mode,
        maxAssociations: this.config.maxAssociations,
        maxRetries: this.config.maxRetries,
        retryDelayMs: this.config.retryDelayMs,
        timeoutMs: this.config.timeoutMs,
      });
      if (!result.ok) {
        throw result.error;
      }
      this.sender = result.value;
      this.started = true;
    });
  }

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      if (!this.started || !this.sender) {
        throw new Error('Dispatcher not started');
      }
      if (signal.aborted) {
        throw new Error('Send aborted');
      }
      if (!message.content.trim()) {
        throw new Error('Message content is empty — expected a DICOM file path');
      }

      const filePath = message.content.trim();
      const sendResult = await this.sender.send([filePath]);
      if (!sendResult.ok) {
        return {
          status: 'ERROR' as const,
          content: '',
          errorMessage: sendResult.error.message,
        };
      }

      return {
        status: 'SENT' as const,
        content: `files=${String(sendResult.value.fileCount)}, durationMs=${String(sendResult.value.durationMs)}`,
      };
    });
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.sender) {
        await this.sender.stop();
      }
      this.started = false;
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (this.sender) {
        await this.sender.stop();
      }
      this.started = false;
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.sender = null;
      this.started = false;
    });
  }
}

// ----- Default factory (uses @ubercode/dcmtk) -----

function defaultSenderFactory(options: {
  readonly host: string;
  readonly port: number;
  readonly calledAETitle: string;
  readonly callingAETitle: string;
  readonly mode: 'single' | 'multiple';
  readonly maxAssociations: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly timeoutMs: number;
}): Result<DcmtkSender> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DicomSender: DcmtkDicomSender } = require('@ubercode/dcmtk') as {
    DicomSender: {
      create(opts: Record<string, unknown>): Result<DcmtkSender>;
    };
  };
  return DcmtkDicomSender.create({
    host: options.host,
    port: options.port,
    calledAETitle: options.calledAETitle,
    callingAETitle: options.callingAETitle,
    mode: options.mode,
    maxAssociations: options.maxAssociations,
    maxRetries: options.maxRetries,
    retryDelayMs: options.retryDelayMs,
    timeoutMs: options.timeoutMs,
  });
}
