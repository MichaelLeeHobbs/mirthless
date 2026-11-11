// ===========================================
// Attachment Handler
// ===========================================
// Extracts attachments from message content using REGEX, JAVASCRIPT, or NONE modes.
// Runs between preprocessor and source filter in the pipeline.

import * as crypto from 'node:crypto';
import type { Result } from '@galvaniflow/core-util';
import { tryCatch } from '@galvaniflow/core-util';
import type { SandboxExecutor, CompiledScript, ExecutionOptions, ExecutionResult } from '../sandbox/sandbox-executor.js';
import { createSandboxContext } from '../sandbox/sandbox-context.js';

// ----- Constants -----

export const ATTACHMENT_MODE = {
  NONE: 'NONE',
  REGEX: 'REGEX',
  JAVASCRIPT: 'JAVASCRIPT',
} as const;

export type AttachmentMode = (typeof ATTACHMENT_MODE)[keyof typeof ATTACHMENT_MODE];

// ----- Types -----

/** Configuration for attachment extraction. */
export interface AttachmentConfig {
  readonly mode: AttachmentMode;
  readonly pattern?: string;
  readonly mimeType?: string;
  readonly script?: CompiledScript;
}

/** A single extracted attachment. */
export interface ExtractedAttachment {
  readonly id: string;
  readonly mimeType: string;
  readonly content: string;
  readonly size: number;
}

/** Result of attachment extraction. */
export interface AttachmentResult {
  readonly content: string;
  readonly attachments: readonly ExtractedAttachment[];
}

// ----- Handler -----

export class AttachmentHandler {
  private readonly config: AttachmentConfig;
  private readonly sandbox: SandboxExecutor | undefined;
  private readonly execOptions: ExecutionOptions | undefined;
  private readonly compiledRegex: RegExp | undefined;

  constructor(
    config: AttachmentConfig,
    sandbox?: SandboxExecutor,
    execOptions?: ExecutionOptions,
  ) {
    this.config = config;
    this.sandbox = sandbox;
    this.execOptions = execOptions;
    if (config.mode === ATTACHMENT_MODE.REGEX && config.pattern) {
      this.compiledRegex = new RegExp(config.pattern, 'g');
    }
  }

  /** Extract attachments from content. Returns modified content and extracted attachments. */
  async extract(content: string, signal?: AbortSignal): Promise<Result<AttachmentResult>> {
    return tryCatch(async () => {
      switch (this.config.mode) {
        case ATTACHMENT_MODE.NONE:
          return { content, attachments: [] };

        case ATTACHMENT_MODE.REGEX:
          return this.extractRegex(content);

        case ATTACHMENT_MODE.JAVASCRIPT:
          return this.extractJavaScript(content, signal);

        default:
          return { content, attachments: [] };
      }
    });
  }

  /** Extract attachments using regex pattern matching. */
  private extractRegex(content: string): AttachmentResult {
    if (!this.compiledRegex) {
      return { content, attachments: [] };
    }

    const attachments: ExtractedAttachment[] = [];
    const mimeType = this.config.mimeType ?? 'application/octet-stream';
    // replace() walks a global pattern safely: it steps past empty matches
    // (a manual exec loop never advances on one and hangs the server) and
    // swaps each match where it was found.
    const modifiedContent = content.replace(this.compiledRegex, (matched: string) => {
      if (matched === '') return matched;
      const id = crypto.randomUUID();
      attachments.push({ id, mimeType, content: matched, size: Buffer.byteLength(matched) });
      return `\${ATTACH:${id}}`;
    });

    return { content: modifiedContent, attachments };
  }

  /** Extract attachments using a JavaScript script in the sandbox. */
  private async extractJavaScript(content: string, signal?: AbortSignal): Promise<AttachmentResult> {
    if (!this.config.script || !this.sandbox || !this.execOptions) {
      return { content, attachments: [] };
    }

    const context = createSandboxContext(content, content, content);
    const options = signal
      ? { ...this.execOptions, signal }
      : this.execOptions;

    const result: Result<ExecutionResult> = await this.sandbox.execute(this.config.script, context, options);

    // Fail loud: carrying on would store the message with its attachments
    // still inline, as if extraction had been configured off.
    if (!result.ok) {
      throw new Error(`Attachment script failed: ${result.error.message}`);
    }

    const returned = result.value.returnValue as { content?: string; attachments?: readonly { mimeType?: string; content: string }[] } | undefined;

    if (!returned || typeof returned !== 'object') {
      return { content, attachments: [] };
    }

    const modifiedContent = typeof returned.content === 'string' ? returned.content : content;
    const rawAttachments = Array.isArray(returned.attachments) ? returned.attachments : [];

    const attachments: ExtractedAttachment[] = rawAttachments
      .filter((a): a is { mimeType?: string; content: string } => typeof a === 'object' && a !== null && typeof a.content === 'string')
      .map((a) => ({
        id: crypto.randomUUID(),
        mimeType: a.mimeType ?? 'application/octet-stream',
        content: a.content,
        size: Buffer.byteLength(a.content),
      }));

    return { content: modifiedContent, attachments };
  }
}
