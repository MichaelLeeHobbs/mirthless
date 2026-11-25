import { describe, it, expect, vi } from 'vitest';
import { batchRulesFor, processBatch, type BatchRun } from '../engine.js';

const ok = (messageId: number, status: 'PROCESSED' | 'ERROR' | 'FILTERED' = 'PROCESSED') =>
  ({ ok: true as const, value: { messageId, status }, error: null });
const notRecorded = { ok: false as const, value: null, error: new Error('store down') };

const PARTS = ['a', 'b', 'c'];

function run(overrides: Partial<BatchRun>): BatchRun {
  return { offeredOnce: false, storesPlainText: true, split: () => PARTS, processOne: async () => ok(1), ...overrides };
}

/** Plays the outcomes in order, one per message. */
function playing(...outcomes: readonly unknown[]): { readonly processOne: BatchRun['processOne']; readonly seen: string[] } {
  const seen: string[] = [];
  const processOne = async (part: string): Promise<never> => {
    seen.push(part);
    return outcomes[seen.length - 1] as never;
  };
  return { processOne, seen };
}

describe('processBatch', () => {
  it('processes every message in order and reports the last outcome', async () => {
    const { processOne, seen } = playing(ok(1), ok(2), ok(3));

    expect(await processBatch('abc', run({ processOne }))).toEqual(ok(3));
    expect(seen).toEqual(PARTS);
  });

  it('keeps processing after a message recorded with an error, and reports the first', async () => {
    const { processOne, seen } = playing(ok(1), ok(2, 'ERROR'), ok(3, 'ERROR'));

    expect(await processBatch('abc', run({ processOne }))).toEqual(ok(2, 'ERROR'));
    expect(seen).toEqual(PARTS);
  });

  it('is not taken when a message was not recorded, although one before it was recorded with an error (#415)', async () => {
    const { processOne } = playing(ok(1), ok(2, 'ERROR'), notRecorded);

    const result = await processBatch('abc', run({ processOne }));

    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe('Message 3 of 3 in the batch was not recorded: store down');
  });

  it('runs no message after one that was not recorded, so that they keep their order when the batch is offered again', async () => {
    const { processOne, seen } = playing(ok(1), notRecorded, ok(3));

    const result = await processBatch('abc', run({ processOne }));

    expect(result.error?.message).toBe('Message 2 of 3 in the batch was not recorded: store down');
    expect(seen).toEqual(['a', 'b']);
  });

  it('runs every message for a source that never offers its input again, and names the first that was not recorded', async () => {
    const { processOne, seen } = playing(notRecorded, ok(2, 'ERROR'), ok(3));

    const result = await processBatch('abc', run({ offeredOnce: true, processOne }));

    expect(result.error?.message).toBe('Message 1 of 3 in the batch was not recorded: store down');
    expect(seen).toEqual(PARTS);
  });

  it('reports an error, processing nothing, when the batch cannot be split or is empty', async () => {
    const processOne = vi.fn();

    const bad = await processBatch('x', run({ processOne, split: () => { throw new Error('PID segment before its first MSH'); } }));
    const empty = await processBatch('', run({ processOne, split: () => [] }));

    expect(bad.ok).toBe(false);
    expect(bad.error?.message).toContain('before its first MSH');
    expect(empty.error?.message).toContain('holds no messages');
    expect(processOne).not.toHaveBeenCalled();
  });
});

describe('processBatch with a message that can never be recorded', () => {
  const split = (): string[] => ['a', 'b\u0000', 'c'];

  it('takes nothing of the batch, or the messages before it would be sent again at every offer', async () => {
    const processOne = vi.fn();

    const result = await processBatch('x', run({ split, processOne }));

    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe('Message 2 of 3 in the batch holds U+0000, which the message store cannot hold as plain text; none of the batch was processed');
    expect(processOne).not.toHaveBeenCalled();
  });

  it.each([
    ['the channel does not store it as plain text', { storesPlainText: false }],
    ['the source never offers it again', { offeredOnce: true }],
  ])('runs every message when %s', async (_why, rules) => {
    const { processOne, seen } = playing(ok(1), ok(2), ok(3));

    expect(await processBatch('x', run({ ...rules, split, processOne }))).toEqual(ok(3));
    expect(seen).toEqual(['a', 'b\u0000', 'c']);
  });
});

describe('batchRulesFor', () => {
  it.each([
    ['TCP_MLLP', false, 'DEVELOPMENT', { offeredOnce: false, storesPlainText: true }],
    ['FILE', true, 'DEVELOPMENT', { offeredOnce: false, storesPlainText: false }],
    ['FILE', false, 'RAW', { offeredOnce: false, storesPlainText: true }],
    ['FILE', false, 'METADATA', { offeredOnce: false, storesPlainText: false }],
    ['JAVASCRIPT', false, 'PRODUCTION', { offeredOnce: true, storesPlainText: true }],
  ] as const)('%s, encrypted %s, storage %s', (sourceConnectorType, encryptData, messageStorageMode, rules) => {
    expect(batchRulesFor({ sourceConnectorType, encryptData, messageStorageMode })).toEqual(rules);
  });
});
