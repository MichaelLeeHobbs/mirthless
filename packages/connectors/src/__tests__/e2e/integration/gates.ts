import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe } from 'vitest';
import type { PoolConfig } from '../../../index.js';

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

export function requireDb(): TestDbConfig {
  if (!dbConfig) throw new Error('DATABASE_URL is not a *_test database');
  return dbConfig;
}

function readTestMysqlConfig(): PoolConfig | null {
  const host = process.env.MYSQL_TEST_HOST;
  if (!host) return null;
  return {
    host,
    port: process.env.MYSQL_TEST_PORT ? Number(process.env.MYSQL_TEST_PORT) : 3307,
    database: process.env.MYSQL_TEST_DATABASE ?? 'partner',
    user: process.env.MYSQL_TEST_USER ?? 'mirth',
    password: process.env.MYSQL_TEST_PASSWORD ?? 'mirthpw',
    maxConnections: 4,
    idleTimeoutMs: 10_000,
    connectionTimeoutMs: 10_000,
  };
}

export const mysqlConfig = readTestMysqlConfig();
export const describeMysql = mysqlConfig ? describe : describe.skip;
export function requireMysql(): PoolConfig {
  if (!mysqlConfig) throw new Error('MYSQL_TEST_HOST is not set');
  return mysqlConfig;
}

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

export interface TestMailConfig {
  readonly host: string;
  readonly smtpPort: number;
  readonly imapPort: number;
  /** GreenMail's user login, which differs from `address` (the SMTP envelope). */
  readonly username: string;
  readonly password: string;
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

export interface TestKafkaConfig {
  /** Plaintext listener, `host:port`. */
  readonly brokers: string;
  /** SASL/PLAIN listener, `host:port`. */
  readonly saslBrokers: string;
  readonly username: string;
  readonly password: string;
}

function readKafkaConfig(): TestKafkaConfig | null {
  const brokers = process.env.KAFKA_TEST_BROKERS;
  if (!brokers) return null;
  return {
    brokers,
    saslBrokers: process.env.KAFKA_TEST_SASL_BROKERS ?? 'localhost:19093',
    username: process.env.KAFKA_TEST_USER ?? 'mirth',
    password: process.env.KAFKA_TEST_PASSWORD ?? 'mirthpw',
  };
}

export const kafkaConfig = readKafkaConfig();
export const describeKafka = kafkaConfig ? describe : describe.skip;
export function requireKafka(): TestKafkaConfig {
  if (!kafkaConfig) throw new Error('KAFKA_TEST_BROKERS is not set');
  return kafkaConfig;
}

export interface TestAmqpConfig {
  readonly host: string;
  readonly port: number;
  /** RabbitMQ management API port, used to drop client connections. */
  readonly managementPort: number;
  readonly username: string;
  readonly password: string;
}

function readAmqpConfig(): TestAmqpConfig | null {
  const host = process.env.AMQP_TEST_HOST;
  if (!host) return null;
  return {
    host,
    port: process.env.AMQP_TEST_PORT ? Number(process.env.AMQP_TEST_PORT) : 5673,
    managementPort: process.env.AMQP_TEST_MANAGEMENT_PORT ? Number(process.env.AMQP_TEST_MANAGEMENT_PORT) : 15673,
    username: process.env.AMQP_TEST_USER ?? 'mirth',
    password: process.env.AMQP_TEST_PASSWORD ?? 'mirthpw',
  };
}

export const amqpConfig = readAmqpConfig();
export const describeAmqp = amqpConfig ? describe : describe.skip;
export function requireAmqp(): TestAmqpConfig {
  if (!amqpConfig) throw new Error('AMQP_TEST_HOST is not set');
  return amqpConfig;
}

export interface TestAmqpTlsConfig {
  readonly port: number;
  /** PEM of the CA that signed the broker's test certificate. */
  readonly ca: string;
}

/** Written by the rabbitmq-test container's entrypoint on first start. */
const DEFAULT_TEST_CA = fileURLToPath(new URL('../../../../../../docker/test-certs/ca.pem', import.meta.url));

function readAmqpTlsConfig(): TestAmqpTlsConfig | null {
  if (!amqpConfig) return null;
  const caFile = process.env.AMQP_TEST_CA_FILE ?? DEFAULT_TEST_CA;
  if (!existsSync(caFile)) return null;
  return {
    port: process.env.AMQP_TEST_TLS_PORT ? Number(process.env.AMQP_TEST_TLS_PORT) : 5674,
    ca: readFileSync(caFile, 'utf8'),
  };
}

export const amqpTlsConfig = readAmqpTlsConfig();
export const describeAmqpTls = amqpTlsConfig ? describe : describe.skip;
export function requireAmqpTls(): TestAmqpTlsConfig {
  if (!amqpTlsConfig) throw new Error('the AMQP test CA (docker/test-certs/ca.pem or AMQP_TEST_CA_FILE) is missing');
  return amqpTlsConfig;
}

const missingServices = [
  dbConfig ? null : 'DATABASE_URL (a *_test database)',
  mysqlConfig ? null : 'MYSQL_TEST_HOST',
  sftpConfig ? null : 'SFTP_TEST_HOST',
  mailConfig ? null : 'SMTP_TEST_HOST',
  kafkaConfig ? null : 'KAFKA_TEST_BROKERS',
  amqpConfig ? null : 'AMQP_TEST_HOST',
  amqpTlsConfig ? null : 'the AMQP test CA (docker/test-certs/ca.pem or AMQP_TEST_CA_FILE)',
].filter((name): name is string => name !== null);

// CI sets this (D-273). Throwing at import fails every suite instead of letting it skip green.
if (process.env.CONNECTOR_ITEST_REQUIRED === '1' && missingServices.length > 0) {
  throw new Error(`CONNECTOR_ITEST_REQUIRED=1 but these are not configured, so their suites would skip: ${missingServices.join(', ')}`);
}

// DICOM has no gate: dcmjs-dimse runs in-process, so its test is in the default lane.
