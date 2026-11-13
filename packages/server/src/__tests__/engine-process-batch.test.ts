// ===========================================
// Batch processing tests
// ===========================================
// processBatch runs each message of a batch through the channel and reports
// the batch as one outcome to the source connector.

import { describe, it, expect, vi } from 'vitest';
import { processBatch } from '../engine.js';

const ok = (messageId: number, status: 'PROCESSED' | 'ERROR' | 'FILTERED' = 'PROCESSED') =>
  ({ ok: true as const, value: { messageId, status }, error: null });

describe('processBatch', () => {
  it('processes every message in order and reports the last outcome', async () => {
    const seen: string[] = [];
    const result = await processBatch(() => ['a', 'b', 'c'], 'abc', async (part) => {
      seen.push(part);
      return ok(seen.length);
    });

    expect(seen).toEqual(['a', 'b', 'c']);
    expect(result).toEqual(ok(3));
  });

  it('keeps processing after a failed message and reports the first failure', async () => {
    const processOne = vi.fn()
      .mockResolvedValueOnce(ok(1))
      .mockResolvedValueOnce(ok(2, 'ERROR'))
      .mockResolvedValueOnce({ ok: false, value: null, error: new Error('store down') });

    const result = await processBatch(() => ['a', 'b', 'c'], 'abc', processOne);

    expect(processOne).toHaveBeenCalledTimes(3);
    expect(result).toEqual(ok(2, 'ERROR'));
  });

  it('reports an error, processing nothing, when the batch cannot be split or is empty', async () => {
    const processOne = vi.fn();

    const bad = await processBatch(() => { throw new Error('PID segment before its first MSH'); }, 'x', processOne);
    const empty = await processBatch(() => [], '', processOne);

    expect(bad.ok).toBe(false);
    expect(bad.error?.message).toContain('before its first MSH');
    expect(empty.error?.message).toContain('holds no messages');
    expect(processOne).not.toHaveBeenCalled();
  });
});
