// ===========================================
// Global Scripts API Hooks
// ===========================================
// TanStack Query hooks for global scripts GET/PUT.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateGlobalScriptsInput } from '@mirthless/core-models';
import { api, type GlobalScriptsData } from '../api/client.js';

// ----- Query Keys -----

const GS_KEYS = {
  all: ['global-scripts'] as const,
} as const;

// ----- Hooks -----

export function useGlobalScripts(): ReturnType<typeof useQuery<GlobalScriptsData>> {
  return useQuery({
    queryKey: GS_KEYS.all,
    queryFn: async () => {
      const result = await api.get<GlobalScriptsData>('/global-scripts');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useUpdateGlobalScripts(): ReturnType<typeof useMutation<GlobalScriptsData, Error, UpdateGlobalScriptsInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateGlobalScriptsInput) => {
      const result = await api.put<GlobalScriptsData>('/global-scripts', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: GS_KEYS.all });
    },
  });
}
