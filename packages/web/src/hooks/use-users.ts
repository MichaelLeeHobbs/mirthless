import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateUserInput, TakenOverKey, UpdateUserInput } from '@galvanigraph/core-models';
import { api, type UserSummary, type UserDetail } from '../api/client.js';
import { API_KEYS_QUERY_KEY } from './use-api-keys.js';

const USER_KEYS = {
  all: ['users'] as const,
  lists: () => [...USER_KEYS.all, 'list'] as const,
  details: () => [...USER_KEYS.all, 'detail'] as const,
  detail: (id: string) => [...USER_KEYS.details(), id] as const,
} as const;

export function useUsers(): ReturnType<typeof useQuery<readonly UserSummary[]>> {
  return useQuery({
    queryKey: USER_KEYS.lists(),
    queryFn: async () => {
      const result = await api.get<readonly UserSummary[]>('/users');
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
  });
}

export function useUser(id: string | null): ReturnType<typeof useQuery<UserDetail>> {
  return useQuery({
    queryKey: USER_KEYS.detail(id ?? ''),
    queryFn: async () => {
      const result = await api.get<UserDetail>(`/users/${id!}`);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    enabled: id !== null,
  });
}

export function useCreateUser(): ReturnType<typeof useMutation<UserDetail, Error, CreateUserInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateUserInput) => {
      const result = await api.post<UserDetail>('/users', input);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USER_KEYS.lists() });
    },
  });
}

export function useUpdateUser(): ReturnType<typeof useMutation<UserDetail, Error, { id: string; input: UpdateUserInput }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateUserInput }) => {
      const result = await api.put<UserDetail>(`/users/${id}`, input);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: USER_KEYS.lists() }),
        queryClient.invalidateQueries({ queryKey: USER_KEYS.detail(variables.id) }),
        queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY }),
      ]);
    },
  });
}

/**
 * D-322: every working key the user issued is disabled with them, except those
 * in `takeOwnership`, whose new tokens come back once (gcTime 0 keeps them out
 * of the cache).
 */
export function useDeleteUser(): ReturnType<typeof useMutation<readonly TakenOverKey[], Error, { id: string; takeOwnership?: readonly string[] }>> {
  const queryClient = useQueryClient();

  return useMutation({
    gcTime: 0,
    mutationFn: async ({ id, takeOwnership = [] }: { id: string; takeOwnership?: readonly string[] }) => {
      const query = takeOwnership.length === 0 ? '' : `?takeOwnership=${takeOwnership.join(',')}`;
      const result = await api.delete<{ takenOver: readonly TakenOverKey[] } | undefined>(`/users/${id}${query}`);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data?.takenOver ?? [];
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: USER_KEYS.lists() }),
        queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY }),
      ]);
    },
  });
}

/** Needs no users:write. The server signs out the user's other sessions. */
export function useChangeOwnPassword(): ReturnType<typeof useMutation<void, Error, { currentPassword: string; newPassword: string }>> {
  return useMutation({
    mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
      const result = await api.post<void>('/users/me/password', { currentPassword, newPassword });
      if (!result.success) {
        throw new Error(result.error.message);
      }
    },
  });
}

export function useChangePassword(): ReturnType<typeof useMutation<void, Error, { id: string; newPassword: string }>> {
  return useMutation({
    mutationFn: async ({ id, newPassword }: { id: string; newPassword: string }) => {
      const result = await api.post<void>(`/users/${id}/password`, { newPassword });
      if (!result.success) {
        throw new Error(result.error.message);
      }
    },
  });
}

export function useUnlockUser(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.post<void>(`/users/${id}/unlock`, {});
      if (!result.success) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USER_KEYS.lists() });
    },
  });
}
