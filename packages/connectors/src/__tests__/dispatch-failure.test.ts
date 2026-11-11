// ===========================================
// dispatchFailure Tests
// ===========================================
// The one rule every source connector uses to decide whether a dispatched
// message may be reported as handled.

import { describe, it, expect } from 'vitest';
import type { Result } from '@galvaniflow/core-util';
import { dispatchFailure, DISPATCH_STATUS, type DispatchResult } from '../base.js';

function ok(value: DispatchResult): Result<DispatchResult> {
  return { ok: true, value, error: null };
}

describe('dispatchFailure', () => {
  it.each([
    ['no status (older callers)', { messageId: 1 }],
    ['PROCESSED', { messageId: 1, status: DISPATCH_STATUS.PROCESSED }],
    ['FILTERED', { messageId: 1, status: DISPATCH_STATUS.FILTERED }],
  ])('accepts a message with %s', (_name, value) => {
    expect(dispatchFailure(ok(value))).toBeNull();
  });

  it('reports a message the pipeline recorded with an error', () => {
    const failure = dispatchFailure(ok({ messageId: 42, status: DISPATCH_STATUS.ERROR }));
    expect(failure?.message).toBe('Message 42 was recorded with an ERROR status');
  });

  it('reports the pipeline error when the message could not be taken at all', () => {
    const error = new Error('database down');
    expect(dispatchFailure({ ok: false, value: null, error } as Result<DispatchResult>)).toBe(error);
  });
});
