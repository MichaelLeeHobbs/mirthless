// ===========================================
// User API Hooks
// ===========================================
// TanStack Query hooks for user CRUD operations.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateUserInput, UpdateUserInput } from '@mirthless/core-models';
import { api, type UserSummary, type UserDetail } from '../api/client.js';

// ----- Query Keys -----

const USER_KEYS = {
  all: ['users'] as const,
  lists: () => [...USER_KEYS.all, 'list'] as const,
  details: () => [...USER_KEYS.all, 'detail'] as const,
  detail: (id: string) => [...USER_KEYS.details(), id] as const,
} as const;

// ----- Queries -----

/** Fetch all users. */
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

/** Fetch a single user's detail. */
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

// ----- Mutations -----

/** Create a new user. */
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

/** Update a user. */
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
      ]);
    },
  });
}

/** Delete (disable) a user. */
export function useDeleteUser(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.delete<void>(`/users/${id}`);
      if (!result.success) {
        throw new Error(result.error.message);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USER_KEYS.lists() });
    },
  });
}

/** Change a user's password. */
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

/** Unlock a locked user account. */
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
