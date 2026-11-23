import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AssignmentInput, AssignmentView } from '@galvanigraph/core-models';
import { api } from '../api/client.js';
import { API_KEYS_QUERY_KEY } from './use-api-keys.js';

const ASSIGNMENT_KEYS = {
  all: ['assignments'] as const,
  user: (id: string) => [...ASSIGNMENT_KEYS.all, id] as const,
} as const;

/** Includes expired assignments. */
export function useAssignments(userId: string | null): ReturnType<typeof useQuery<readonly AssignmentView[]>> {
  return useQuery({
    queryKey: ASSIGNMENT_KEYS.user(userId ?? ''),
    queryFn: async () => {
      const result = await api.get<readonly AssignmentView[]>(`/users/${userId!}/assignments`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    enabled: userId !== null,
    // Always refetched when the dialog opens, which seeds its list only from fresh data.
    staleTime: 0,
  });
}

export function useSetAssignments(): ReturnType<typeof useMutation<readonly AssignmentView[], Error, { id: string; assignments: readonly AssignmentInput[] }>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, assignments }: { id: string; assignments: readonly AssignmentInput[] }) => {
      const result = await api.put<readonly AssignmentView[]>(`/users/${id}/assignments`, { assignments });
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async (data, variables) => {
      // The answer is the saved list, so the next open of this user starts from it.
      queryClient.setQueryData(ASSIGNMENT_KEYS.user(variables.id), data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ASSIGNMENT_KEYS.user(variables.id) }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY }),
      ]);
    },
  });
}
