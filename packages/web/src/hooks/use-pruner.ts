// ===========================================
// Pruner Scheduler API Hooks
// ===========================================
// TanStack Query hooks for data pruner scheduling.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

// ----- Types -----

interface PrunerScheduleStatus {
  readonly enabled: boolean;
  readonly cronExpression: string;
  readonly lastRunAt: string | null;
  readonly lastRunResult: {
    readonly channelsPruned: number;
    readonly totalDeleted: number;
    readonly completedAt: string;
  } | null;
}

interface UpdatePrunerScheduleInput {
  readonly enabled: boolean;
  readonly cronExpression: string;
}

interface PruneAllResult {
  readonly channelsPruned: number;
  readonly totalDeleted: number;
}

// ----- Query Keys -----

const PRUNER_KEYS = {
  all: ['pruner'] as const,
  status: () => [...PRUNER_KEYS.all, 'status'] as const,
} as const;

// ----- Hooks -----

export function usePrunerStatus(): ReturnType<typeof useQuery<PrunerScheduleStatus>> {
  return useQuery({
    queryKey: PRUNER_KEYS.status(),
    queryFn: async () => {
      const result = await api.get<PrunerScheduleStatus>('/admin/prune/schedule');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    refetchInterval: 30_000,
  });
}

export function useUpdatePrunerSchedule(): ReturnType<typeof useMutation<PrunerScheduleStatus, Error, UpdatePrunerScheduleInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdatePrunerScheduleInput) => {
      const result = await api.put<PrunerScheduleStatus>('/admin/prune/schedule', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PRUNER_KEYS.all });
    },
  });
}

export function useRunPrunerNow(): ReturnType<typeof useMutation<PruneAllResult, Error>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result = await api.post<PruneAllResult>('/admin/prune', {});
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PRUNER_KEYS.all });
    },
  });
}
