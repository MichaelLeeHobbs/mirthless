import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

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
  readonly audit: {
    /** Audit rows in the DEFAULT partition (counted up to 10,000); null when unknown. */
    readonly rowsOutsideMonths: number | null;
    /** Best-effort audit records the server failed to write since it started. */
    readonly lostRecords: number;
  };
}

const SYS_KEYS = {
  all: ['system-info'] as const,
  info: () => [...SYS_KEYS.all, 'info'] as const,
} as const;

/** Pass false when the data is not on screen, to stop the 10 s poll. */
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
