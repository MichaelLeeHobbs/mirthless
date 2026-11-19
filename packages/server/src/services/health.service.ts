import { sql } from 'drizzle-orm';
import { tryCatch } from 'stderr-lib';
import { db } from '../lib/db.js';
import { getEngine } from '../engine.js';
import { startupStatus, type StartupFailure, type StartupStepName } from '../lib/startup-steps.js';

export interface HealthStatus {
  readonly status: 'ok' | 'degraded';
  readonly timestamp: string;
  readonly uptime: number;
  readonly database: { readonly connected: boolean };
  readonly engine: {
    readonly deployed: number;
    readonly started: number;
    readonly stopped: number;
    readonly paused: number;
  };
  readonly memory: {
    readonly rss: number;
    readonly heapUsed: number;
    readonly heapTotal: number;
    readonly external: number;
  };
  readonly startup: { readonly failed: readonly StartupFailure[] };
}

export interface Readiness {
  readonly httpStatus: 200 | 503;
  readonly body: {
    readonly status: 'ok' | 'degraded' | 'unavailable';
    readonly database: { readonly connected: boolean };
    readonly startup: { readonly failedSteps: readonly StartupStepName[] };
  };
}

export interface EngineStats {
  readonly deployed: number;
  readonly started: number;
  readonly stopped: number;
  readonly paused: number;
}

export async function checkDatabase(): Promise<boolean> {
  const result = await tryCatch(async () => {
    await db.execute(sql`SELECT 1`);
  });
  return result.ok;
}

export function getEngineStats(): EngineStats {
  const engine = getEngine();
  const runtimes = engine.getAll();
  let started = 0;
  let stopped = 0;
  let paused = 0;
  for (const [, deployed] of runtimes) {
    const state = deployed.runtime.getState();
    if (state === 'STARTED') started++;
    else if (state === 'STOPPED') stopped++;
    else if (state === 'PAUSED') paused++;
  }
  return { deployed: runtimes.size, started, stopped, paused };
}

export function getMemoryStats(): HealthStatus['memory'] {
  const mem = process.memoryUsage();
  return {
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
  };
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const dbOk = await checkDatabase();
  const engineStats = getEngineStats();
  const memory = getMemoryStats();
  const failed = startupStatus.failed();
  return {
    status: dbOk && failed.length === 0 ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: { connected: dbOk },
    engine: engineStats,
    memory,
    startup: { failed },
  };
}

/**
 * For `/health` and `/health/full`. A failed startup step answers 200 `degraded`, so a load
 * balancer keeps the instance and its UI in rotation (D-308).
 */
export function healthHttpStatus(health: HealthStatus): 200 | 503 {
  return health.database.connected ? 200 : 503;
}

/**
 * A failed startup step answers 200 `degraded` (D-308): the server can still serve the UI an
 * operator needs to fix it. The public body carries step names only, never the error text.
 */
export async function getReadiness(): Promise<Readiness> {
  const dbOk = await checkDatabase();
  const failedSteps = startupStatus.failed().map((f) => f.step);
  if (!dbOk) {
    return { httpStatus: 503, body: { status: 'unavailable', database: { connected: false }, startup: { failedSteps } } };
  }
  const status = failedSteps.length === 0 ? 'ok' : 'degraded';
  return { httpStatus: 200, body: { status, database: { connected: true }, startup: { failedSteps } } };
}
