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

/** The builder sends auth only when a user is set. */
function defaultTransportFactory(config: SmtpConfig): SmtpTransport {
  return createNodemailerTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
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

async function readSetting(key: string): Promise<string> {
  const result = await SettingsService.getStoredValue(key);
  if (!result.ok) throw new Error(`Failed to read ${key}: ${result.error.message}`);
  return result.value ?? '';
}

/** Any other text fails the email: read as off, it would send without TLS. */
async function readSwitch(key: string): Promise<boolean> {
  const value = await readSetting(key);
  if (value !== '' && value !== 'true' && value !== 'false') throw new Error(`${key} must be true or false`);
  return value === 'true';
}

export class EmailService {
  static async getSmtpConfig(): Promise<Result<SmtpConfig>> {
    return tryCatch(async () => {
      const [host, port, secure, requireTls, from, authUser, authPass] = await Promise.all([
        readSetting('smtp.host'),
        readSetting('smtp.port'),
        readSwitch('smtp.secure'),
        readSwitch('smtp.require_tls'),
        readSetting('smtp.from'),
        readSetting('smtp.auth_user'),
        readSetting('smtp.auth_pass'),
      ]);

      if (!host) throw new Error('SMTP host is not configured');

      return {
        host,
        port: port ? Number(port) : 587,
        secure,
        requireTls,
        from,
        authUser,
        authPass,
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
