import os from 'node:os';
import v8 from 'node:v8';
import { sql } from 'drizzle-orm';
import { tryCatch, type Result } from 'stderr-lib';
import { db } from '../lib/db.js';
import { getEngineStats, getMemoryStats } from './health.service.js';
import { lostAuditRecordCount } from '../lib/event-emitter.js';

export interface DatabaseProbe {
  readonly connected: boolean;
  readonly latencyMs: number | null;
  readonly version: string | null;
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
    /** Always zeros on Windows. */
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
  readonly audit: {
    /**
     * Rows in audit_log's DEFAULT partition, counted up to 10,000. Above 0, that
     * month's partition cannot be created until they are moved (docs/ops/audit-log.md).
     */
    readonly rowsOutsideMonths: number | null;
    /** Best-effort audit records this process failed to write since it started (D-312). */
    readonly lostRecords: number;
  };
}

// Server version read from package.json at import time
const SERVER_VERSION = '0.1.0';

const DISCONNECTED: DatabaseProbe = { connected: false, latencyMs: null, version: null, sizeBytes: null };

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

async function auditRowsOutsideMonths(): Promise<number | null> {
  const result = await tryCatch(async () => db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM (SELECT 1 FROM public.audit_log_default LIMIT 10000) AS d
  `));
  return result.ok ? (result.value.rows[0]?.n ?? null) : null;
}

function loadAverage(): readonly [number, number, number] {
  const [one = 0, five = 0, fifteen = 0] = os.loadavg();
  return [one, five, fifteen];
}

export class SystemInfoService {
  static async getInfo(): Promise<Result<SystemInfo>> {
    return tryCatch(async () => {
      const [database, rowsOutsideMonths] = await Promise.all([probeDatabase(), auditRowsOutsideMonths()]);
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
        audit: { rowsOutsideMonths, lostRecords: lostAuditRecordCount() },
      };
    });
  }
}
