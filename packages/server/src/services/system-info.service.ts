// ===========================================
// System Info Service
// ===========================================
// Aggregates server version, Node.js version, OS info, memory,
// engine stats, and DB status into a single response.

import os from 'node:os';
import { tryCatch, type Result } from 'stderr-lib';
import { checkDatabase, getEngineStats, getMemoryStats } from './health.service.js';

// ----- Types -----

export interface SystemInfo {
  readonly server: {
    readonly version: string;
    readonly nodeVersion: string;
    readonly env: string;
    readonly pid: number;
    readonly uptime: number;
  };
  readonly os: {
    readonly platform: string;
    readonly arch: string;
    readonly totalMemory: number;
    readonly freeMemory: number;
  };
  readonly memory: {
    readonly rss: number;
    readonly heapUsed: number;
    readonly heapTotal: number;
    readonly external: number;
  };
  readonly engine: {
    readonly deployed: number;
    readonly started: number;
    readonly stopped: number;
    readonly paused: number;
  };
  readonly database: {
    readonly connected: boolean;
  };
}

// Server version read from package.json at import time
const SERVER_VERSION = '0.1.0';

// ----- Service -----

export class SystemInfoService {
  /** Get full system info. */
  static async getInfo(): Promise<Result<SystemInfo>> {
    return tryCatch(async () => {
      const dbConnected = await checkDatabase();
      const engineStats = getEngineStats();
      const memStats = getMemoryStats();

      return {
        server: {
          version: SERVER_VERSION,
          nodeVersion: process.version,
          env: process.env['NODE_ENV'] ?? 'development',
          pid: process.pid,
          uptime: process.uptime(),
        },
        os: {
          platform: os.platform(),
          arch: os.arch(),
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
        },
        memory: memStats,
        engine: engineStats,
        database: { connected: dbConnected },
      };
    });
  }
}
