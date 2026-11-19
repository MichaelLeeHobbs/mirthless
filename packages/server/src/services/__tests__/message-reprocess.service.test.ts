import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTxExecute = vi.fn();

vi.mock('../../lib/db.js', () => ({
  db: {
    select: vi.fn(),
    execute: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(async (fn: (tx: { execute: typeof mockTxExecute }) => Promise<void>) => {
      await fn({ execute: mockTxExecute });
    }),
  },
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

const mockGetRuntime = vi.fn();
vi.mock('../../engine.js', () => ({
  getEngine: () => ({ getRuntime: mockGetRuntime }),
}));

import { MessageReprocessService } from '../message-reprocess.service.js';
import { db } from '../../lib/db.js';

const mockSelect = vi.mocked(db.select);
const mockUpdate = vi.mocked(db.update);

function mockSelectSequence(...results: unknown[]): void {
  for (const r of results) {
    mockSelect.mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve(r) }) } as never);
  }
}

function deployedWithDests(state: string, destinations: { metaDataId: number; queueMode: string }[]) {
  return { runtime: { getState: () => state }, config: { destinations } };
}

function mockUpdateCapture(): { set: ReturnType<typeof vi.fn> } {
  const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  mockUpdate.mockReturnValue({ set } as never);
  return { set };
}

function deployedChannel(state: string, processMessage: ReturnType<typeof vi.fn>) {
  return { runtime: { getState: () => state }, processMessage };
}

function mockRawContent(content: string | null): void {
  const mockWhere = vi.fn().mockResolvedValue(content === null ? [] : [{ content }]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom } as never);
}

beforeEach(() => {
  mockSelect.mockReset();
  mockUpdate.mockReset();
  mockGetRuntime.mockReset();
  mockTxExecute.mockReset();
  mockTxExecute.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('MessageReprocessService.reprocessMessage', () => {
  it('re-injects raw content through the deployed channel and returns the new message id', async () => {
    mockRawContent('MSH|^~\\&|...');
    const processMessage = vi.fn().mockResolvedValue({ ok: true, value: { messageId: 42, status: 'PROCESSED' }, error: null });
    mockGetRuntime.mockReturnValue(deployedChannel('STARTED', processMessage));

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messageId).toBe(1);
      expect(result.value.newMessageId).toBe(42);
    }
    expect(processMessage).toHaveBeenCalledWith('MSH|^~\\&|...', { reprocessedFrom: 1 });
  });

  it('returns NOT_FOUND when no raw content exists', async () => {
    mockRawContent(null);

    const result = await MessageReprocessService.reprocessMessage('ch-001', 999);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    }
  });

  it('returns NOT_FOUND when content is null', async () => {
    mockRawContent(null);

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    }
  });

  it('returns CONFLICT when the channel is not deployed', async () => {
    mockRawContent('MSH|...');
    mockGetRuntime.mockReturnValue(undefined);

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    }
  });

  it('returns CONFLICT when the channel is deployed but not STARTED', async () => {
    mockRawContent('MSH|...');
    mockGetRuntime.mockReturnValue(deployedChannel('STOPPED', vi.fn()));

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    }
  });

  it('returns error when the pipeline rejects the re-injected message', async () => {
    mockRawContent('MSH|...');
    const processMessage = vi.fn().mockResolvedValue({ ok: false, value: null, error: { message: 'pipeline error' } });
    mockGetRuntime.mockReturnValue(deployedChannel('STARTED', processMessage));

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(false);
  });

  it('returns error on DB failure', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockRejectedValue(new Error('Timeout')),
    });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await MessageReprocessService.reprocessMessage('ch-001', 1);

    expect(result.ok).toBe(false);
  });
});

describe('MessageReprocessService.bulkDelete', () => {
  it('deletes messages in dependency order', async () => {
    const mockWhere = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await MessageReprocessService.bulkDelete('ch-001', [1, 2]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.deletedCount).toBe(2);
    }
    // 5 dependency-order deletes inside transaction
    expect(mockTxExecute).toHaveBeenCalledTimes(5);
  });

  it('returns NOT_FOUND when no messages match', async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await MessageReprocessService.bulkDelete('ch-001', [999]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    }
  });

  it('returns zero for empty messageIds array', async () => {
    const result = await MessageReprocessService.bulkDelete('ch-001', []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.deletedCount).toBe(0);
    }
  });

  it('handles partial match — only deletes existing messages', async () => {
    const mockWhere = vi.fn().mockResolvedValue([{ id: 1 }]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await MessageReprocessService.bulkDelete('ch-001', [1, 999]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.deletedCount).toBe(1);
    }
  });

  it('returns error on DB failure during delete', async () => {
    const mockWhere = vi.fn().mockResolvedValue([{ id: 1 }]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);
    mockTxExecute.mockRejectedValue(new Error('Connection lost'));

    const result = await MessageReprocessService.bulkDelete('ch-001', [1]);

    expect(result.ok).toBe(false);
  });
});

describe('MessageReprocessService.bulkReprocess', () => {
  it('reprocesses every message and returns per-item results', async () => {
    mockRawContent('MSH|raw');
    const processMessage = vi.fn().mockResolvedValue({ ok: true, value: { messageId: 100, status: 'PROCESSED' }, error: null });
    mockGetRuntime.mockReturnValue(deployedChannel('STARTED', processMessage));

    const result = await MessageReprocessService.bulkReprocess('ch-001', [1, 2]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requested).toBe(2);
    expect(result.value.reprocessed).toBe(2);
    expect(result.value.results).toHaveLength(2);
    expect(result.value.results[0]).toEqual({ messageId: 1, newMessageId: 100 });
  });

  it('records a per-item error without aborting the batch (partial success)', async () => {
    // First message has raw content; second does not (NOT_FOUND).
    mockSelectSequence([{ content: 'MSH|raw' }], []);
    const processMessage = vi.fn().mockResolvedValue({ ok: true, value: { messageId: 100, status: 'PROCESSED' }, error: null });
    mockGetRuntime.mockReturnValue(deployedChannel('STARTED', processMessage));

    const result = await MessageReprocessService.bulkReprocess('ch-001', [1, 999]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reprocessed).toBe(1);
    expect(result.value.results[0]).toHaveProperty('newMessageId', 100);
    expect(result.value.results[1]).toHaveProperty('error');
    expect(result.value.results[1]!.newMessageId).toBeUndefined();
  });

  it('returns CONFLICT up front when the channel is not deployed', async () => {
    mockGetRuntime.mockReturnValue(undefined);

    const result = await MessageReprocessService.bulkReprocess('ch-001', [1, 2]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveProperty('code', 'CONFLICT');
  });

  it('returns CONFLICT when the channel is not STARTED', async () => {
    mockGetRuntime.mockReturnValue(deployedChannel('PAUSED', vi.fn()));

    const result = await MessageReprocessService.bulkReprocess('ch-001', [1]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveProperty('code', 'CONFLICT');
  });
});

describe('MessageReprocessService.resendDestination', () => {
  it('re-enqueues a queue-enabled destination and returns QUEUED', async () => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ALWAYS' }]));
    mockSelectSequence([{ status: 'ERROR' }], [{ content: 'MSH|sent' }]);
    const { set } = mockUpdateCapture();

    const result = await MessageReprocessService.resendDestination('ch-001', 5, 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ messageId: 5, metaDataId: 1, status: 'QUEUED' });
    // Re-enqueued with a fresh retry budget.
    expect(set).toHaveBeenCalledWith({ status: 'QUEUED', sendAttempts: 0 });
  });

  it('returns CONFLICT when the channel is not deployed', async () => {
    mockGetRuntime.mockReturnValue(undefined);

    const result = await MessageReprocessService.resendDestination('ch-001', 5, 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveProperty('code', 'CONFLICT');
  });

  it('returns CONFLICT when the channel is not STARTED', async () => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STOPPED', [{ metaDataId: 1, queueMode: 'ALWAYS' }]));

    const result = await MessageReprocessService.resendDestination('ch-001', 5, 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveProperty('code', 'CONFLICT');
  });

  it('returns NOT_FOUND when the destination is not on the channel', async () => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ALWAYS' }]));

    const result = await MessageReprocessService.resendDestination('ch-001', 5, 99);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveProperty('code', 'NOT_FOUND');
  });

  it('returns CONFLICT when the destination is not queue-enabled', async () => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'NEVER' }]));

    const result = await MessageReprocessService.resendDestination('ch-001', 5, 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveProperty('code', 'CONFLICT');
  });

  it('returns NOT_FOUND when the connector message does not exist', async () => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ALWAYS' }]));
    mockSelectSequence([]);

    const result = await MessageReprocessService.resendDestination('ch-001', 5, 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveProperty('code', 'NOT_FOUND');
  });

  it('returns CONFLICT when there is no stored sent content', async () => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ALWAYS' }]));
    mockSelectSequence([{ status: 'SENT' }], [{ content: null }]);

    const result = await MessageReprocessService.resendDestination('ch-001', 5, 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveProperty('code', 'CONFLICT');
  });
});
