// ===========================================
// Connection Test Hook
// ===========================================
// Mutation hook for testing connector connectivity.

import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client.js';

interface ConnectionTestInput {
  readonly connectorType: string;
  readonly mode: 'SOURCE' | 'DESTINATION';
  readonly properties: Record<string, unknown>;
}

interface ConnectionTestResult {
  readonly success: boolean;
  readonly message: string;
  readonly latencyMs: number;
}

/** Test a connector's connection settings. */
export function useTestConnection(): ReturnType<typeof useMutation<ConnectionTestResult, Error, ConnectionTestInput>> {
  return useMutation({
    mutationFn: async (input: ConnectionTestInput) => {
      const result = await api.post<ConnectionTestResult>('/connectors/test', input);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
  });
}
