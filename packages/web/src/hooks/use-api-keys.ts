// ===========================================
// API Key Hooks
// ===========================================
// TanStack Query hooks for API keys (D-313). An issue or a replace answers the
// key's token once; nothing else ever carries a secret.

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { ApiKeyView, ApiResponse, CreateApiKeyInput, IssuedApiKey } from '@galvanigraph/core-models';
import { api } from '../api/client.js';

const KEY_KEYS = { all: ['api-keys'] as const } as const;

/** Every API key, by name. Pass `enabled: false` when the user may not read keys. */
export function useApiKeys(enabled = true): UseQueryResult<readonly ApiKeyView[]> {
  return useQuery({
    queryKey: KEY_KEYS.all,
    queryFn: async () => {
      const result = await api.get<readonly ApiKeyView[]>('/api-keys');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled,
  });
}

/**
 * A key change that refreshes the list when it lands. An issue or a replace
 * answers a token, so its result is dropped from the mutation cache as soon as
 * nothing watches it (gcTime 0); the page also resets it once shown.
 */
function useKeyMutation<TInput, TResult>(send: (input: TInput) => Promise<TResult>): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    gcTime: 0,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: KEY_KEYS.all }); },
  });
}

async function unwrap<T>(answer: Promise<ApiResponse<T>>): Promise<T> {
  const result = await answer;
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

export function useIssueApiKey(): UseMutationResult<IssuedApiKey, Error, CreateApiKeyInput> {
  return useKeyMutation((input: CreateApiKeyInput) => unwrap(api.post<IssuedApiKey>('/api-keys', input)));
}

export function useReplaceApiKey(): UseMutationResult<IssuedApiKey, Error, { id: string; mode: 'leak' | 'planned' }> {
  return useKeyMutation(({ id, mode }: { id: string; mode: 'leak' | 'planned' }) => unwrap(api.post<IssuedApiKey>(`/api-keys/${id}/replace`, { mode })));
}

export function useSetApiKeyEnabled(): UseMutationResult<ApiKeyView, Error, { id: string; enabled: boolean }> {
  return useKeyMutation(({ id, enabled }: { id: string; enabled: boolean }) => unwrap(api.patch<ApiKeyView>(`/api-keys/${id}/enabled`, { enabled })));
}

export function useRevokeApiKey(): UseMutationResult<ApiKeyView, Error, { id: string; reason: string }> {
  return useKeyMutation(({ id, reason }: { id: string; reason: string }) => unwrap(api.post<ApiKeyView>(`/api-keys/${id}/revoke`, { reason })));
}
