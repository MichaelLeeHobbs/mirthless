// ===========================================
// Message Generator API Hook
// ===========================================

import { useMutation } from '@tanstack/react-query';
import type { GenerateMessagesInput } from '@mirthless/core-models';
import { api } from '../api/client.js';

interface GenerateResult {
  readonly messages: readonly string[];
}

export function useGenerateMessages(): ReturnType<typeof useMutation<GenerateResult, Error, GenerateMessagesInput>> {
  return useMutation({
    mutationFn: async (input: GenerateMessagesInput) => {
      const result = await api.post<GenerateResult>('/tools/messages', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}
