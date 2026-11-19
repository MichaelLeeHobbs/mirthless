import { tryCatch, type Result } from 'stderr-lib';
import { createNodemailerTransport, type SmtpTransport as ConnectorSmtpTransport } from '@galvanigraph/connectors';
import { SettingsService } from './settings.service.js';
import logger from '../lib/logger.js';

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
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
    requireTLS: false,
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

async function readSettingValue(key: string): Promise<Result<string>> {
  const result = await SettingsService.getByKey(key);
  if (!result.ok) {
    // NOT_FOUND is acceptable - return empty string
    return { ok: true as const, value: '', error: null };
  }
  return { ok: true as const, value: result.value.value ?? '', error: null };
}

export class EmailService {
  static async getSmtpConfig(): Promise<Result<SmtpConfig>> {
    return tryCatch(async () => {
      const [host, port, secure, from, authUser, authPass] = await Promise.all([
        readSettingValue('smtp.host'),
        readSettingValue('smtp.port'),
        readSettingValue('smtp.secure'),
        readSettingValue('smtp.from'),
        readSettingValue('smtp.auth_user'),
        readSettingValue('smtp.auth_pass'),
      ]);

      if (!host.ok) throw new Error(`Failed to read smtp.host: ${host.error.message}`);
      if (!port.ok) throw new Error(`Failed to read smtp.port: ${port.error.message}`);
      if (!secure.ok) throw new Error(`Failed to read smtp.secure: ${secure.error.message}`);
      if (!from.ok) throw new Error(`Failed to read smtp.from: ${from.error.message}`);
      if (!authUser.ok) throw new Error(`Failed to read smtp.auth_user: ${authUser.error.message}`);
      if (!authPass.ok) throw new Error(`Failed to read smtp.auth_pass: ${authPass.error.message}`);

      if (!host.value) {
        throw new Error('SMTP host is not configured');
      }

      return {
        host: host.value,
        port: port.value ? Number(port.value) : 587,
        secure: secure.value === 'true',
        from: from.value,
        authUser: authUser.value,
        authPass: authPass.value,
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
