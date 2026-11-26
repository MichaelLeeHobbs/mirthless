import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/db.js', () => {
  const db: Record<string, unknown> = { select: vi.fn(), execute: vi.fn(), update: vi.fn(), delete: vi.fn() };
  db['transaction'] = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(db));
  return { db };
});

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

const mockGetRuntime = vi.fn();
const mockIsAtRest = vi.fn();
vi.mock('../../engine.js', () => ({
  getEngine: () => ({ getRuntime: mockGetRuntime, isAtRest: mockIsAtRest }),
}));

const mockDeleteMessagesByIds = vi.fn();
vi.mock('../message-delete-helper.js', () => ({
  deleteMessagesByIds: (...args: unknown[]): unknown => mockDeleteMessagesByIds(...args),
}));

import { MessageReprocessService } from '../message-reprocess.service.js';
import { db } from '../../lib/db.js';
import { emitEvent } from '../../lib/event-emitter.js';
import { messageContent } from '../../db/schema/index.js';

const mockSelect = vi.mocked(db.select);
const mockUpdate = vi.mocked(db.update);
const mockDelete = vi.mocked(db.delete);

function mockSelectSequence(...results: unknown[]): void {
  for (const r of results) {
    mockSelect.mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve(r) }) } as never);
  }
}

const mockVariablesUsed = vi.fn();
const mockIsForItsNumber = vi.fn();
vi.mock('../message.service.js', () => ({
  MessageService: { isForItsNumber: (...args: unknown[]): unknown => mockIsForItsNumber(...args) },
}));
function deployedWithDests(state: string, destinations: { metaDataId: number; queueMode: string; enabled?: boolean }[]) {
  const named = destinations.map((d) => ({ name: 'Lab', enabled: true, ...d }));
  return { runtime: { getState: () => state, runSignal: new AbortController().signal }, config: { destinations: named }, variablesUsed: mockVariablesUsed };
}

function mockUpdateCapture(matched: readonly unknown[] = [{ messageId: 5 }]): { set: ReturnType<typeof vi.fn> } {
  const set = vi.fn().mockReturnValue({ where: () => ({ returning: () => Promise.resolve(matched) }) });
  mockUpdate.mockReturnValue({ set } as never);
  return { set };
}

function deployedChannel(state: string, processMessage: ReturnType<typeof vi.fn>, runSignal = new AbortController().signal) {
  return { runtime: { getState: () => state, runSignal }, processMessage };
}

function mockRawContent(content: string | null): void {
  const mockWhere = vi.fn().mockResolvedValue(content === null ? [] : [{ content }]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom } as never);
}

beforeEach(() => {
  mockSelect.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset().mockReturnValue({ where: () => Promise.resolve() } as never);
  mockGetRuntime.mockReset();
  mockIsAtRest.mockReset();
  mockDeleteMessagesByIds.mockReset();
  vi.mocked(emitEvent).mockReset();
  mockVariablesUsed.mockReset().mockReturnValue([]);
  mockIsForItsNumber.mockReset().mockResolvedValue({ ok: true, value: true, error: null });
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

  it('reprocesses nothing once a stop has begun, although the channel still reads STARTED (#413)', async () => {
    const processMessage = vi.fn();
    mockRawContent('MSH|...');
    mockGetRuntime.mockReturnValue(deployedChannel('STARTED', processMessage, AbortSignal.abort()));

    const one = await MessageReprocessService.reprocessMessage('ch-001', 1);
    const bulk = await MessageReprocessService.bulkReprocess('ch-001', [1]);

    expect(one.error?.message).toBe('Channel is stopping, must be STARTED to reprocess a message.');
    expect(bulk.error?.message).toBe('Channel is stopping, must be STARTED to reprocess messages.');
    expect(processMessage).not.toHaveBeenCalled();
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

describe('MessageReprocessService, deleting', () => {
  const outcome = (deletedIds: number[], refusedIds: number[], unfinishedIds: number[] = []): void => {
    mockDeleteMessagesByIds.mockResolvedValue({ deletedIds, refusedIds, unfinishedIds });
  };
  const context = { userId: 'user-1', ipAddress: '10.0.0.7' };

  it('in bulk deletes what nothing works on, and names the rest', async () => {
    outcome([1, 2], [3]);

    expect(await MessageReprocessService.bulkDelete('ch-001', [1, 2, 3], context)).toMatchObject({ ok: true, value: { deletedCount: 2, refusedIds: [3] } });
    expect(emitEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      name: 'MESSAGES_DELETED', level: 'INFO', userId: 'user-1', ipAddress: '10.0.0.7', attributes: { deletedCount: 2 },
    }));
  });

  it('takes unfinished messages only while nothing works on the channel, and any that only wait on a queue', async () => {
    outcome([1], []);
    await MessageReprocessService.bulkDelete('ch-001', [1]);

    const rules = mockDeleteMessagesByIds.mock.calls[0]![2] as { unfinished: () => boolean; queued: boolean };
    mockIsAtRest.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect([rules.unfinished(), rules.unfinished(), rules.queued]).toEqual([true, false, true]);
    expect(mockIsAtRest).toHaveBeenCalledWith('ch-001');
  });

  it.each([
    ['one', [5], /^Message 5 was not deleted: it is still being processed or sent.*stop the channel first/],
    ['several', [5, 6], /^2 messages were not deleted: they are still being processed or sent/],
  ])('refuses %s that something may be working on, and records no deletion', async (_what, ids, message) => {
    outcome([], ids);

    expect(await MessageReprocessService.bulkDelete('ch-001', ids)).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringMatching(message) } });
    if (ids.length === 1) expect(await MessageReprocessService.deleteMessage('ch-001', ids[0]!)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('records which deleted messages were not finished, as a warning', async () => {
    outcome([1, 2], [], [2]);
    await MessageReprocessService.bulkDelete('ch-001', [1, 2], context);
    outcome([2], [], [2]);
    await MessageReprocessService.deleteMessage('ch-001', 2, context);

    expect(vi.mocked(emitEvent).mock.calls.map(([event]) => [event.name, event.level, event.attributes])).toEqual([
      ['MESSAGES_DELETED', 'WARN', { deletedCount: 2, unfinishedIds: [2] }],
      ['MESSAGE_DELETED', 'WARN', { messageId: 2, unfinished: true }],
    ]);
  });

  it('records the deletion of one message', async () => {
    outcome([7], []);

    expect((await MessageReprocessService.deleteMessage('ch-001', 7, context)).ok).toBe(true);
    expect(emitEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'MESSAGE_DELETED', channelId: 'ch-001', userId: 'user-1', attributes: { messageId: 7 } }));
  });

  it('finds nothing to delete', async () => {
    outcome([], []);

    expect(await MessageReprocessService.bulkDelete('ch-001', [999])).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await MessageReprocessService.deleteMessage('ch-001', 999)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await MessageReprocessService.bulkDelete('ch-001', [])).toMatchObject({ ok: true, value: { deletedCount: 0, refusedIds: [] } });
  });

  it('fails when the database does', async () => {
    mockDeleteMessagesByIds.mockRejectedValue(new Error('Connection lost'));

    expect(await MessageReprocessService.bulkDelete('ch-001', [1])).toMatchObject({ ok: false, error: { message: 'Connection lost' } });
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
    // Without what a target channel recorded for an earlier send, the queue sends it (D-394).
    expect(mockDelete).toHaveBeenCalledExactlyOnceWith(messageContent);
  });

  it('removes nothing when it did not queue the destination again', async () => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ALWAYS' }]));
    mockSelectSequence([{ status: 'ERROR' }], [{ content: 'MSH|sent' }]);
    mockUpdateCapture([]);

    expect((await MessageReprocessService.resendDestination('ch-001', 5, 1)).ok).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('re-enqueues a destination that uses variables when they were stored with the message', async () => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ALWAYS' }]));
    mockVariablesUsed.mockReturnValue(['mrn']);
    mockSelectSequence([{ status: 'ERROR' }], [{ content: 'MSH|sent' }], [{ contentType: 10 }]);
    const { set } = mockUpdateCapture();

    const result = await MessageReprocessService.resendDestination('ch-001', 5, 1);

    expect(result.ok).toBe(true);
    expect(mockVariablesUsed).toHaveBeenCalledExactlyOnceWith(1, 5, 'MSH|sent');
    expect(set).toHaveBeenCalledWith({ status: 'QUEUED', sendAttempts: 0 });
  });

  it('refuses to resend without the variables a destination uses, as when it did not queue at the time', async () => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ALWAYS' }]));
    mockVariablesUsed.mockReturnValue(['mrn', 'dob']);
    mockSelectSequence([{ status: 'ERROR' }], [{ content: 'MSH|sent' }], []);
    const { set } = mockUpdateCapture();

    const result = await MessageReprocessService.resendDestination('ch-001', 5, 1);

    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringContaining('(mrn, dob)') } });
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses to resend to a destination that is switched off, whose queue is held', async () => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ALWAYS', enabled: false }]));
    const { set } = mockUpdateCapture();

    expect(await MessageReprocessService.resendDestination('ch-001', 5, 1)).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringContaining('"Lab" is switched off') } });
    expect(set).not.toHaveBeenCalled();
  });

  it.each([
    ['is not known to be for the destination that has its number now', { ok: true, value: false, error: null }, { code: 'CONFLICT', message: expect.stringMatching(/^Message 5 cannot be resent: .* not known to be for "Lab"/) }],
    ['cannot be told whether it is', { ok: false, value: null, error: new Error('db down') }, { message: 'db down' }],
  ])('refuses to resend a message that %s', async (_what, its, error) => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ALWAYS' }]));
    mockIsForItsNumber.mockResolvedValue(its);
    mockSelectSequence([{ status: 'ERROR' }]);
    const { set } = mockUpdateCapture();

    expect(await MessageReprocessService.resendDestination('ch-001', 5, 1)).toMatchObject({ ok: false, error });

    expect(mockIsForItsNumber).toHaveBeenCalledExactlyOnceWith('ch-001', 5, 1);
    expect(set).not.toHaveBeenCalled();
  });

  describe('a destination that has not been sent to yet', () => {
    it('is refused while the message is open: the pipeline or crash recovery may be sending it', async () => {
      mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ON_FAILURE' }]));
      mockSelectSequence([{ status: 'RECEIVED', open: true }]);
      const { set } = mockUpdateCapture();

      expect(await MessageReprocessService.resendDestination('ch-001', 5, 1)).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringContaining('still being sent to "Lab"') } });
      expect(set).not.toHaveBeenCalled();
    });

    it('is taken once the message is finished: nothing else will send it', async () => {
      mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ON_FAILURE' }]));
      mockSelectSequence([{ status: 'RECEIVED', open: false }], [{ content: 'MSH|sent' }]);
      const { set } = mockUpdateCapture();

      expect((await MessageReprocessService.resendDestination('ch-001', 5, 1)).ok).toBe(true);
      expect(set).toHaveBeenCalledWith({ status: 'QUEUED', sendAttempts: 0 });
    });
  });

  it('refuses one that its queue has claimed, which may be sending it', async () => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ALWAYS' }]));
    mockSelectSequence([{ status: 'PENDING', open: false }]);
    const { set } = mockUpdateCapture();

    expect(await MessageReprocessService.resendDestination('ch-001', 5, 1)).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringContaining('being sent to "Lab" from its queue') } });
    expect(set).not.toHaveBeenCalled();
  });

  it('says that it did not resend one that was deleted or whose status changed meanwhile', async () => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ALWAYS' }]));
    mockSelectSequence([{ status: 'ERROR' }], [{ content: 'MSH|sent' }]);
    mockUpdateCapture([]);

    expect(await MessageReprocessService.resendDestination('ch-001', 5, 1)).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: expect.stringContaining('was not resent') } });
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('refuses to resend content it cannot decrypt', async () => {
    mockGetRuntime.mockReturnValue(deployedWithDests('STARTED', [{ metaDataId: 1, queueMode: 'ALWAYS' }]));
    mockSelectSequence([{ status: 'ERROR' }], [{ content: 'enc:v1:not-really' }]);
    const { set } = mockUpdateCapture();

    expect((await MessageReprocessService.resendDestination('ch-001', 5, 1)).ok).toBe(false);
    expect(set).not.toHaveBeenCalled();
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
