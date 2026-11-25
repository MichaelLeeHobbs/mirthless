import * as net from 'node:net';
import * as https from 'node:https';
import * as dns from 'node:dns/promises';
import { type LookupAddress } from 'node:dns';
import * as fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { stderr, type Result } from 'stderr-lib';
import type { z } from 'zod/v4';
import type { ConnectionTestInput, ConnectionTestResult, DestinationConnectorType, SourceConnectorType } from '@galvanigraph/core-models';
import { isReservedAddress, isReservedHostname } from '@galvanigraph/engine';
import {
  testKafkaConnection,
  testAmqpConnection,
  readQueueTls,
  withTimeout,
  createPool,
  databaseTarget,
  toPoolConfig,
  createSsh2SftpClient,
  buildNodemailerOptions,
  smtpDispatcherConfig,
  resolveWithinRoots,
  type DatabasePool,
  type DatabaseVendor,
  type SftpClient,
  type SftpClientFactory,
  type SftpPathKind,
} from '@galvanigraph/connectors';
import { ServiceError } from '../lib/service-error.js';
import { buildFileRoots } from '../lib/file-roots.js';
import { config } from '../config/index.js';
import { resolveHttpDestinationTls, resolveHttpSourceTls, resolveQueueTls } from './connector-tls-resolver.js';
import { DEST_SCHEMAS, SOURCE_SCHEMAS, validateConnectorProperties } from './connector-validation.service.js';

const nodeRequire = createRequire(import.meta.url);

const TEST_TIMEOUT_MS = 10_000;
const SFTP_CLOSE_TIMEOUT_MS = 2_000;

/** `create` checks the connection. */
type TestPool = Pick<DatabasePool, 'create' | 'destroy'>;

/** The connectors' own pool, so the test speaks the same protocol as the connector. */
type PoolFactory = (vendor: DatabaseVendor) => TestPool;

interface SmtpVerifyTransport {
  verify(): Promise<boolean>;
  close(): void;
}

type SmtpTransportFactory = (config: Record<string, unknown>) => SmtpVerifyTransport;

const defaultPoolFactory: PoolFactory = createPool;

function defaultSmtpTransportFactory(config: Record<string, unknown>): SmtpVerifyTransport {
  const nodemailer = nodeRequire('nodemailer') as {
    createTransport: (opts: Record<string, unknown>) => SmtpVerifyTransport;
  };
  return nodemailer.createTransport(config);
}

let poolFactory: PoolFactory = defaultPoolFactory;
let smtpTransportFactory: SmtpTransportFactory = defaultSmtpTransportFactory;
let sftpClientFactory: SftpClientFactory = createSsh2SftpClient;

/** Tests only. */
export function setPoolFactory(factory: PoolFactory): void {
  poolFactory = factory;
}

/** Tests only. */
export function setSmtpTransportFactory(factory: SmtpTransportFactory): void {
  smtpTransportFactory = factory;
}

/** Tests only. */
export function setSftpClientFactory(factory: SftpClientFactory): void {
  sftpClientFactory = factory;
}

/** Tests only. */
export function resetFactories(): void {
  poolFactory = defaultPoolFactory;
  smtpTransportFactory = defaultSmtpTransportFactory;
  sftpClientFactory = createSsh2SftpClient;
}

/**
 * The ranges are the engine's (`sandbox/ssrf.ts`). Private networks are
 * allowed: the endpoints an administrator tests live there, and a deployed
 * channel reaches them anyway (D-262). An unresolvable host is let through: the
 * connection attempt itself fails loudly, which is not an SSRF exposure.
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

type Properties = Readonly<Record<string, unknown>>;
type Tester = (properties: Properties) => Promise<ConnectionTestResult>;

/** `run` gets the settings as a deploy reads them. */
function tester<S extends z.ZodType>(schema: S, run: (settings: z.output<S>) => Promise<ConnectionTestResult>): Tester {
  return (properties) => run(schema.parse(properties));
}

function successResult(message: string, latencyMs: number): ConnectionTestResult {
  return { success: true, message, latencyMs: Math.round(latencyMs * 100) / 100 };
}

function failureResult(message: string, latencyMs: number): ConnectionTestResult {
  return { success: false, message, latencyMs: Math.round(latencyMs * 100) / 100 };
}

interface Server {
  readonly host: string;
  readonly port: number;
}

/** The references of the configuration map are filled by now, so one that is left is filled per message. */
function hostnameOf(url: string, setting: string): string {
  const hostname = URL.canParse(url) ? new URL(url).hostname : '';
  if (hostname !== '' && !hostname.includes('${')) return hostname;
  throw new ServiceError('INVALID_INPUT', `${setting}: names no server, or one that is filled per message, so there is none to test`);
}

const testListener = async (): Promise<ConnectionTestResult> =>
  successResult('The settings are valid. A listener connects to nothing: its port is opened when the channel starts', 0);

async function testTcpConnect({ host, port }: Server): Promise<ConnectionTestResult> {
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

/**
 * A real TLS (or mTLS) handshake with the resolved certificates, so a passing
 * test reflects the ca/cert/key/rejectUnauthorized the connector will deploy with.
 */
async function testHttpsWithTls(url: string, props: Properties): Promise<ConnectionTestResult> {
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
 * An HTTPS listener has no outbound URL, so this runs a real loopback TLS
 * handshake with the resolved server cert and key. It fails on what would
 * otherwise surface only at deploy: an unresolvable certificate, no private
 * key, or a cert and key that do not pair.
 */
async function testHttpsSourceHandshake(props: Properties): Promise<ConnectionTestResult> {
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

async function testHttpDestination(settings: z.output<typeof DEST_SCHEMAS.HTTP>): Promise<ConnectionTestResult> {
  const { url, scheme } = settings;
  await assertHostAllowed(hostnameOf(url, 'url'));

  if (scheme === 'HTTPS') {
    return testHttpsWithTls(url, settings);
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
}

/**
 * A path outside FILE_CONNECTOR_ROOTS is refused before it is touched, so the
 * button cannot tell anyone what exists elsewhere on the server (D-315).
 */
async function testFile(directory: string, access: number): Promise<ConnectionTestResult> {
  const start = performance.now();

  try {
    const real = await resolveWithinRoots(directory, buildFileRoots(config.FILE_CONNECTOR_ROOTS));
    await fs.access(real, access);
    const latency = performance.now() - start;
    return successResult(`Path accessible: ${directory}`, latency);
  } catch (err: unknown) {
    const latency = performance.now() - start;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return failureResult(`Path not accessible: ${msg}`, latency);
  }
}

async function testDatabase(settings: z.output<typeof SOURCE_SCHEMAS.DATABASE> | z.output<typeof DEST_SCHEMAS.DATABASE>): Promise<ConnectionTestResult> {
  const { host, database } = settings;
  const { vendor, port } = databaseTarget(settings);
  await assertHostAllowed(host);

  const start = performance.now();
  const pool = poolFactory(vendor);
  const created = await pool.create({
    ...toPoolConfig({ ...settings, port }, TEST_TIMEOUT_MS),
    maxConnections: 1,
    idleTimeoutMs: TEST_TIMEOUT_MS,
    connectionTimeoutMs: TEST_TIMEOUT_MS,
  });
  await pool.destroy();
  const latency = performance.now() - start;
  return created.ok
    ? successResult(`Database connected: ${host}:${port}/${database}`, latency)
    : failureResult(`Database connection failed: ${created.error.message}`, latency);
}

async function testSmtp(settings: z.output<typeof DEST_SCHEMAS.SMTP>): Promise<ConnectionTestResult> {
  const { host, port } = settings;
  await assertHostAllowed(host);

  const start = performance.now();

  const transport = smtpTransportFactory({ ...buildNodemailerOptions(smtpDispatcherConfig(settings)), connectionTimeout: TEST_TIMEOUT_MS });

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
}

async function testFhir({ baseUrl }: z.output<typeof DEST_SCHEMAS.FHIR>): Promise<ConnectionTestResult> {
  await assertHostAllowed(hostnameOf(baseUrl, 'baseUrl'));

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
}

const testChannel = async (): Promise<ConnectionTestResult> => successResult('Channel connector is internal — always available', 0);

const testJavascript = async (): Promise<ConnectionTestResult> => successResult('JavaScript connector is script-based — always available', 0);

/** The result is already decided, so a failed or slow close does not change it. */
async function closeSftp(client: SftpClient): Promise<void> {
  try {
    await withTimeout(client.end(), SFTP_CLOSE_TIMEOUT_MS, 'SFTP close');
  } catch {
    // Nothing to report: the session either never opened or the server dropped it.
  }
}

function sftpPathResult(
  mode: ConnectionTestInput['mode'],
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

async function testSftp(
  mode: ConnectionTestInput['mode'],
  settings: z.output<typeof SOURCE_SCHEMAS.SFTP> | z.output<typeof DEST_SCHEMAS.SFTP>,
): Promise<ConnectionTestResult> {
  const { host, port, remoteDirectory } = settings;
  await assertHostAllowed(host);

  const start = performance.now();
  const target = `${host}:${String(port)}`;
  // The settings as the connector takes them. ssh2 waits 20 s for the handshake by default; give up when the test does.
  const client = sftpClientFactory({ ...settings, readyTimeoutMs: TEST_TIMEOUT_MS });
  try {
    const kind = await withTimeout(
      client.connect().then(() => client.pathKind(remoteDirectory)),
      TEST_TIMEOUT_MS,
      'SFTP connection test',
    );
    return sftpPathResult(mode, kind, performance.now() - start, { target, path: remoteDirectory });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return failureResult(`SFTP connection failed: ${msg}`, performance.now() - start);
  } finally {
    await closeSftp(client);
  }
}

async function queueTls(props: Properties): Promise<ReturnType<typeof readQueueTls>> {
  const resolved = await resolveQueueTls(props);
  if (!resolved.ok) {
    throw new ServiceError('INVALID_INPUT', `TLS certificate resolution failed: ${resolved.error.message}`);
  }
  return readQueueTls(resolved.value);
}

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

/** A topic that varies per message (`${...}`) is not checked. */
async function testKafka(settings: z.output<typeof SOURCE_SCHEMAS.KAFKA> | z.output<typeof DEST_SCHEMAS.KAFKA>): Promise<ConnectionTestResult> {
  for (const broker of settings.brokers.split(',')) {
    await assertHostAllowed(broker.trim().replace(/:\d+$/, ''));
  }
  const tls = await queueTls(settings);
  const topic = settings.topic.includes('${') ? undefined : settings.topic;
  return brokerCheck('Kafka', () => testKafkaConnection({ ...settings, tls }, topic));
}

async function testAmqp(
  settings: z.output<typeof SOURCE_SCHEMAS.AMQP> | z.output<typeof DEST_SCHEMAS.AMQP>,
  target: Parameters<typeof testAmqpConnection>[1],
): Promise<ConnectionTestResult> {
  const tls = await queueTls(settings);
  await assertHostAllowed(settings.host);
  return brokerCheck('AMQP', () => testAmqpConnection({ ...settings, tls }, target));
}

const SOURCE_TESTERS: Readonly<Record<SourceConnectorType, Tester>> = {
  TCP_MLLP: tester(SOURCE_SCHEMAS.TCP_MLLP, testListener),
  HTTP: tester(SOURCE_SCHEMAS.HTTP, (s) => (s.scheme === 'HTTPS' ? testHttpsSourceHandshake(s) : testListener())),
  FILE: tester(SOURCE_SCHEMAS.FILE, (s) => testFile(s.directory, fs.constants.R_OK)),
  DATABASE: tester(SOURCE_SCHEMAS.DATABASE, testDatabase),
  JAVASCRIPT: tester(SOURCE_SCHEMAS.JAVASCRIPT, testJavascript),
  CHANNEL: tester(SOURCE_SCHEMAS.CHANNEL, testChannel),
  DICOM: tester(SOURCE_SCHEMAS.DICOM, testListener),
  EMAIL: tester(SOURCE_SCHEMAS.EMAIL, testTcpConnect),
  SFTP: tester(SOURCE_SCHEMAS.SFTP, (s) => testSftp('SOURCE', s)),
  KAFKA: tester(SOURCE_SCHEMAS.KAFKA, testKafka),
  AMQP: tester(SOURCE_SCHEMAS.AMQP, (s) => testAmqp(s, { queue: s.queue })),
};

const DEST_TESTERS: Readonly<Record<DestinationConnectorType, Tester>> = {
  TCP_MLLP: tester(DEST_SCHEMAS.TCP_MLLP, testTcpConnect),
  HTTP: tester(DEST_SCHEMAS.HTTP, testHttpDestination),
  FILE: tester(DEST_SCHEMAS.FILE, (s) => testFile(s.directory, fs.constants.R_OK | fs.constants.W_OK)),
  DATABASE: tester(DEST_SCHEMAS.DATABASE, testDatabase),
  JAVASCRIPT: tester(DEST_SCHEMAS.JAVASCRIPT, testJavascript),
  SMTP: tester(DEST_SCHEMAS.SMTP, testSmtp),
  CHANNEL: tester(DEST_SCHEMAS.CHANNEL, testChannel),
  FHIR: tester(DEST_SCHEMAS.FHIR, testFhir),
  DICOM: tester(DEST_SCHEMAS.DICOM, testTcpConnect),
  SFTP: tester(DEST_SCHEMAS.SFTP, (s) => testSftp('DESTINATION', s)),
  KAFKA: tester(DEST_SCHEMAS.KAFKA, testKafka),
  AMQP: tester(DEST_SCHEMAS.AMQP, (s) => testAmqp(s, { exchange: s.exchange })),
};

export class ConnectionTestService {
  /** Refuses what a deploy refuses, and then connects. The references of the configuration map are filled before. */
  static async testConnection(
    connectorType: string,
    mode: ConnectionTestInput['mode'],
    given: Properties,
  ): Promise<Result<ConnectionTestResult>> {
    // A deploy gives a Channel Reader its own channel's id, which a new channel has not got.
    const properties = connectorType === 'CHANNEL' && mode === 'SOURCE' ? { ...given, channelId: 'this channel' } : { ...given };
    const valid = validateConnectorProperties(connectorType, mode === 'SOURCE' ? 'source' : 'destination', properties);
    if (!valid.ok) return valid;
    const testers: Readonly<Record<string, Tester>> = mode === 'SOURCE' ? SOURCE_TESTERS : DEST_TESTERS;

    try {
      const result = await testers[connectorType]!(properties);
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

/** Tests only. */
export const _testing = {
  assertHostAllowed,
  TEST_TIMEOUT_MS,
} as const;
