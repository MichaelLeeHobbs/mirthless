import { tryCatch, type Result } from 'stderr-lib';
import { createNodemailerTransport, type SmtpTransport as ConnectorSmtpTransport } from '@galvanigraph/connectors';
import { SettingsService } from './settings.service.js';
import logger from '../lib/logger.js';

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly requireTls: boolean;
  readonly from: string;
  readonly authUser: string;
  readonly authPass: string;
}

export type SmtpTransport = ConnectorSmtpTransport;

export type TransportFactory = (config: SmtpConfig) => SmtpTransport;

/** The builder sends auth only when a user is set, and the password never goes out before TLS (D-332). */
function defaultTransportFactory(config: SmtpConfig): SmtpTransport {
  return createNodemailerTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls || (config.authUser !== '' && !config.secure),
    auth: { user: config.authUser, pass: config.authPass },
  });
}

let transportFactory: TransportFactory = defaultTransportFactory;

/** Tests only. */
export function setTransportFactory(factory: TransportFactory): void {
  transportFactory = factory;
}

/** Tests only. */
export function resetTransportFactory(): void {
  transportFactory = defaultTransportFactory;
}

const SMTP_KEYS = ['smtp.host', 'smtp.port', 'smtp.secure', 'smtp.require_tls', 'smtp.from', 'smtp.auth_user', 'smtp.auth_pass'] as const;

type SmtpKey = (typeof SMTP_KEYS)[number];

/** In one read, so a password is never paired with the host of a later save. */
async function readSmtpSettings(): Promise<(key: SmtpKey) => string> {
  const result = await SettingsService.getStoredValues(SMTP_KEYS);
  if (!result.ok) throw new Error(`Failed to read the SMTP settings: ${result.error.message}`);
  return (key) => result.value.get(key) ?? '';
}

/** Any other text fails the email: read as off, it would send without TLS. */
function asSwitch(key: SmtpKey, value: string): boolean {
  if (value !== '' && value !== 'true' && value !== 'false') throw new Error(`${key} must be true or false`);
  return value === 'true';
}

export class EmailService {
  static async getSmtpConfig(): Promise<Result<SmtpConfig>> {
    return tryCatch(async () => {
      const read = await readSmtpSettings();
      const host = read('smtp.host');
      if (!host) throw new Error('SMTP host is not configured');
      const port = read('smtp.port');

      return {
        host,
        port: port ? Number(port) : 587,
        secure: asSwitch('smtp.secure', read('smtp.secure')),
        requireTls: asSwitch('smtp.require_tls', read('smtp.require_tls')),
        from: read('smtp.from'),
        authUser: read('smtp.auth_user'),
        authPass: read('smtp.auth_pass'),
      };
    });
  }

  static async sendMail(
    to: readonly string[],
    subject: string,
    body: string,
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const configResult = await EmailService.getSmtpConfig();
      if (!configResult.ok) {
        throw new Error(`SMTP config error: ${configResult.error.message}`);
      }

      const config = configResult.value;
      const transport = transportFactory(config);
      try {
        await transport.sendMail({
          from: config.from,
          to: to.join(', '),
          subject,
          text: body,
        });
        logger.info({ to, subject }, 'Alert email sent');
      } finally {
        transport.close();
      }
    });
  }
}
