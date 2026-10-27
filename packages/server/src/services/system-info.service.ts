// ===========================================
// System Info Service
// ===========================================
// Aggregates server version, Node.js version, host and OS info, memory,
// engine stats, and a database probe into a single response.

import os from 'node:os';
import v8 from 'node:v8';
import { sql } from 'drizzle-orm';
import { tryCatch, type Result } from 'stderr-lib';
import { db } from '../lib/db.js';
import { getEngineStats, getMemoryStats } from './health.service.js';

// ----- Types -----

export interface DatabaseProbe {
  readonly connected: boolean;
  /** Round trip of the probe query; null when the database is unreachable. */
  readonly latencyMs: number | null;
  /** PostgreSQL server_version; null when the database is unreachable. */
  readonly version: string | null;
  /** On-disk size of the current database; null when the database is unreachable. */
  readonly sizeBytes: number | null;
}

export interface SystemInfo {
  readonly server: {
    readonly version: string;
    readonly nodeVersion: string;
    readonly env: string;
    readonly pid: number;
    readonly uptime: number;
    readonly startedAt: string;
    readonly hostname: string;
  };
  readonly os: {
    readonly platform: string;
    readonly release: string;
    readonly arch: string;
    readonly cpus: number;
    /** 1, 5 and 15 minute load averages. Always zeros on Windows. */
    readonly loadAverage: readonly [number, number, number];
    readonly totalMemory: number;
    readonly freeMemory: number;
  };
  readonly memory: {
    readonly rss: number;
    readonly heapUsed: number;
    readonly heapTotal: number;
    /** The V8 heap ceiling; the process runs out of memory near this, not near heapTotal. */
    readonly heapLimit: number;
    readonly external: number;
  };
  readonly engine: {
    readonly deployed: number;
    readonly started: number;
    readonly stopped: number;
    readonly paused: number;
  };
  readonly database: DatabaseProbe;
}

// Server version read from package.json at import time
const SERVER_VERSION = '0.1.0';

const DISCONNECTED: DatabaseProbe = { connected: false, latencyMs: null, version: null, sizeBytes: null };

/** One round trip that proves the connection and reads the server version and database size. */
export async function probeDatabase(): Promise<DatabaseProbe> {
  const started = performance.now();
  const result = await tryCatch(async () => db.execute<{ version: string; size: string }>(sql`
    SELECT current_setting('server_version') AS version,
           pg_database_size(current_database())::text AS size
  `));
  if (!result.ok) return DISCONNECTED;
  const row = result.value.rows[0];
  return {
    connected: true,
    latencyMs: Math.round((performance.now() - started) * 10) / 10,
    version: row?.version ?? null,
    sizeBytes: row ? Number(row.size) : null,
  };
}

function loadAverage(): readonly [number, number, number] {
  const [one = 0, five = 0, fifteen = 0] = os.loadavg();
  return [one, five, fifteen];
}

// ----- Service -----

export class SystemInfoService {
  /** Get full system info. */
  static async getInfo(): Promise<Result<SystemInfo>> {
    return tryCatch(async () => {
      const database = await probeDatabase();
      const uptime = process.uptime();

      return {
        server: {
          version: SERVER_VERSION,
          nodeVersion: process.version,
          env: process.env['NODE_ENV'] ?? 'development',
          pid: process.pid,
          uptime,
          startedAt: new Date(Date.now() - uptime * 1000).toISOString(),
          hostname: os.hostname(),
        },
        os: {
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          cpus: os.availableParallelism(),
          loadAverage: loadAverage(),
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
        },
        memory: { ...getMemoryStats(), heapLimit: v8.getHeapStatistics().heap_size_limit },
        engine: getEngineStats(),
        database,
      };
    });
  }
}
