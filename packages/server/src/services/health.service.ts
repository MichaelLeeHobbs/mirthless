// ===========================================
// Health Service
// ===========================================
// Provides health check logic for liveness, readiness,
// and full health status endpoints.

import { sql } from 'drizzle-orm';
import { tryCatch } from 'stderr-lib';
import { db } from '../lib/db.js';
import { getEngine } from '../engine.js';
import { startupStatus, type StartupFailure, type StartupStepName } from '../lib/startup-steps.js';

// ----- Types -----

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

/** What `/health/ready` answers: the HTTP status and the public body. */
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

// ----- Functions -----

/** Check database connectivity via SELECT 1. */
export async function checkDatabase(): Promise<boolean> {
  const result = await tryCatch(async () => {
    await db.execute(sql`SELECT 1`);
  });
  return result.ok;
}

/** Get engine deployment stats. */
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

/** Get memory usage stats. */
export function getMemoryStats(): HealthStatus['memory'] {
  const mem = process.memoryUsage();
  return {
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
  };
}

/** Full health status check. Degraded when the database is down or a startup step failed. */
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
 * Readiness for `/health/ready`: 503 while the database is unreachable.
 * A failed startup step makes it 200 `degraded`, naming the step (D-308):
 * the server can still serve the UI an operator needs to fix it, so it must
 * not be pulled out of a load balancer. The public body carries step names
 * only, never the error text.
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
