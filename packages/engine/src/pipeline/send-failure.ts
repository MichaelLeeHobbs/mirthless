import type { Result } from '@galvanigraph/core-util';
import type { DestinationResponse } from './message-processor.js';

export function sendFailureReason(result: Result<DestinationResponse>): string {
  const reason = result.ok ? (result.value.errorMessage ?? result.value.content) : result.error.message;
  return reason.trim() === '' ? 'The destination reported a failure without a reason' : reason;
}
