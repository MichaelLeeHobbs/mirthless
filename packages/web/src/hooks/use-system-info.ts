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

// ----- Query Keys -----

const SYS_KEYS = {
  all: ['system-info'] as const,
  info: () => [...SYS_KEYS.all, 'info'] as const,
} as const;

// ----- Hooks -----

export function useSystemInfo(): ReturnType<typeof useQuery<SystemInfo>> {
  return useQuery({
    queryKey: SYS_KEYS.info(),
    queryFn: async () => {
      const result = await api.get<SystemInfo>('/system');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    refetchInterval: 10_000,
  });
}
