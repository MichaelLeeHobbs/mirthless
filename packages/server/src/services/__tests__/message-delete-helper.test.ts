// What the locks are worth shows only against Postgres (test/integration/delete-in-flight.itest.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Rows = readonly Record<string, unknown>[];
const mockExecute = vi.fn<() => Promise<{ rows: Rows }>>();
const mockTransaction = vi.fn(async (fn: (tx: { execute: typeof mockExecute }) => Promise<unknown>) => fn({ execute: mockExecute }));

vi.mock('../../lib/db.js', () => ({
  db: { transaction: mockTransaction },
}));

const { deleteMessagesByIds, DELETE_BATCH_SIZE, MESSAGE_CHILD_TABLES } = await import('../message-delete-helper.js');

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const FINISHED_ONLY = { unfinished: () => false, queued: true };
const DELETES = MESSAGE_CHILD_TABLES.length + 1;

/** In order: the locked messages, their locked connectors, how many connectors each has. */
function given(...answers: readonly Rows[]): void {
  mockExecute.mockReset();
  mockExecute.mockResolvedValue({ rows: [] });
  for (const rows of answers) mockExecute.mockResolvedValueOnce({ rows });
}

beforeEach(() => {
  vi.clearAllMocks();
  given();
});

describe('deleteMessagesByIds', () => {
  // An empty batch would render `IN ()`, a SQL syntax error.
  it('opens no transaction and runs no SQL for an empty id list', async () => {
    expect(await deleteMessagesByIds(CHANNEL_ID, [], FINISHED_ONLY)).toEqual({ deletedIds: [], unfinishedIds: [], refusedIds: [] });

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('splits ids into full batches plus a non-empty remainder', async () => {
    const ids = Array.from({ length: DELETE_BATCH_SIZE + 1 }, (_, i) => i + 1);

    await deleteMessagesByIds(CHANNEL_ID, ids, FINISHED_ONLY);

    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });

  it('deletes a message with all it has once it and all its connectors are locked', async () => {
    given([{ id: '1', processed: true }], [{ message_id: '1', status: 'SENT' }, { message_id: '1', status: 'SENT' }], [{ message_id: '1', n: 2 }]);

    expect(await deleteMessagesByIds(CHANNEL_ID, [1], FINISHED_ONLY)).toEqual({ deletedIds: [1], unfinishedIds: [], refusedIds: [] });
    expect(mockExecute).toHaveBeenCalledTimes(3 + DELETES);
  });

  it('refuses one with a connector that it could not lock, and deletes the other', async () => {
    given(
      [{ id: '1', processed: true }, { id: '2', processed: true }],
      [{ message_id: '1', status: 'SENT' }, { message_id: '2', status: 'SENT' }],
      [{ message_id: '1', n: 2 }, { message_id: '2', n: 1 }],
      ...Array.from({ length: DELETES }, () => []),
      [{ id: '1' }],
    );

    expect(await deleteMessagesByIds(CHANNEL_ID, [1, 2], FINISHED_ONLY)).toEqual({ deletedIds: [2], unfinishedIds: [], refusedIds: [1] });
  });

  it.each([
    ['was not processed', false, 'SENT'],
    ['waited on a queue', true, 'QUEUED'],
    ['was claimed by a queue', true, 'PENDING'],
  ])('names one that %s', async (_what, processed, status) => {
    given([{ id: '1', processed }], [{ message_id: '1', status }], [{ message_id: '1', n: 1 }]);

    expect(await deleteMessagesByIds(CHANNEL_ID, [1], { unfinished: () => true, queued: true })).toMatchObject({ deletedIds: [1], unfinishedIds: [1] });
  });

  it('deletes nothing unfinished when the channel came back while the rows were being locked', async () => {
    given([{ id: '1', processed: false }], [{ message_id: '1', status: 'RECEIVED' }], [{ message_id: '1', n: 1 }], [{ id: '1' }]);
    const unfinished = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(await deleteMessagesByIds(CHANNEL_ID, [1], { unfinished, queued: true })).toEqual({ deletedIds: [], unfinishedIds: [], refusedIds: [1] });
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });
});
