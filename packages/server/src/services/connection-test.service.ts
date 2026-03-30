// ===========================================
// Connection Test Service
// ===========================================
// Stateless connector connectivity testers. Each connector type has a
// dedicated tester that verifies the target is reachable. All testers
// enforce a 10-second timeout via AbortController and measure latency.
// Returns Result<ConnectionTestResult> — never throws.

import * as net from 'node:net';
import * as fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { stderr, type Result } from 'stderr-lib';
import type { ConnectionTestResult } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';

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

/** Check if a hostname resolves to a private/reserved IP range. */
function isBlockedHost(hostname: string): boolean {
  return BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(hostname));
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

/** Validate hostname is not a blocked (SSRF) address. */
function assertNotBlocked(hostname: string): void {
  if (isBlockedHost(hostname)) {
    throw new ServiceError(
      'INVALID_INPUT',
      `Connection to ${hostname} is blocked (private/reserved address)`,
    );
  }
}

// ----- Individual Testers -----

/** Test TCP connectivity to host:port (used for TCP_MLLP and DICOM). */
async function testTcpConnect(host: string, port: number): Promise<ConnectionTestResult> {
  assertNotBlocked(host);
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

/** HTTP tester — sends HEAD request to URL. */
const testHttp: Tester = async (_mode, props) => {
  const url = requireString(props, 'url');
  const parsed = new URL(url);
  assertNotBlocked(parsed.hostname);

  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
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
  assertNotBlocked(host);

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
  assertNotBlocked(host);

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
  assertNotBlocked(parsed.hostname);

  const metadataUrl = baseUrl.replace(/\/+$/, '') + '/metadata';
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const response = await fetch(metadataUrl, {
      method: 'GET',
      headers: { Accept: 'application/fhir+json' },
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
  TEST_TIMEOUT_MS,
} as const;
