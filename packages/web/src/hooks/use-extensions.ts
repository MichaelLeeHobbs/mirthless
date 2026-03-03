// ===========================================
// Extension API Hooks
// ===========================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

// ----- Types -----

export interface ExtensionInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly type: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly capabilities: readonly string[];
}

// ----- Query Keys -----

const EXT_KEYS = {
  all: ['extensions'] as const,
  list: () => [...EXT_KEYS.all, 'list'] as const,
  detail: (id: string) => [...EXT_KEYS.all, 'detail', id] as const,
} as const;

// ----- Hooks -----

export function useExtensions(): ReturnType<typeof useQuery<readonly ExtensionInfo[]>> {
  return useQuery({
    queryKey: EXT_KEYS.list(),
    queryFn: async () => {
      const result = await api.get<readonly ExtensionInfo[]>('/extensions');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useExtension(id: string): ReturnType<typeof useQuery<ExtensionInfo>> {
  return useQuery({
    queryKey: EXT_KEYS.detail(id),
    queryFn: async () => {
      const result = await api.get<ExtensionInfo>(`/extensions/${id}`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: id.length > 0,
  });
}

export function useToggleExtension(): ReturnType<typeof useMutation<ExtensionInfo, Error, { id: string; enabled: boolean }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const result = await api.patch<ExtensionInfo>(`/extensions/${id}/enabled`, { enabled });
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: EXT_KEYS.all });
    },
  });
}
