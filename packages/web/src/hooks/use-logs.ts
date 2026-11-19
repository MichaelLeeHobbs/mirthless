import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, useCallback } from 'react';
import { SOCKET_EVENT } from '@galvanigraph/core-models';
import { api } from '../api/client.js';
import { useSocketRoom, useSocketEvent } from './use-socket.js';

export interface LogEntry {
  readonly timestamp: string;
  readonly level: number;
  readonly levelLabel: string;
  readonly logger: string;
  readonly message: string;
}

interface LogQueryResult {
  readonly entries: readonly LogEntry[];
  readonly total: number;
}

const LOG_KEYS = {
  all: ['logs'] as const,
  entries: (params: Record<string, unknown>) => [...LOG_KEYS.all, 'entries', params] as const,
} as const;

export function useHistoricalLogs(params: { level?: number; search?: string; limit?: number }): ReturnType<typeof useQuery<LogQueryResult>> {
  return useQuery({
    queryKey: LOG_KEYS.entries(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params.level !== undefined) searchParams.set('level', String(params.level));
      if (params.search) searchParams.set('search', params.search);
      if (params.limit !== undefined) searchParams.set('limit', String(params.limit));

      const qs = searchParams.toString();
      const path = qs ? `/system/logs?${qs}` : '/system/logs';
      const result = await api.get<LogQueryResult>(path);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useLogStream(maxEntries: number = 10_000): {
  readonly entries: readonly LogEntry[];
  readonly paused: boolean;
  readonly setPaused: (paused: boolean) => void;
  readonly clear: () => void;
} {
  const [entries, setEntries] = useState<readonly LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const bufferRef = useRef<LogEntry[]>([]);

  useSocketRoom('join:logs', 'leave:logs');

  const handleLog = useCallback((entry: LogEntry) => {
    if (paused) {
      bufferRef.current.push(entry);
      return;
    }

    setEntries((prev) => {
      const next = [entry, ...prev];
      if (next.length > maxEntries) {
        return next.slice(0, maxEntries);
      }
      return next;
    });
  }, [paused, maxEntries]);

  useSocketEvent<LogEntry>(SOCKET_EVENT.SERVER_LOG, handleLog);

  useEffect(() => {
    if (!paused && bufferRef.current.length > 0) {
      const buffered = bufferRef.current;
      bufferRef.current = [];
      setEntries((prev) => {
        const next = [...buffered.reverse(), ...prev];
        if (next.length > maxEntries) {
          return next.slice(0, maxEntries);
        }
        return next;
      });
    }
  }, [paused, maxEntries]);

  const clear = useCallback(() => {
    setEntries([]);
    bufferRef.current = [];
  }, []);

  return { entries, paused, setPaused, clear };
}
