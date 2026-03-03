// ===========================================
// Backup/Restore API Hooks
// ===========================================
// TanStack Query hooks for server backup and restore.

import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client.js';
import type { ServerRestoreResult } from '@mirthless/core-models';

// ----- Types -----

interface RestoreInput {
  readonly backup: unknown;
  readonly collisionMode: 'SKIP' | 'OVERWRITE';
}

// ----- Hooks -----

/** Download server backup as JSON blob. */
export function useBackup(): ReturnType<typeof useMutation<Blob, Error>> {
  return useMutation({
    mutationFn: async () => {
      const result = await api.get<unknown>('/system/backup');
      if (!result.success) throw new Error(result.error.message);
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      return blob;
    },
  });
}

/** Restore server from backup payload. */
export function useRestore(): ReturnType<typeof useMutation<ServerRestoreResult, Error, RestoreInput>> {
  return useMutation({
    mutationFn: async (input: RestoreInput) => {
      const result = await api.post<ServerRestoreResult>('/system/backup', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}
