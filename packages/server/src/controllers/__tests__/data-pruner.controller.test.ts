// What Run Now says in the log (#417): a run that could not delete everything read "completed".

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const pruneAll = vi.hoisted(() => vi.fn());
vi.mock('../../services/data-pruner.service.js', () => ({ DataPrunerService: { pruneAll } }));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('../../lib/logger.js', () => ({ default: log }));

const { DataPrunerController } = await import('../data-pruner.controller.js');

const PRUNED = {
  channelsPruned: 1, totalDeleted: 2, failedChannelIds: [], leftoverRowsDeleted: 0, leftoverRowsComplete: true,
  expiredRecordsDeleted: 5, expiredRecordsComplete: true, expiredRecordsFailed: false,
};

async function runNow(result: Record<string, unknown>): Promise<unknown> {
  pruneAll.mockResolvedValue({ ok: true, value: result, error: null });
  const json = vi.fn();
  await DataPrunerController.pruneAll({ user: { id: 'u1' }, ip: '10.0.0.1' } as unknown as Request, { json } as unknown as Response);
  return json.mock.lastCall?.[0];
}

beforeEach(() => { vi.clearAllMocks(); });

describe('POST /admin/prune', () => {
  it('answers with what was deleted, and says so in the log', async () => {
    expect(await runNow(PRUNED)).toEqual({ success: true, data: PRUNED });

    expect(log.info).toHaveBeenCalledWith({ result: PRUNED }, 'Data pruner completed');
    expect(log.error).not.toHaveBeenCalled();
  });

  it.each([['a channel', { failedChannelIds: ['c1'] }], ['the expired records', { expiredRecordsFailed: true }]])('is an error in the log when %s could not be pruned', async (_what, failure) => {
    await runNow({ ...PRUNED, ...failure });

    expect(log.error).toHaveBeenCalledWith({ result: { ...PRUNED, ...failure } }, expect.stringContaining('not everything'));
    expect(log.info).not.toHaveBeenCalled();
  });
});
