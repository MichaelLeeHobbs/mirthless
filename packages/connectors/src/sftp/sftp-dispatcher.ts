// Connects per send so a stale connection is never reused across queue retries.

import { tryCatch, type Result } from '@galvanigraph/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import { createConnectorLogger, type ConnectorLogger } from '../logger.js';
import { withTimeoutSignal } from '../timeout.js';
import { SftpFileWrite } from './sftp-file-write.js';
import { resolveOutputFilename, unknownPlaceholders, unknownPlaceholderMessage } from '../file/file-dispatcher.js';
import { joinRemote } from './sftp-receiver.js';
import {
  createSsh2SftpClient,
  validateAuth,
  type SftpClient,
  type SftpClientFactory,
  type SftpConnectionOptions,
} from './sftp-client.js';

/** The client has no native AbortSignal support. */
const SEND_TIMEOUT_MS = 30_000;

export interface SftpDispatcherConfig extends SftpConnectionOptions {
  readonly remoteDirectory: string;
  readonly fileNameTemplate: string;
  readonly appendMode: boolean;
  /** Write under a temporary name, then rename. An append ignores it. */
  readonly tempFileEnabled: boolean;
}

export class SftpDispatcher implements DestinationConnectorRuntime {
  private readonly config: SftpDispatcherConfig;
  private readonly createClient: SftpClientFactory;
  private readonly logger: ConnectorLogger;
  private started = false;

  constructor(config: SftpDispatcherConfig, createClient?: SftpClientFactory, logger?: ConnectorLogger) {
    this.config = config;
    this.logger = logger ?? createConnectorLogger('SFTP');
    this.createClient = createClient ?? createSsh2SftpClient;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.host) throw new Error('Host is required');
      if (this.config.port < 1 || this.config.port > 65535) {
        throw new Error('Port must be between 1 and 65535');
      }
      if (!this.config.username) throw new Error('Username is required');
      const authError = validateAuth(this.config);
      if (authError) throw new Error(authError);
      if (!this.config.remoteDirectory) throw new Error('Remote directory is required');
      if (!this.config.fileNameTemplate) throw new Error('File name template is required');
      const unknown = unknownPlaceholders(this.config.fileNameTemplate);
      if (unknown.length > 0) throw new Error(unknownPlaceholderMessage(unknown));
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = true;
    });
  }

  variablesUsed(): readonly string[] {
    return [];
  }

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      if (!this.started) throw new Error('Dispatcher not started');
      if (signal.aborted) throw new Error('Send aborted');

      const filename = resolveOutputFilename(this.config.fileNameTemplate, {
        messageId: String(message.messageId),
        timestamp: String(Date.now()),
      });
      const remotePath = joinRemote(this.config.remoteDirectory, filename);

      const client = this.createClient(this.config);
      try {
        await this.write(client, remotePath, message.content, signal);
        return { status: 'SENT' as const, content: remotePath };
      } finally {
        await this.safeEnd(client);
      }
    });
  }

  private async write(client: SftpClient, remotePath: string, content: string, signal: AbortSignal): Promise<void> {
    const { remoteDirectory, appendMode, tempFileEnabled } = this.config;
    const write = new SftpFileWrite(client, { directory: remoteDirectory, path: remotePath, appendMode, tempFileEnabled });
    const done = write.run(Buffer.from(content, 'utf8'));
    try {
      const left = await withTimeoutSignal(done, SEND_TIMEOUT_MS, 'SFTP send', signal);
      if (left !== null) this.logger.warn({ file: left }, 'SFTP file replaced, but the old one could not be removed from under its temporary name');
    } catch (err) {
      const failure = await write.giveUp(done, err);
      if (failure !== null) throw failure;
    }
  }

  private async safeEnd(client: SftpClient): Promise<void> {
    try {
      await client.end();
    } catch {
      // Best-effort teardown; the send result already reflects success/failure.
    }
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }
}
