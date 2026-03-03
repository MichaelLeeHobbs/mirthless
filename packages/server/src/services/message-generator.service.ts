// ===========================================
// Message Generator Service
// ===========================================
// Generates HL7v2 test messages.

import { tryCatch, type Result } from 'stderr-lib';
import type { GenerateMessagesInput } from '@mirthless/core-models';
import { generateHL7Messages } from '@mirthless/core-util';

// ----- Response Types -----

export interface GenerateResult {
  readonly messages: readonly string[];
}

// ----- Service -----

export class MessageGeneratorService {
  /** Generate HL7v2 test messages. */
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
