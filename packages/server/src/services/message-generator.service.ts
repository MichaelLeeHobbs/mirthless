import { tryCatch, type Result } from 'stderr-lib';
import type { GenerateMessagesInput } from '@galvanigraph/core-models';
import { generateHL7Messages } from '@galvanigraph/core-util';

export interface GenerateResult {
  readonly messages: readonly string[];
}

export class MessageGeneratorService {
  static generate(input: GenerateMessagesInput): Result<GenerateResult> {
    return tryCatch(() => {
      const messages = generateHL7Messages({
        messageType: input.messageType,
        count: input.count,
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
      });
      return { messages };
    });
  }
}
