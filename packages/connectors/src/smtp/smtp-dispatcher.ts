// ===========================================
// SMTP Dispatcher (Destination Connector)
// ===========================================
// Sends messages as emails via SMTP using nodemailer.
// Supports template variable substitution in subject/body.

import { tryCatch, type Result } from '@mirthless/core-util';
import type { DestinationConnectorRuntime, ConnectorMessage, ConnectorResponse } from '../base.js';

// ----- Config -----

export interface SmtpDispatcherConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly auth: SmtpAuth;
  readonly from: string;
  readonly to: string;
  readonly cc: string;
  readonly bcc: string;
  readonly subject: string;
  readonly bodyTemplate: string;
  readonly contentType: 'text/plain' | 'text/html';
  readonly attachContent: boolean;
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
  readonly attachments?: readonly SmtpAttachment[];
}

export interface SmtpAttachment {
  readonly filename: string;
  readonly content: string;
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

      const mailOptions: SmtpMailOptions = {
        from: this.config.from,
        to: this.config.to,
        ...(this.config.cc ? { cc: this.config.cc } : {}),
        ...(this.config.bcc ? { bcc: this.config.bcc } : {}),
        subject,
        ...(this.config.contentType === 'text/html' ? { html: body } : { text: body }),
        ...(this.config.attachContent ? {
          attachments: [{ filename: 'message.txt', content: message.content }],
        } : {}),
      };

      const transport = this.createTransport(this.config);
      try {
        const result = await transport.sendMail(mailOptions);
        const accepted = result.accepted.length;
        const rejected = result.rejected.length;
        return {
          status: 'SENT' as const,
          content: `messageId=${result.messageId}, accepted=${String(accepted)}, rejected=${String(rejected)}`,
        };
      } finally {
        transport.close();
      }
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
}

// ----- Default transport factory (nodemailer) -----

/** Create a nodemailer-based transport. Requires nodemailer to be installed. */
export function createNodemailerTransport(config: SmtpDispatcherConfig): SmtpTransport {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodemailer = require('nodemailer') as { createTransport: (opts: Record<string, unknown>) => { sendMail: (opts: SmtpMailOptions) => Promise<SmtpSendResult>; close: () => void } };
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.auth.user, pass: config.auth.pass },
  });
  return {
    sendMail: async (options) => transporter.sendMail(options),
    close: () => transporter.close(),
  };
}

function defaultTransportFactory(config: SmtpDispatcherConfig): SmtpTransport {
  return createNodemailerTransport(config);
}
