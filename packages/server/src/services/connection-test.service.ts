// ===========================================
// Connection Test Service
// ===========================================
// Stateless connector connectivity testers. Each connector type has a
// dedicated tester that verifies the target is reachable. All testers
// enforce a 10-second timeout via AbortController and measure latency.
// Returns Result<ConnectionTestResult> — never throws.

import * as net from 'node:net';
import * as https from 'node:https';
import * as dns from 'node:dns/promises';
import { type LookupAddress } from 'node:dns';
import * as fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { stderr, type Result } from 'stderr-lib';
import type { z } from 'zod/v4';
import {
  kafkaSourcePropertiesSchema,
  kafkaDestinationPropertiesSchema,
  amqpSourcePropertiesSchema,
  amqpDestinationPropertiesSchema,
  type ConnectionTestResult,
} from '@galvaniflow/core-models';
import { isReservedAddress, isReservedHostname } from '@galvaniflow/engine';
import {
  testKafkaConnection,
  testAmqpConnection,
  readQueueTls,
  withTimeout,
  DATABASE_VENDOR,
  createPool,
  createSsh2SftpClient,
  validateAuth,
  type DatabasePool,
  type DatabaseVendor,
  type SftpClient,
  type SftpClientFactory,
  type SftpConnectionOptions,
  type SftpPathKind,
} from '@galvaniflow/connectors';
import { ServiceError } from '../lib/service-error.js';
import { resolveHttpDestinationTls, resolveHttpSourceTls, resolveQueueTls } from './connector-tls-resolver.js';

const nodeRequire = createRequire(import.meta.url);

// ----- Constants -----

const TEST_TIMEOUT_MS = 10_000;
/** How long to wait for an SFTP session to close after a test before giving up on it. */
const SFTP_CLOSE_TIMEOUT_MS = 2_000;

// ----- Injectable Factories (for testing) -----

/** What the database test needs from a connector pool: connect (create checks the connection) and close. */
type TestPool = Pick<DatabasePool, 'create' | 'destroy'>;

/** The database connectors' pool for a vendor, so the test speaks the same protocol as the connector. */
type PoolFactory = (vendor: DatabaseVendor) => TestPool;

/** nodemailer transport interface for verify. */
interface SmtpVerifyTransport {
  verify(): Promise<boolean>;
  close(): void;
}

/** nodemailer transport factory. */
type SmtpTransportFactory = (config: Record<string, unknown>) => SmtpVerifyTransport;

const defaultPoolFactory: PoolFactory = createPool;

/** Default nodemailer transport factory. */
function defaultSmtpTransportFactory(config: Record<string, unknown>): SmtpVerifyTransport {
  const nodemailer = nodeRequire('nodemailer') as {
    createTransport: (opts: Record<string, unknown>) => SmtpVerifyTransport;
  };
  return nodemailer.createTransport(config);
}

/** Module-level factories. Overridable for tests. */
let poolFactory: PoolFactory = defaultPoolFactory;
let smtpTransportFactory: SmtpTransportFactory = defaultSmtpTransportFactory;
let sftpClientFactory: SftpClientFactory = createSsh2SftpClient;

/** Override pool factory (for testing). */
export function setPoolFactory(factory: PoolFactory): void {
  poolFactory = factory;
}

/** Override SMTP transport factory (for testing). */
export function setSmtpTransportFactory(factory: SmtpTransportFactory): void {
  smtpTransportFactory = factory;
}

/** Override the SFTP client factory (for testing). */
export function setSftpClientFactory(factory: SftpClientFactory): void {
  sftpClientFactory = factory;
}

/** Reset factories to defaults (for testing). */
export function resetFactories(): void {
  poolFactory = defaultPoolFactory;
  smtpTransportFactory = defaultSmtpTransportFactory;
  sftpClientFactory = createSsh2SftpClient;
}

// ----- SSRF Protection -----

/**
 * SSRF guard: reject localhost names, reserved IP literals (loopback, link-local
 * cloud metadata, multicast...) and DNS names (or decimal/hex encodings) that
 * RESOLVE to one. Private networks are allowed: the endpoints an administrator
 * tests (MLLP, databases, SFTP) live there, and a deployed channel reaches them
 * anyway (D-262). The ranges are the engine's (`sandbox/ssrf.ts`).
 * Unresolvable hosts are allowed through; the connection attempt itself will fail
 * loudly, which is not an SSRF exposure.
 */
async function assertHostAllowed(hostname: string): Promise<void> {
  // pg reads a host starting with "/" as a Unix socket directory: a local server
  // that no address check below would see.
  if (/[/\\]/.test(hostname)) {
    throw new ServiceError('INVALID_INPUT', `Connection to ${hostname} is blocked (not a hostname or IP address)`);
  }
  if (isReservedHostname(hostname)) {
    throw new ServiceError('INVALID_INPUT', `Connection to ${hostname} is blocked (loopback or reserved address)`);
  }

  // An IP literal (bracketed IPv6 included) passed the check above; there is nothing to resolve.
  if (net.isIP(hostname.replace(/^\[(.*)\]$/, '$1')) !== 0) return;

  let addresses: readonly LookupAddress[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    return;
  }

  for (const addr of addresses) {
    if (isReservedAddress(addr.address)) {
      throw new ServiceError(
        'INVALID_INPUT',
        `Connection to ${hostname} is blocked (resolves to loopback or reserved address ${addr.address})`,
      );
    }
  }
}

// ----- Types -----

type Tester = (
  mode: string,
  properties: Readonly<Record<string, unknown>>,
) => Promise<ConnectionTestResult>;

// ----- Helpers -----

/** Create a successful test result. */
function successResult(message: string, latencyMs: number): ConnectionTestResult {
  return { success: true, message, latencyMs: Math.round(latencyMs * 100) / 100 };
}

/** Create a failed test result. */
function failureResult(message: string, latencyMs: number): ConnectionTestResult {
  return { success: false, message, latencyMs: Math.round(latencyMs * 100) / 100 };
}

/** Extract string property or throw with descriptive error. */
function requireString(props: Readonly<Record<string, unknown>>, key: string): string {
  const val = props[key];
  if (typeof val !== 'string' || val.length === 0) {
    throw new ServiceError('INVALID_INPUT', `Missing required property: ${key}`);
  }
  return val;
}

/** Extract number property or throw with descriptive error. */
function requireNumber(props: Readonly<Record<string, unknown>>, key: string): number {
  const val = props[key];
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new ServiceError('INVALID_INPUT', `Missing required numeric property: ${key}`);
  }
  return val;
}

// ----- Individual Testers -----

/** Test TCP connectivity to host:port (used for TCP_MLLP and DICOM). */
async function testTcpConnect(host: string, port: number): Promise<ConnectionTestResult> {
  await assertHostAllowed(host);
  const start = performance.now();

  return new Promise<ConnectionTestResult>((resolve) => {
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(failureResult('Connection timed out', performance.now() - start));
    }, TEST_TIMEOUT_MS);

    const socket = net.connect({ host, port }, () => {
      clearTimeout(timer);
      const latency = performance.now() - start;
      socket.destroy();
      resolve(successResult(`Connected to ${host}:${port}`, latency));
    });

    socket.on('error', (err: Error) => {
      clearTimeout(timer);
      const latency = performance.now() - start;
      resolve(failureResult(`Connection failed: ${err.message}`, latency));
    });
  });
}

/** TCP/MLLP tester — verifies TCP connectivity. */
const testTcpMllp: Tester = async (_mode, props) => {
  const host = requireString(props, 'host');
  const port = requireNumber(props, 'port');
  return testTcpConnect(host, port);
};

/**
 * HTTPS tester — resolves the selected certificates and performs a REAL TLS (or
 * mTLS) handshake with a HEAD request, so a passing test reflects the actual
 * ca/cert/key/rejectUnauthorized the connector will deploy with. Fails loud when
 * a referenced certificate cannot be resolved.
 */
async function testHttpsWithTls(
  url: string,
  props: Readonly<Record<string, unknown>>,
): Promise<ConnectionTestResult> {
  const resolved = await resolveHttpDestinationTls(props);
  if (!resolved.ok) {
    throw new ServiceError('INVALID_INPUT', `TLS certificate resolution failed: ${resolved.error.message}`);
  }
  const tls = (resolved.value['tls'] as Record<string, unknown> | undefined) ?? {};
  const start = performance.now();

  return new Promise<ConnectionTestResult>((resolve) => {
    const req = https.request(
      url,
      {
        method: 'HEAD',
        timeout: TEST_TIMEOUT_MS,
        rejectUnauthorized: tls['rejectUnauthorized'] !== false,
        ...(tls['ca'] ? { ca: tls['ca'] as string } : {}),
        ...(tls['cert'] ? { cert: tls['cert'] as string } : {}),
        ...(tls['key'] ? { key: tls['key'] as string } : {}),
      },
      (res) => {
        const latency = performance.now() - start;
        res.resume();
        resolve(successResult(`HTTPS ${String(res.statusCode)} ${res.statusMessage ?? ''}`.trim(), latency));
      },
    );
    req.on('timeout', () => { req.destroy(new Error('Connection timed out')); });
    req.on('error', (err: Error) => {
      resolve(failureResult(`HTTPS request failed: ${err.message}`, performance.now() - start));
    });
    req.end();
  });
}

/**
 * HTTPS SOURCE tester — an HTTPS listener has no outbound URL to connect to, so
 * "test connection" instead resolves the selected server certificate and runs a
 * REAL loopback TLS handshake using the resolved cert/key. This fails loud when
 * the certificate can't be resolved, lacks a private key, or the cert and key do
 * not form a valid pair (caught by Node's secure-context creation) — i.e. exactly
 * the failures that would otherwise only surface when the channel is deployed.
 */
async function testHttpsSourceHandshake(
  props: Readonly<Record<string, unknown>>,
): Promise<ConnectionTestResult> {
  const resolved = await resolveHttpSourceTls(props);
  if (!resolved.ok) {
    throw new ServiceError('INVALID_INPUT', `TLS certificate resolution failed: ${resolved.error.message}`);
  }
  const tls = (resolved.value['tls'] as Record<string, unknown> | undefined) ?? {};
  const cert = tls['cert'] as string;
  const key = tls['key'] as string;
  const start = performance.now();

  return new Promise<ConnectionTestResult>((resolve) => {
    let settled = false;
    let server: https.Server | undefined;
    const finish = (result: ConnectionTestResult): void => {
      if (settled) return;
      settled = true;
      server?.close();
      resolve(result);
    };

    // A mismatched cert/key throws here (X509_check_private_key) — fail loud.
    try {
      server = https.createServer({ cert, key }, (_req, res) => { res.end(); });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'invalid certificate/key';
      resolve(failureResult(`TLS handshake failed: ${msg}`, performance.now() - start));
      return;
    }

    server.on('error', (err: Error) => {
      finish(failureResult(`TLS handshake failed: ${err.message}`, performance.now() - start));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const req = https.request(
        { host: '127.0.0.1', port, method: 'HEAD', rejectUnauthorized: false, timeout: TEST_TIMEOUT_MS },
        (res) => {
          res.resume();
          finish(successResult('HTTPS listener TLS handshake succeeded (server certificate + key valid)', performance.now() - start));
        },
      );
      req.on('timeout', () => { req.destroy(new Error('handshake timed out')); });
      req.on('error', (err: Error) => {
        finish(failureResult(`TLS handshake failed: ${err.message}`, performance.now() - start));
      });
      req.end();
    });
  });
}

/** HTTP tester — sends HEAD request to URL (plain fetch, or real TLS for HTTPS). */
const testHttp: Tester = async (mode, props) => {
  // HTTPS source listeners have no outbound URL — validate the server cert via a
  // real loopback handshake instead of requiring a `url` they never carry.
  if (mode === 'SOURCE' && props['scheme'] === 'HTTPS') {
    return testHttpsSourceHandshake(props);
  }

  const url = requireString(props, 'url');
  const parsed = new URL(url);
  await assertHostAllowed(parsed.hostname);

  if (props['scheme'] === 'HTTPS') {
    return testHttpsWithTls(url, props);
  }

  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'error',
      signal: controller.signal,
    });
    const latency = performance.now() - start;
    return successResult(`HTTP ${response.status} ${response.statusText}`, latency);
  } catch (err: unknown) {
    const latency = performance.now() - start;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return failureResult(`HTTP request failed: ${msg}`, latency);
  } finally {
    clearTimeout(timer);
  }
};

/** File tester — verifies path exists and is readable/writable. */
const testFile: Tester = async (mode, props) => {
  const directory = requireString(props, 'directory');
  const start = performance.now();

  try {
    const accessMode = mode === 'SOURCE'
      ? fs.constants.R_OK
      : fs.constants.R_OK | fs.constants.W_OK;
    await fs.access(directory, accessMode);
    const latency = performance.now() - start;
    return successResult(`Path accessible: ${directory}`, latency);
  } catch (err: unknown) {
    const latency = performance.now() - start;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return failureResult(`Path not accessible: ${msg}`, latency);
  }
};

/** Database tester — connects with the connector's own pool for the vendor (PostgreSQL by default). */
const testDatabase: Tester = async (_mode, props) => {
  const host = requireString(props, 'host');
  const port = requireNumber(props, 'port');
  const database = requireString(props, 'database');
  const vendor = props['vendor'] ?? DATABASE_VENDOR.POSTGRESQL;
  if (vendor !== DATABASE_VENDOR.POSTGRESQL && vendor !== DATABASE_VENDOR.MYSQL) {
    return failureResult(`Database "${String(vendor)}" is not supported (PostgreSQL and MySQL are)`, 0);
  }
  await assertHostAllowed(host);

  const start = performance.now();
  const pool = poolFactory(vendor);
  const created = await pool.create({
    host,
    port,
    database,
    // The connector forms save the account as `username`.
    user: typeof props['username'] === 'string' ? props['username'] : '',
    password: typeof props['password'] === 'string' ? props['password'] : '',
    tls: props['tls'] === true,
    maxConnections: 1,
    idleTimeoutMs: TEST_TIMEOUT_MS,
    connectionTimeoutMs: TEST_TIMEOUT_MS,
    statementTimeoutMs: TEST_TIMEOUT_MS,
  });
  await pool.destroy();
  const latency = performance.now() - start;
  return created.ok
    ? successResult(`Database connected: ${host}:${port}/${database}`, latency)
    : failureResult(`Database connection failed: ${created.error.message}`, latency);
};

/** SMTP tester — verifies transport connectivity. */
const testSmtp: Tester = async (_mode, props) => {
  const host = requireString(props, 'host');
  const port = requireNumber(props, 'port');
  await assertHostAllowed(host);

  const start = performance.now();

  const transport = smtpTransportFactory({
    host,
    port,
    secure: props['secure'] === true,
    requireTLS: props['requireTLS'] === true,
    connectionTimeout: TEST_TIMEOUT_MS,
    // The connector's keys: a login only when authUser is set, as it sends mail.
    ...(typeof props['authUser'] === 'string' && props['authUser'] !== ''
      ? { auth: { user: props['authUser'], pass: typeof props['authPass'] === 'string' ? props['authPass'] : '' } }
      : {}),
  });

  try {
    await transport.verify();
    const latency = performance.now() - start;
    return successResult(`SMTP server verified: ${host}:${port}`, latency);
  } catch (err: unknown) {
    const latency = performance.now() - start;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return failureResult(`SMTP verification failed: ${msg}`, latency);
  } finally {
    transport.close();
  }
};

/** FHIR tester — fetches /metadata endpoint. */
const testFhir: Tester = async (_mode, props) => {
  const baseUrl = requireString(props, 'baseUrl');
  const parsed = new URL(baseUrl);
  await assertHostAllowed(parsed.hostname);

  const metadataUrl = baseUrl.replace(/\/+$/, '') + '/metadata';
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const response = await fetch(metadataUrl, {
      method: 'GET',
      headers: { Accept: 'application/fhir+json' },
      redirect: 'error',
      signal: controller.signal,
    });
    const latency = performance.now() - start;
    if (response.ok) {
      return successResult(`FHIR server responded: ${response.status}`, latency);
    }
    return failureResult(`FHIR server returned ${response.status}`, latency);
  } catch (err: unknown) {
    const latency = performance.now() - start;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return failureResult(`FHIR request failed: ${msg}`, latency);
  } finally {
    clearTimeout(timer);
  }
};

/** DICOM tester — verifies TCP connectivity to host:port. */
const testDicom: Tester = async (_mode, props) => {
  const host = requireString(props, 'host');
  const port = requireNumber(props, 'port');
  return testTcpConnect(host, port);
};

/** Channel tester — always succeeds (internal connector). */
const testChannel: Tester = async () => {
  return successResult('Channel connector is internal — always available', 0);
};

/** JavaScript tester — always succeeds (script-based connector). */
const testJavascript: Tester = async () => {
  return successResult('JavaScript connector is script-based — always available', 0);
};

/** Email (IMAP) tester — verifies TCP connectivity to IMAP host:port. */
const testEmail: Tester = async (_mode, props) => {
  const host = requireString(props, 'host');
  const port = requireNumber(props, 'port');
  return testTcpConnect(host, port);
};

/** An optional string property; undefined unless it is a non-empty string. */
function optionalString(props: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const val = props[key];
  return typeof val === 'string' && val.length > 0 ? val : undefined;
}

/**
 * SFTP connection options read as the registry's SFTP factories read them
 * (port 22 and host key checking on by default). Refuses settings the
 * connector could never connect with, before any network I/O.
 */
function readSftpOptions(props: Readonly<Record<string, unknown>>): SftpConnectionOptions {
  const options: SftpConnectionOptions = {
    host: requireString(props, 'host'),
    port: props['port'] === undefined || props['port'] === '' ? 22 : requireNumber(props, 'port'),
    username: requireString(props, 'username'),
    password: optionalString(props, 'password'),
    privateKey: optionalString(props, 'privateKey'),
    passphrase: optionalString(props, 'passphrase'),
    strictHostKey: props['strictHostKey'] !== false,
    hostKey: optionalString(props, 'hostKey'),
    // ssh2 waits 20 s for the handshake by default; give up when the test does.
    readyTimeoutMs: TEST_TIMEOUT_MS,
  };
  const authError = validateAuth(options);
  if (authError) throw new ServiceError('INVALID_INPUT', authError);
  if (options.strictHostKey && !options.hostKey?.trim()) {
    throw new ServiceError('INVALID_INPUT', 'Host key checking is on but no host key is set');
  }
  return options;
}

/** Close an SFTP session after a test. The result is already decided, so a failed or slow close does not change it. */
async function closeSftp(client: SftpClient): Promise<void> {
  try {
    await withTimeout(client.end(), SFTP_CLOSE_TIMEOUT_MS, 'SFTP close');
  } catch {
    // Nothing to report: the session either never opened or the server dropped it.
  }
}

/**
 * Start an SFTP connect and return it with a close that also covers a connect
 * still pending when the test gives up. ssh2-sftp-client's end() does nothing
 * while connect is pending, so a session that opens late is closed once it settles.
 */
function startSftpConnect(client: SftpClient): { readonly connecting: Promise<void>; close(): Promise<void> } {
  const connecting = client.connect();
  let settled = false;
  const whenSettled = connecting.then(() => { settled = true; }, () => { settled = true; });
  return {
    connecting,
    async close(): Promise<void> {
      if (settled) {
        await closeSftp(client);
        return;
      }
      void whenSettled.then(() => closeSftp(client));
    },
  };
}

/**
 * The result of an SFTP session that logged in. A regular file where the
 * remote directory should be fails both directions. A missing path fails a
 * source; a destination creates its directory on first send.
 */
function sftpPathResult(
  mode: string,
  kind: SftpPathKind,
  latency: number,
  where: { readonly target: string; readonly path: string },
): ConnectionTestResult {
  const { target, path } = where;
  if (kind === 'directory') return successResult(`SFTP connected: ${target}, remote directory ${path} found`, latency);
  if (kind === 'file') return failureResult(`SFTP connected to ${target} but remote path ${path} is a file, not a directory`, latency);
  if (mode === 'DESTINATION') {
    return successResult(`SFTP connected: ${target}, remote directory ${path} does not exist yet and will be created on first send`, latency);
  }
  return failureResult(`SFTP connected to ${target} but remote path ${path} was not found`, latency);
}

/**
 * SFTP tester: connect and log in with the configured credentials and host
 * key, check the remote path, then close. The connect and the check together
 * are bounded by the test timeout.
 */
const testSftp: Tester = async (mode, props) => {
  const options = readSftpOptions(props);
  const remoteDirectory = requireString(props, 'remoteDirectory');
  await assertHostAllowed(options.host);

  const start = performance.now();
  const target = `${options.host}:${String(options.port)}`;
  const client = sftpClientFactory(options);
  const session = startSftpConnect(client);
  try {
    const kind = await withTimeout(
      session.connecting.then(() => client.pathKind(remoteDirectory)),
      TEST_TIMEOUT_MS,
      'SFTP connection test',
    );
    return sftpPathResult(mode, kind, performance.now() - start, { target, path: remoteDirectory });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return failureResult(`SFTP connection failed: ${msg}`, performance.now() - start);
  } finally {
    await session.close();
  }
};

/** Parse props with a connector schema, failing as invalid input with the schema's reasons. */
function parseProps<S extends z.ZodType>(schema: S, props: unknown): z.output<S> {
  const parsed = schema.safeParse(props);
  if (!parsed.success) {
    throw new ServiceError('INVALID_INPUT', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return parsed.data;
}

/** Certificate ids swapped for PEM, as at deploy, then read the way the connector reads them. */
async function queueTls(props: Readonly<Record<string, unknown>>): Promise<ReturnType<typeof readQueueTls>> {
  const resolved = await resolveQueueTls(props);
  if (!resolved.ok) {
    throw new ServiceError('INVALID_INPUT', `TLS certificate resolution failed: ${resolved.error.message}`);
  }
  return readQueueTls(resolved.value);
}

/** Run a broker check under the test timeout and report it as a result. */
async function brokerCheck(label: string, check: () => Promise<string>): Promise<ConnectionTestResult> {
  const start = performance.now();
  try {
    const message = await withTimeout(check(), TEST_TIMEOUT_MS, `${label} connection test`);
    return successResult(message, performance.now() - start);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return failureResult(`${label} connection failed: ${msg}`, performance.now() - start);
  }
}

/**
 * Kafka tester: connect to the bootstrap brokers with the configured TLS and
 * SASL and read cluster metadata. A source, or a destination whose topic does
 * not vary per message, also checks that the topic exists.
 */
const testKafka: Tester = async (mode, props) => {
  const config = parseProps(mode === 'SOURCE' ? kafkaSourcePropertiesSchema : kafkaDestinationPropertiesSchema, props);
  for (const broker of config.brokers.split(',')) {
    await assertHostAllowed(broker.trim().replace(/:\d+$/, ''));
  }
  const tls = await queueTls(props);
  const topic = config.topic.includes('${') ? undefined : config.topic;
  return brokerCheck('Kafka', () => testKafkaConnection({ ...config, tls }, topic));
};

/**
 * AMQP tester: connect and log in with the configured TLS and credentials, then
 * check that the source's queue, or the destination's exchange, exists.
 */
const testAmqp: Tester = async (mode, props) => {
  const tls = await queueTls(props);
  if (mode === 'SOURCE') {
    const config = parseProps(amqpSourcePropertiesSchema, props);
    await assertHostAllowed(config.host);
    return brokerCheck('AMQP', () => testAmqpConnection({ ...config, tls }, { queue: config.queue }));
  }
  const config = parseProps(amqpDestinationPropertiesSchema, props);
  await assertHostAllowed(config.host);
  return brokerCheck('AMQP', () => testAmqpConnection({ ...config, tls }, { exchange: config.exchange }));
};

// ----- Tester Registry -----

const TESTERS: Readonly<Record<string, Tester>> = {
  TCP_MLLP: testTcpMllp,
  HTTP: testHttp,
  FILE: testFile,
  DATABASE: testDatabase,
  SMTP: testSmtp,
  FHIR: testFhir,
  DICOM: testDicom,
  CHANNEL: testChannel,
  JAVASCRIPT: testJavascript,
  EMAIL: testEmail,
  SFTP: testSftp,
  KAFKA: testKafka,
  AMQP: testAmqp,
};

// ----- Public API -----

export class ConnectionTestService {
  /** Test connectivity for a given connector type, mode, and properties. */
  static async testConnection(
    connectorType: string,
    mode: string,
    properties: Readonly<Record<string, unknown>>,
  ): Promise<Result<ConnectionTestResult>> {
    const tester = TESTERS[connectorType];

    if (!tester) {
      return {
        ok: false,
        value: null,
        error: stderr(new ServiceError(
          'INVALID_INPUT',
          `Unknown connector type: ${connectorType}`,
        )),
      };
    }

    try {
      const result = await tester(mode, properties);
      return { ok: true, value: result, error: null };
    } catch (err: unknown) {
      if (err instanceof ServiceError) {
        return {
          ok: false,
          value: null,
          error: stderr(err),
        };
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        ok: false,
        value: null,
        error: stderr(new ServiceError('INVALID_INPUT', message)),
      };
    }
  }
}

// ----- Test Helpers -----

/** Exported for testing only — not part of the public API. */
export const _testing = {
  assertHostAllowed,
  TEST_TIMEOUT_MS,
} as const;
