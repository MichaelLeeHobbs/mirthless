// #228: when the type checker itself fails (busy, overran, crashed), a deploy
// or save is refused as 503 with a "try again", not as a 500. The checker's
// worker thread is the boundary, so its answer is faked here.

import { describe, it, expect, vi } from 'vitest';
import { mapErrorToStatus, errorResponse } from '../../lib/controller-helpers.js';

const checker = vi.hoisted(() => ({ error: '' }));

vi.mock('@galvaniflow/engine', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  checkScriptTypesBatch: async () => ({ ok: false, value: null, error: new Error(checker.error) }),
}));

const { findTypeFailures } = await import('../script-type-gate.service.js');

const SCRIPT = { code: 'const n: number = 1;', surface: {}, segments: [{ typescript: true, label: 'Deploy script', startLine: 1 }] };

describe('findTypeFailures when the type checker fails', () => {
  it.each([
    ['The type checker is busy: 100 checks are waiting.', 'The type checker is busy: 100 checks are waiting.'],
    ['Type-checking took longer than 30000 ms and was stopped.', 'Type-checking took longer than 30000 ms and was stopped.'],
    ['The type checker failed: out of memory', 'The type checker failed: out of memory.'],
  ])('refuses as unavailable (503) and says to try again: %s', async (reason, said) => {
    checker.error = reason;
    const error = await findTypeFailures([SCRIPT] as never, []).then(() => undefined, (e: unknown) => e);
    expect(mapErrorToStatus(error)).toBe(503);
    expect(errorResponse(error)).toEqual({
      code: 'UNAVAILABLE',
      message: `Could not type-check the TypeScript scripts: ${said} Try again in a moment.`,
    });
  });
});
