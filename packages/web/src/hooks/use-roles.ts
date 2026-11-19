// D-310: the server refuses a role change that gives more than the editor
// holds, or deleting a role still assigned, and names what is in the way in `details`.

import { useQuery, useMutation, useQueryClient, type UseQueryResult, type UseMutationResult } from '@tanstack/react-query';
import type { CreateRoleInput, UpdateRoleInput } from '@galvanigraph/core-models';
import { api, type RoleSummary } from '../api/client.js';

const ROLE_KEYS = {
  all: ['roles'] as const,
  list: () => [...ROLE_KEYS.all, 'list'] as const,
} as const;

export class RoleRequestError extends Error {
  constructor(message: string, readonly code: string, readonly details: Record<string, unknown> | undefined) {
    super(message);
    this.name = 'RoleRequestError';
  }
}

/**
 * Why a delete was refused. The server names the holders, each assignment
 * once, to someone who may read users, and gives everyone else a count, which
 * its message already states. Expired assignments still keep a role in use.
 */
export function deleteRefusal(err: Pick<RoleRequestError, 'message' | 'details'>): string {
  const held = err.details?.['assignments'];
  if (!Array.isArray(held)) return err.message;
  const names = [...new Set(held.map((a) => (typeof a === 'object' && a !== null ? String((a as { username?: unknown }).username ?? '') : '')).filter(Boolean))];
  return names.length > 0 ? `${err.message}. Held by: ${names.join(', ')}.` : err.message;
}

function failure(error: { code: string; message: string; details?: unknown }): RoleRequestError {
  const details = typeof error.details === 'object' && error.details !== null ? error.details as Record<string, unknown> : undefined;
  return new RoleRequestError(error.message, error.code, details);
}

/** Pass `false` when the user may not read roles. */
export function useRoles(enabled = true): UseQueryResult<readonly RoleSummary[]> {
  return useQuery({
    queryKey: ROLE_KEYS.list(),
    queryFn: async () => {
      const result = await api.get<readonly RoleSummary[]>('/roles');
      if (!result.success) throw failure(result.error);
      return result.data;
    },
    enabled,
  });
}

export function useCreateRole(): UseMutationResult<RoleSummary, RoleRequestError, CreateRoleInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRoleInput) => {
      const result = await api.post<RoleSummary>('/roles', input);
      if (!result.success) throw failure(result.error);
      return result.data;
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ROLE_KEYS.all }); },
  });
}

export function useUpdateRole(): UseMutationResult<RoleSummary, RoleRequestError, { id: string; input: UpdateRoleInput }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateRoleInput }) => {
      const result = await api.put<RoleSummary>(`/roles/${id}`, input);
      if (!result.success) throw failure(result.error);
      return result.data;
    },
    onSuccess: async () => {
      // A role edit changes what its holders may do: the users list shows it too.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ROLE_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
      ]);
    },
  });
}

export function useDeleteRole(): UseMutationResult<void, RoleRequestError, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.delete<void>(`/roles/${id}`);
      if (!result.success) throw failure(result.error);
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ROLE_KEYS.all }); },
  });
}
