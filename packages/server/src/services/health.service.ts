// ===========================================
// Health Service
// ===========================================
// Provides health check logic for liveness, readiness,
// and full health status endpoints.

import { sql } from 'drizzle-orm';
import { tryCatch } from 'stderr-lib';
import { db } from '../lib/db.js';
import { getEngine } from '../engine.js';

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

/** Full health status check. */
export async function getHealthStatus(): Promise<HealthStatus> {
  const dbOk = await checkDatabase();
  const engineStats = getEngineStats();
  const memory = getMemoryStats();
  return {
    status: dbOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: { connected: dbOk },
    engine: engineStats,
    memory,
  };
}
