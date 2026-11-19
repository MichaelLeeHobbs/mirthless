import { fillPlaceholders, recordLookup, tryCatch, type Result } from '@galvanigraph/core-util';
import { fillVariables, type DestinationConnectorRuntime, type ConnectorMessage, type ConnectorResponse } from '../base.js';
import { createRequire } from 'node:module';
import { withTimeoutSignal } from '../timeout.js';

// The package is ESM, so a bare `require` is undefined at runtime (vitest
// injects one, which hid this). Load the CJS client library through createRequire.
const require = createRequire(import.meta.url);

const SEND_TIMEOUT_MS = 30_000;

export interface SmtpDispatcherConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  /** STARTTLS before authenticating, so credentials never cross a plaintext connection. */
  readonly requireTLS: boolean;
  /** Omitted for an anonymous relay. */
  readonly auth?: SmtpAuth | undefined;
  readonly from: string;
  readonly to: string;
  readonly cc: string;
  readonly bcc: string;
  readonly subject: string;
  readonly bodyTemplate: string;
  readonly contentType: 'text/plain' | 'text/html';
  readonly attachContent: boolean;
  /** Mirth's config-driven model: content is a template string, not a reference into the message attachment table. */
  readonly attachments?: readonly SmtpAttachment[] | undefined;
}

export interface SmtpAuth {
  readonly user: string;
  readonly pass: string;
}

export type SmtpTransportConfig = Pick<SmtpDispatcherConfig, 'host' | 'port' | 'secure' | 'requireTLS' | 'auth'>;

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

export interface SmtpAttachment {
  readonly filename: string;
  readonly content: string;
  readonly mimeType?: string | undefined;
}

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

export type TransportFactory = (config: SmtpDispatcherConfig) => SmtpTransport;

export function substituteTemplate(
  template: string,
  content: string,
  message: ConnectorMessage,
): string {
  const builtIns = recordLookup({
    msg: content,
    messageId: String(message.messageId),
    channelId: message.channelId,
    metaDataId: String(message.metaDataId),
  });
  const variables = recordLookup(message.variables ?? {});
  return fillPlaceholders(template, (name) => builtIns(name) ?? variables(name));
}

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
        from: fillVariables(this.config.from, message),
        to: fillVariables(this.config.to, message),
        ...(this.config.cc ? { cc: fillVariables(this.config.cc, message) } : {}),
        ...(this.config.bcc ? { bcc: fillVariables(this.config.bcc, message) } : {}),
        subject,
        ...(this.config.contentType === 'text/html' ? { html: body } : { text: body }),
        ...(attachments.length > 0 ? { attachments } : {}),
      };

      const transport = this.createTransport(this.config);
      try {
        // nodemailer sendMail has no AbortSignal support, so race it against the
        // caller's signal and a hard timeout.
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

/**
 * requireTLS is forwarded as given: the SMTP connector sets it from its
 * properties; the server's own mail passes false.
 */
export function buildNodemailerOptions(config: SmtpTransportConfig): Record<string, unknown> {
  const hasCreds = !!config.auth && !!config.auth.user;
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTLS,
    ...(hasCreds ? { auth: { user: config.auth!.user, pass: config.auth!.pass } } : {}),
  };
}

export function createNodemailerTransport(config: SmtpTransportConfig): SmtpTransport {
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
