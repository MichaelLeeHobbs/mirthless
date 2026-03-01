// ===========================================
// Email Service
// ===========================================
// Sends emails via nodemailer using SMTP settings stored in the database.
// Used by the AlertManager to dispatch EMAIL alert actions.
// All methods return Result<T> using tryCatch from stderr-lib.

import { createRequire } from 'module';
import { tryCatch, type Result } from 'stderr-lib';
import { SettingsService } from './settings.service.js';
import logger from '../lib/logger.js';

const require = createRequire(import.meta.url);

// ----- Types -----

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly from: string;
  readonly authUser: string;
  readonly authPass: string;
}

/** Nodemailer transport interface (subset used by this service). */
export interface SmtpTransport {
  sendMail(options: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

/** Factory function to create an SMTP transport. */
export type TransportFactory = (config: SmtpConfig) => SmtpTransport;

// ----- Transport Factory -----

/** Default transport factory using nodemailer. */
function defaultTransportFactory(config: SmtpConfig): SmtpTransport {
  const nodemailer = require('nodemailer') as {
    createTransport: (opts: Record<string, unknown>) => SmtpTransport;
  };
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.authUser ? { auth: { user: config.authUser, pass: config.authPass } } : {}),
  });
}

/** Module-level transport factory. Overridable for tests. */
let transportFactory: TransportFactory = defaultTransportFactory;

/** Override the transport factory (for testing). */
export function setTransportFactory(factory: TransportFactory): void {
  transportFactory = factory;
}

/** Reset to default transport factory (for testing). */
export function resetTransportFactory(): void {
  transportFactory = defaultTransportFactory;
}

// ----- Helpers -----

/** Read a single setting key, returning empty string if not found. */
async function readSettingValue(key: string): Promise<Result<string>> {
  const result = await SettingsService.getByKey(key);
  if (!result.ok) {
    // NOT_FOUND is acceptable - return empty string
    return { ok: true as const, value: '', error: null };
  }
  return { ok: true as const, value: result.value.value ?? '', error: null };
}

// ----- Service -----

export class EmailService {
  /** Read SMTP configuration from system settings. */
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

      // All reads should succeed (readSettingValue handles NOT_FOUND)
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

  /** Send an email using SMTP settings from the database. */
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
