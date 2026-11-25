import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fillPlaceholders, placeholderNames, recordLookup, tryCatch, type Result } from '@galvanigraph/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import { normalizeEncoding, isKnownEncoding, unknownEncodingMessage } from '../encoding.js';
import { createConnectorLogger, type ConnectorLogger } from '../logger.js';
import { resolveWithinRoots, type FileRoots } from './file-roots.js';

export interface FileDispatcherConfig {
  readonly directory: string;
  readonly outputPattern: string;
  readonly charset: BufferEncoding;
  readonly binary: boolean;
  readonly tempFileEnabled: boolean;
  readonly appendMode: boolean;
  /** Where the directory and each written file may be (FILE_CONNECTOR_ROOTS, D-315). */
  readonly roots: FileRoots;
}

/** One pass: an inserted value is never scanned for further placeholders. */
export function resolveOutputFilename(
  pattern: string,
  context: Readonly<Record<string, unknown>>,
): string {
  return fillPlaceholders(pattern, recordLookup(context));
}

export const FILENAME_PLACEHOLDERS: readonly string[] = ['messageId', 'timestamp'];

/** Refused at deploy: left in place, a placeholder would be written into the filename as literal text. */
export function unknownPlaceholders(pattern: string): readonly string[] {
  return placeholderNames(pattern).filter((name) => !FILENAME_PLACEHOLDERS.includes(name));
}

export function unknownPlaceholderMessage(names: readonly string[]): string {
  const bad = names.map((n) => '${' + n + '}').join(', ');
  const good = FILENAME_PLACEHOLDERS.map((n) => '${' + n + '}').join(' and ');
  return `The filename pattern uses ${bad}, which is not available. Use ${good}.`;
}

export class FileDispatcher implements DestinationConnectorRuntime {
  private readonly config: FileDispatcherConfig;
  private readonly logger: ConnectorLogger;
  private started = false;

  constructor(config: FileDispatcherConfig, logger?: ConnectorLogger) {
    this.config = config;
    this.logger = logger ?? createConnectorLogger('FILE');
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.directory) {
        throw new Error('Directory is required');
      }
      if (!this.config.outputPattern) {
        throw new Error('Output pattern is required');
      }
      const unknown = unknownPlaceholders(this.config.outputPattern);
      if (unknown.length > 0) {
        throw new Error(unknownPlaceholderMessage(unknown));
      }
      if (!this.config.binary && !isKnownEncoding(this.config.charset)) {
        throw new Error(unknownEncodingMessage(this.config.charset));
      }
      await resolveWithinRoots(this.config.directory, this.config.roots);
      // Allowed (a "latest result" file is a real use), but said out loud: with
      // the same name for every message, each one replaces the one before it.
      if (!this.config.appendMode && !this.config.outputPattern.includes('${messageId}')) {
        this.logger.warn(
          { directory: this.config.directory, outputPattern: this.config.outputPattern },
          'File name pattern has no ${messageId} and append is off: a message that resolves to an existing file name overwrites it',
        );
      }
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
      if (!this.started) {
        throw new Error('Dispatcher not started');
      }
      if (signal.aborted) {
        throw new Error('Send aborted');
      }

      // Checked on every write, not only at deploy: the directory or the file may
      // have been replaced by a symlink, and the name pattern may hold `..`.
      const directory = await resolveWithinRoots(this.config.directory, this.config.roots);
      await fs.mkdir(directory, { recursive: true });

      const context: Record<string, string> = {
        messageId: String(message.messageId),
        timestamp: String(Date.now()),
      };

      const filename = resolveOutputFilename(this.config.outputPattern, context);
      const outputPath = await resolveWithinRoots(path.join(directory, filename), this.config.roots);

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

  /** Unique temp name per write: two messages resolving to one file name must not share a temp file. */
  private async writeViaTempFile(outputPath: string, content: string): Promise<void> {
    const tmpPath = `${outputPath}.${randomUUID()}.tmp`;
    await this.writeFile(tmpPath, content);
    await fs.rename(tmpPath, outputPath);
  }

  private encodeForWrite(content: string): {
    readonly data: string | Buffer;
    readonly options: { readonly encoding: BufferEncoding } | undefined;
  } {
    if (this.config.binary) {
      return { data: Buffer.from(content, 'base64'), options: undefined };
    }
    return { data: content, options: { encoding: normalizeEncoding(this.config.charset) } };
  }

  private async appendToFile(outputPath: string, content: string): Promise<void> {
    const { data, options } = this.encodeForWrite(content);
    await fs.appendFile(outputPath, data, options);
  }

  private async writeFile(outputPath: string, content: string): Promise<void> {
    const { data, options } = this.encodeForWrite(content);
    await fs.writeFile(outputPath, data, options);
  }
}
