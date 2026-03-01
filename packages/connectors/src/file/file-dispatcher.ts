// ===========================================
// File Dispatcher (Destination Connector)
// ===========================================
// Writes message content to files on disk.
// Supports output filename patterns, temp-file-then-rename,
// and append mode.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tryCatch, type Result } from '@mirthless/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';

// ----- Config -----

export interface FileDispatcherConfig {
  readonly directory: string;
  readonly outputPattern: string;
  readonly charset: BufferEncoding;
  readonly binary: boolean;
  readonly tempFileEnabled: boolean;
  readonly appendMode: boolean;
}

// ----- Pattern Substitution -----

/**
 * Resolve an output filename by substituting placeholders
 * in the pattern with values from the message context.
 */
export function resolveOutputFilename(
  pattern: string,
  context: Readonly<Record<string, string>>,
): string {
  let result = pattern;
  for (const [key, value] of Object.entries(context)) {
    result = result.split('${' + key + '}').join(value);
  }
  return result;
}

// ----- Dispatcher -----

export class FileDispatcher implements DestinationConnectorRuntime {
  private readonly config: FileDispatcherConfig;
  private started = false;

  constructor(config: FileDispatcherConfig) {
    this.config = config;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.directory) {
        throw new Error('Directory is required');
      }
      if (!this.config.outputPattern) {
        throw new Error('Output pattern is required');
      }
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = true;
    });
  }

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      if (!this.started) {
        throw new Error('Dispatcher not started');
      }
      if (signal.aborted) {
        throw new Error('Send aborted');
      }

      // Ensure output directory exists
      await fs.mkdir(this.config.directory, { recursive: true });

      const context: Record<string, string> = {
        messageId: String(message.messageId),
        timestamp: String(Date.now()),
        originalFilename: 'message',
      };

      const filename = resolveOutputFilename(this.config.outputPattern, context);
      const outputPath = path.join(this.config.directory, filename);

      if (this.config.appendMode) {
        await this.appendToFile(outputPath, message.content);
      } else if (this.config.tempFileEnabled) {
        await this.writeViaTempFile(outputPath, message.content);
      } else {
        await this.writeFile(outputPath, message.content);
      }

      return { status: 'SENT' as const, content: outputPath };
    });
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

  /** Write content to a temp file, then rename to final path. */
  private async writeViaTempFile(outputPath: string, content: string): Promise<void> {
    const tmpPath = outputPath + '.tmp';
    await this.writeFile(tmpPath, content);
    await fs.rename(tmpPath, outputPath);
  }

  /** Append content to a file. */
  private async appendToFile(outputPath: string, content: string): Promise<void> {
    const data = this.config.binary
      ? Buffer.from(content, 'base64')
      : content;
    await fs.appendFile(outputPath, data, this.config.binary ? undefined : { encoding: this.config.charset });
  }

  /** Write content directly to a file. */
  private async writeFile(outputPath: string, content: string): Promise<void> {
    const data = this.config.binary
      ? Buffer.from(content, 'base64')
      : content;
    await fs.writeFile(outputPath, data, this.config.binary ? undefined : { encoding: this.config.charset });
  }
}
