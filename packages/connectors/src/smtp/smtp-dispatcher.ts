// ===========================================
// SMTP Dispatcher (Destination Connector)
// ===========================================
// Sends messages as emails via SMTP using nodemailer.
// Supports template variable substitution in subject/body.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';
import { withTimeoutSignal } from '../timeout.js';

/** Default SMTP send timeout — nodemailer has no native cancellation. */
const SEND_TIMEOUT_MS = 30_000;

// ----- Config -----

export interface SmtpDispatcherConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  /**
   * Require STARTTLS upgrade before authenticating on a non-secure port.
   * Prevents credentials from being sent over a plaintext connection.
   */
  readonly requireTLS: boolean;
  /** Credentials. Omitted/empty for anonymous relays — no auth is sent. */
  readonly auth?: SmtpAuth | undefined;
  readonly from: string;
  readonly to: string;
  readonly cc: string;
  readonly bcc: string;
  readonly subject: string;
  readonly bodyTemplate: string;
  readonly contentType: 'text/plain' | 'text/html';
  readonly attachContent: boolean;
  /**
   * Config-driven attachments. Each item's `filename` and `content` run through
   * `substituteTemplate` (so `${msg}`/`${messageId}`/etc. work); `mimeType` maps
   * to nodemailer's `contentType`. This is Mirth's config-driven model — content
   * is a template string, not a reference into the message attachment table.
   */
  readonly attachments?: readonly SmtpAttachment[] | undefined;
}

export interface SmtpAuth {
  readonly user: string;
  readonly pass: string;
}

// ----- Transport abstraction (for testability) -----

/** Abstraction over nodemailer transporter for testability. */
export interface SmtpTransport {
  sendMail(options: SmtpMailOptions): Promise<SmtpSendResult>;
  close(): void;
}

export interface SmtpMailOptions {
  readonly from: string;
  readonly to: string;
  readonly cc?: string;
  readonly bcc?: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly attachments?: readonly SmtpMailAttachment[];
}

/** Config-level attachment: template strings + optional MIME type. */
export interface SmtpAttachment {
  readonly filename: string;
  readonly content: string;
  readonly mimeType?: string;
}

/** Nodemailer-facing attachment: substituted values + nodemailer's `contentType`. */
export interface SmtpMailAttachment {
  readonly filename: string;
  readonly content: string;
  readonly contentType?: string;
}

export interface SmtpSendResult {
  readonly messageId: string;
  readonly accepted: readonly string[];
  readonly rejected: readonly string[];
}

/** Factory function to create an SMTP transport. Defaults to nodemailer. */
export type TransportFactory = (config: SmtpDispatcherConfig) => SmtpTransport;

// ----- Template substitution -----

/**
 * Substitute `${msg}` and `${messageId}` placeholders in a template string.
 * Kept intentionally simple — no eval, no arbitrary expressions.
 */
export function substituteTemplate(
  template: string,
  content: string,
  message: ConnectorMessage,
): string {
  return template
    .replace(/\$\{msg\}/g, content)
    .replace(/\$\{messageId\}/g, String(message.messageId))
    .replace(/\$\{channelId\}/g, message.channelId)
    .replace(/\$\{metaDataId\}/g, String(message.metaDataId));
}

// ----- Dispatcher -----

export class SmtpDispatcher implements DestinationConnectorRuntime {
  private readonly config: SmtpDispatcherConfig;
  private readonly createTransport: TransportFactory;
  private started = false;

  constructor(config: SmtpDispatcherConfig, createTransport?: TransportFactory) {
    this.config = config;
    this.createTransport = createTransport ?? defaultTransportFactory;
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.host) throw new Error('SMTP host is required');
      if (!this.config.from) throw new Error('From address is required');
      if (!this.config.to) throw new Error('To address is required');
      if (this.config.port < 1 || this.config.port > 65535) {
        throw new Error('Port must be between 1 and 65535');
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
      if (!this.started) throw new Error('Dispatcher not started');
      if (signal.aborted) throw new Error('Send aborted');

      const subject = substituteTemplate(this.config.subject, message.content, message);
      const body = substituteTemplate(this.config.bodyTemplate, message.content, message);
      const attachments = this.buildAttachments(message);

      const mailOptions: SmtpMailOptions = {
        from: this.config.from,
        to: this.config.to,
        ...(this.config.cc ? { cc: this.config.cc } : {}),
        ...(this.config.bcc ? { bcc: this.config.bcc } : {}),
        subject,
        ...(this.config.contentType === 'text/html' ? { html: body } : { text: body }),
        ...(attachments.length > 0 ? { attachments } : {}),
      };

      const transport = this.createTransport(this.config);
      try {
        // nodemailer sendMail has no AbortSignal support, so race it against the
        // caller's signal AND a hard timeout; a hung SMTP server surfaces as a
        // Result error (via the enclosing tryCatch) instead of an unbounded wait.
        const result = await withTimeoutSignal(
          transport.sendMail(mailOptions), SEND_TIMEOUT_MS, 'SMTP sendMail', signal,
        );
        const accepted = result.accepted.length;
        const rejected = result.rejected.length;
        // Every recipient rejected = nothing delivered. Reporting SENT here would
        // silently lose the message (e.g. an alert/result email the server refused).
        if (accepted === 0) {
          return {
            status: 'ERROR' as const,
            content: `SMTP delivery failed: all ${String(rejected)} recipient(s) rejected (messageId=${String(result.messageId)})`,
            errorMessage: 'All recipients rejected',
          };
        }
        return {
          status: 'SENT' as const,
          content: `messageId=${result.messageId}, accepted=${String(accepted)}, rejected=${String(rejected)}`,
        };
      } finally {
        transport.close();
      }
    });
  }

  /**
   * Build the outbound attachment list: the optional `message.txt` body
   * attachment (when `attachContent`) followed by each config attachment with
   * its filename/content template-substituted and `mimeType` mapped to
   * `contentType`. Returns an empty array when nothing is configured so the
   * caller can omit the `attachments` key entirely.
   */
  private buildAttachments(message: ConnectorMessage): readonly SmtpMailAttachment[] {
    const result: SmtpMailAttachment[] = [];
    if (this.config.attachContent) {
      result.push({ filename: 'message.txt', content: message.content });
    }
    for (const att of this.config.attachments ?? []) {
      result.push({
        filename: substituteTemplate(att.filename, message.content, message),
        content: substituteTemplate(att.content, message.content, message),
        ...(att.mimeType ? { contentType: att.mimeType } : {}),
      });
    }
    return result;
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

// ----- Default transport factory (nodemailer) -----

/**
 * Build nodemailer transport options from connector config.
 * Auth is included ONLY when credentials are present — never an empty auth
 * object — and requireTLS is always forwarded so credentials are not sent
 * over a plaintext connection.
 */
export function buildNodemailerOptions(config: SmtpDispatcherConfig): Record<string, unknown> {
  const hasCreds = !!config.auth && !!config.auth.user;
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTLS,
    ...(hasCreds ? { auth: { user: config.auth!.user, pass: config.auth!.pass } } : {}),
  };
}

/** Create a nodemailer-based transport. Requires nodemailer to be installed. */
export function createNodemailerTransport(config: SmtpDispatcherConfig): SmtpTransport {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodemailer = require('nodemailer') as { createTransport: (opts: Record<string, unknown>) => { sendMail: (opts: SmtpMailOptions) => Promise<SmtpSendResult>; close: () => void } };
  const transporter = nodemailer.createTransport(buildNodemailerOptions(config));
  return {
    sendMail: async (options) => transporter.sendMail(options),
    close: () => transporter.close(),
  };
}

function defaultTransportFactory(config: SmtpDispatcherConfig): SmtpTransport {
  return createNodemailerTransport(config);
}
