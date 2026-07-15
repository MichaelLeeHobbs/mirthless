// ===========================================
// Integration-test gates
// ===========================================
// Each connector-integration suite runs only when its backing service is
// configured (via env), and self-skips otherwise. This keeps the integration
// lane runnable anywhere while still exercising real protocols in CI / docker.

import { describe } from 'vitest';
import type { PoolConfig } from '@mirthless/connectors';

// ----- Postgres (DATABASE_URL ending in *_test) -----

export interface TestDbConfig extends PoolConfig {
  readonly url: string;
}

function readTestDbConfig(): TestDbConfig | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const u = new URL(url);
    const database = u.pathname.replace(/^\//, '');
    // Guard developer/prod DBs: only a *_test database is safe for CREATE/DROP.
    if (!/_test$/i.test(database)) return null;
    return {
      url,
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      database,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      maxConnections: 4,
      idleTimeoutMs: 10_000,
      connectionTimeoutMs: 10_000,
    };
  } catch {
    return null;
  }
}

export const dbConfig = readTestDbConfig();
export const describeDb = dbConfig ? describe : describe.skip;

/** Non-null DB config for use inside hooks/tests (never called when skipped). */
export function requireDb(): TestDbConfig {
  if (!dbConfig) throw new Error('DATABASE_URL is not a *_test database');
  return dbConfig;
}

// ----- SFTP (SFTP_TEST_HOST) -----

export interface TestSftpConfig {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly baseDir: string;
}

function readSftpConfig(): TestSftpConfig | null {
  const host = process.env.SFTP_TEST_HOST;
  if (!host) return null;
  return {
    host,
    port: process.env.SFTP_TEST_PORT ? Number(process.env.SFTP_TEST_PORT) : 2222,
    username: process.env.SFTP_TEST_USER ?? 'mirth',
    password: process.env.SFTP_TEST_PASSWORD ?? 'mirthpw',
    baseDir: process.env.SFTP_TEST_DIR ?? '/upload',
  };
}

export const sftpConfig = readSftpConfig();
export const describeSftp = sftpConfig ? describe : describe.skip;
export function requireSftp(): TestSftpConfig {
  if (!sftpConfig) throw new Error('SFTP_TEST_HOST is not set');
  return sftpConfig;
}

// ----- SMTP / IMAP (GreenMail: SMTP_TEST_HOST) -----

export interface TestMailConfig {
  readonly host: string;
  readonly smtpPort: number;
  readonly imapPort: number;
  /** IMAP/SMTP login (GreenMail user login — e.g. "mirth"). */
  readonly username: string;
  readonly password: string;
  /** Mailbox email address (e.g. "mirth@example.com") — the SMTP envelope. */
  readonly address: string;
}

function readMailConfig(): TestMailConfig | null {
  const host = process.env.SMTP_TEST_HOST;
  if (!host) return null;
  return {
    host,
    smtpPort: process.env.SMTP_TEST_PORT ? Number(process.env.SMTP_TEST_PORT) : 3025,
    imapPort: process.env.IMAP_TEST_PORT ? Number(process.env.IMAP_TEST_PORT) : 3143,
    username: process.env.MAIL_TEST_USER ?? 'mirth',
    password: process.env.MAIL_TEST_PASSWORD ?? 'mirthpw',
    address: process.env.MAIL_TEST_ADDRESS ?? 'mirth@example.com',
  };
}

export const mailConfig = readMailConfig();
export const describeMail = mailConfig ? describe : describe.skip;
export function requireMail(): TestMailConfig {
  if (!mailConfig) throw new Error('SMTP_TEST_HOST is not set');
  return mailConfig;
}

// (DICOM needs no gate: the dcmjs-dimse connector runs in-process, so its cascade
// test lives in the default lane — packages/engine/src/__tests__/connector-dicom.e2e.test.ts.)
