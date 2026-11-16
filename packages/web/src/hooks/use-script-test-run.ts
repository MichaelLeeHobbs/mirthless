// ===========================================
// Script test run hook
// ===========================================
// POST /scripts/test-run: run a script against a sample message, no side effects.

import { useMutation } from '@tanstack/react-query';
import type { ScriptTestResult, ScriptTestRunInput } from '@galvanigraph/core-models';
import { api } from '../api/client.js';

/** The request as the client sends it; the server fills defaults. */
export type ScriptTestRunRequest = Omit<ScriptTestRunInput, 'destinationSet'> & { readonly destinationSet?: boolean };

export function useScriptTestRun(): ReturnType<typeof useMutation<ScriptTestResult, Error, ScriptTestRunRequest>> {
  return useMutation({
    mutationFn: async (input: ScriptTestRunRequest) => {
      const result = await api.post<ScriptTestResult>('/scripts/test-run', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}
