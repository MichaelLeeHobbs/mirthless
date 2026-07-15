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
import type { ConnectionTestResult } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { resolveHttpDestinationTls, resolveHttpSourceTls } from './connector-tls-resolver.js';

const nodeRequire = createRequire(import.meta.url);

// ----- Constants -----

const TEST_TIMEOUT_MS = 10_000;

// ----- Injectable Factories (for testing) -----

/** pg Pool interface. */
interface PgPool {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

/** pg Pool factory. */
type PoolFactory = (config: Record<string, unknown>) => PgPool;

/** nodemailer transport interface for verify. */
interface SmtpVerifyTransport {
  verify(): Promise<boolean>;
  close(): void;
}

/** nodemailer transport factory. */
type SmtpTransportFactory = (config: Record<string, unknown>) => SmtpVerifyTransport;

/** Default pg Pool factory. */
function defaultPoolFactory(config: Record<string, unknown>): PgPool {
  const pg = nodeRequire('pg') as { Pool: new (c: Record<string, unknown>) => PgPool };
  return new pg.Pool(config);
}

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

/** Override pool factory (for testing). */
export function setPoolFactory(factory: PoolFactory): void {
  poolFactory = factory;
}

/** Override SMTP transport factory (for testing). */
export function setSmtpTransportFactory(factory: SmtpTransportFactory): void {
  smtpTransportFactory = factory;
}

/** Reset factories to defaults (for testing). */
export function resetFactories(): void {
  poolFactory = defaultPoolFactory;
  smtpTransportFactory = defaultSmtpTransportFactory;
}

// ----- SSRF Protection -----

const BLOCKED_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fd/i,
  /^fe80:/i,
  /^localhost$/i,
] as const;

/** Check if a literal hostname string matches a blocked pattern (e.g. localhost). */
function isBlockedHost(hostname: string): boolean {
  return BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(hostname));
}

/** Check if a resolved IP address falls in a private/reserved range. */
function isBlockedIp(ip: string): boolean {
  // Strip IPv4-mapped IPv6 prefix so ::ffff:127.0.0.1 is checked as 127.0.0.1.
  const normalized = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  return BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(normalized) || pattern.test(ip));
}

/**
 * Full SSRF guard: reject literal private hostnames, literal private IPs, and —
 * critically — DNS names (or decimal/hex encodings) that RESOLVE to a private IP.
 * Unresolvable hosts are allowed through; the connection attempt itself will fail
 * loudly, which is not an SSRF exposure.
 */
async function assertHostAllowed(hostname: string): Promise<void> {
  if (isBlockedHost(hostname)) {
    throw new ServiceError('INVALID_INPUT', `Connection to ${hostname} is blocked (private/reserved address)`);
  }

  if (net.isIP(hostname) !== 0) {
    if (isBlockedIp(hostname)) {
      throw new ServiceError('INVALID_INPUT', `Connection to ${hostname} is blocked (private/reserved address)`);
    }
    return;
  }

  let addresses: readonly LookupAddress[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    return;
  }

  for (const addr of addresses) {
    if (isBlockedIp(addr.address)) {
      throw new ServiceError(
        'INVALID_INPUT',
        `Connection to ${hostname} is blocked (resolves to private/reserved address ${addr.address})`,
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

/** Database tester — connects via pg and runs SELECT 1. */
const testDatabase: Tester = async (_mode, props) => {
  const host = requireString(props, 'host');
  const port = requireNumber(props, 'port');
  const database = requireString(props, 'database');
  await assertHostAllowed(host);

  const start = performance.now();

  const pool = poolFactory({
    host,
    port,
    database,
    user: typeof props['user'] === 'string' ? props['user'] : undefined,
    password: typeof props['password'] === 'string' ? props['password'] : undefined,
    connectionTimeoutMillis: TEST_TIMEOUT_MS,
  });

  try {
    await pool.query('SELECT 1');
    const latency = performance.now() - start;
    return successResult(`Database connected: ${host}:${port}/${database}`, latency);
  } catch (err: unknown) {
    const latency = performance.now() - start;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return failureResult(`Database connection failed: ${msg}`, latency);
  } finally {
    await pool.end();
  }
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
    connectionTimeout: TEST_TIMEOUT_MS,
    ...(typeof props['user'] === 'string'
      ? { auth: { user: props['user'], pass: props['password'] } }
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
  isBlockedHost,
  isBlockedIp,
  assertHostAllowed,
  TEST_TIMEOUT_MS,
} as const;
