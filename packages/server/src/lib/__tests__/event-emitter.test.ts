// ===========================================
// Event Emitter Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn().mockResolvedValue({ ok: true, value: undefined });
vi.mock('../../services/event.service.js', () => ({ EventService: { create } }));

const { emitSuccessEvent } = await import('../event-emitter.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('emitSuccessEvent', () => {
  it('records an INFO / SUCCESS event with the caller from the audit context', () => {
    emitSuccessEvent('THING_UPDATED', { userId: 'user-1', ipAddress: '192.0.2.1' }, { action: 'create' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toStrictEqual({
      level: 'INFO', name: 'THING_UPDATED', outcome: 'SUCCESS',
      userId: 'user-1', channelId: null, serverId: null, ipAddress: '192.0.2.1',
      attributes: { action: 'create' },
    });
  });

  it('records null user and address when there is no audit context', () => {
    emitSuccessEvent('THING_UPDATED', undefined, { action: 'delete' });

    expect(create.mock.calls[0]?.[0]).toStrictEqual({
      level: 'INFO', name: 'THING_UPDATED', outcome: 'SUCCESS',
      userId: null, channelId: null, serverId: null, ipAddress: null,
      attributes: { action: 'delete' },
    });
  });

  it('records null for context fields that are absent or null', () => {
    emitSuccessEvent('THING_UPDATED', { userId: null }, {});

    expect(create.mock.calls[0]?.[0]).toMatchObject({ userId: null, ipAddress: null });
  });
});
