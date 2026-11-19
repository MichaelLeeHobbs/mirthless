import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client.js';
import type { ServerRestoreResult } from '@galvanigraph/core-models';

interface RestoreInput {
  readonly backup: unknown;
  readonly collisionMode: 'SKIP' | 'OVERWRITE';
}

export function useBackup(): ReturnType<typeof useMutation<Blob, Error, string>> {
  return useMutation({
    /** The server records `reason` in the audit log and the file's exportInfo. */
    mutationFn: async (reason: string) => {
      const result = await api.get<unknown>(`/system/backup?reason=${encodeURIComponent(reason)}`);
      if (!result.success) throw new Error(result.error.message);
      // The server records the SHA-256 of exactly this text in the audit log
      // (server-backup.service.ts): keep the two-space indent in step with it.
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      return blob;
    },
  });
}

export function useRestore(): ReturnType<typeof useMutation<ServerRestoreResult, Error, RestoreInput>> {
  return useMutation({
    mutationFn: async (input: RestoreInput) => {
      const result = await api.post<ServerRestoreResult>('/system/backup', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}
