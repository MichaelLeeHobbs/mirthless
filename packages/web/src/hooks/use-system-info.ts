// ===========================================
// System Info API Hook
// ===========================================
// TanStack Query hook for system info with auto-refresh.

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

// ----- Types -----

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
    /** The V8 heap ceiling; the process runs out of memory near this. */
    readonly heapLimit: number;
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
    readonly latencyMs: number | null;
    readonly version: string | null;
    readonly sizeBytes: number | null;
  };
}

// ----- Query Keys -----

const SYS_KEYS = {
  all: ['system-info'] as const,
  info: () => [...SYS_KEYS.all, 'info'] as const,
} as const;

// ----- Hooks -----

/** Polls every 10 s while enabled; pass false to stop polling when the data isn't on screen. */
export function useSystemInfo(enabled = true): ReturnType<typeof useQuery<SystemInfo>> {
  return useQuery({
    enabled,
    queryKey: SYS_KEYS.info(),
    queryFn: async () => {
      const result = await api.get<SystemInfo>('/system');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    refetchInterval: 10_000,
  });
}
