// ===========================================
// Message Delete Helper Tests
// ===========================================
// An empty id batch would render `IN ()`, a SQL syntax error, so no batch may
// ever be empty.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockTransaction = vi.fn(async (fn: (tx: { execute: typeof mockExecute }) => Promise<void>) => fn({ execute: mockExecute }));

vi.mock('../../lib/db.js', () => ({
  db: { transaction: mockTransaction },
}));

const { deleteMessagesByIds, DELETE_BATCH_SIZE } = await import('../message-delete-helper.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('deleteMessagesByIds', () => {
  it('opens no transaction and runs no SQL for an empty id list', async () => {
    await deleteMessagesByIds('00000000-0000-0000-0000-000000000001', []);

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('splits ids into full batches plus a non-empty remainder', async () => {
    const ids = Array.from({ length: DELETE_BATCH_SIZE + 1 }, (_, i) => i + 1);

    await deleteMessagesByIds('00000000-0000-0000-0000-000000000001', ids);

    // One transaction per batch, five DELETEs (four child tables + messages) each.
    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(mockExecute).toHaveBeenCalledTimes(10);
  });
});
