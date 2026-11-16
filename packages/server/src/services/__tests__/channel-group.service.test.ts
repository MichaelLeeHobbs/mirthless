// ===========================================
// Channel Group Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock DB -----

let selectCallIndex = 0;
let selectResponses: (() => unknown)[] = [];

function resetSelectState(): void {
  selectCallIndex = 0;
  selectResponses = [];
}

function pushResponse(value: unknown): void {
  selectResponses.push(() => value);
}

function pushOrderableResponse(value: unknown): void {
  selectResponses.push(() =>
    Object.assign(Promise.resolve(value), {
      orderBy: vi.fn().mockResolvedValue(value),
    }),
  );
}

function pushJoinableResponse(value: unknown): void {
  selectResponses.push(() => ({
    innerJoin: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(value),
    }),
  }));
}

const mockSelectWhere = vi.fn().mockImplementation(() => {
  const fn = selectResponses[selectCallIndex];
  selectCallIndex++;
  if (fn) return fn();
  return [];
});

const mockSelectFrom = vi.fn().mockImplementation(() => {
  const fn = selectResponses[selectCallIndex];
  if (fn) {
    const result = fn();
    // Check if this is a joinable response (has innerJoin)
    if (result && typeof result === 'object' && 'innerJoin' in result) {
      selectCallIndex++;
      return result;
    }
    // Thenable response: returned directly from from() for queries without .where()
    if (result && typeof result === 'object' && 'then' in result) {
      selectCallIndex++;
      return result;
    }
  }
  return {
    where: mockSelectWhere,
    orderBy: vi.fn().mockImplementation(() => {
      const orderFn = selectResponses[selectCallIndex];
      selectCallIndex++;
      if (orderFn) return orderFn();
      return [];
    }),
    innerJoin: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        const joinFn = selectResponses[selectCallIndex];
        selectCallIndex++;
        if (joinFn) return joinFn();
        return [];
      }),
    }),
  };
});

const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockReturning = vi.fn();
const mockInsertValues = vi.fn().mockReturnValue({ returning: mockReturning });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateReturning = vi.fn();
const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

// A transaction gets its own executor so a test can tell what ran inside it.
const txState = {
  channel: [] as unknown[],
  groups: [] as unknown[],
  removed: [] as unknown[],
  insertError: null as Error | null,
};
const txInsertValues = vi.fn().mockImplementation(async () => {
  if (txState.insertError) throw txState.insertError;
});
const txDeleteWhere = vi.fn().mockImplementation(() => ({ returning: vi.fn().mockImplementation(async () => txState.removed) }));
const txFor = vi.fn().mockImplementation(async () => txState.channel);
const mockTx = {
  select: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      // The channel lookup ends in .for('update'); the group lookup is awaited directly.
      where: vi.fn().mockImplementation(() => Object.assign(Promise.resolve(txState.groups), { for: txFor })),
    }),
  })),
  delete: vi.fn().mockReturnValue({ where: txDeleteWhere }),
  insert: vi.fn().mockReturnValue({ values: txInsertValues }),
};
const mockTransaction = vi.fn().mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx));

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  transaction: mockTransaction,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  count: vi.fn(() => 'count_agg'),
  asc: vi.fn((_col: unknown) => ({ type: 'asc' })),
  inArray: vi.fn((_col: unknown, vals: unknown) => ({ type: 'inArray', vals })),
}));

const { emitSuccessEvent } = vi.hoisted(() => ({ emitSuccessEvent: vi.fn() }));
vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
  emitSuccessEvent,
}));

const { ChannelGroupService } = await import('../channel-group.service.js');

// ----- Fixtures -----

const NOW = new Date('2026-03-02T12:00:00Z');
const GROUP_ID = '00000000-0000-0000-0000-000000000001';
const CHANNEL_ID = '00000000-0000-0000-0000-000000000010';

function makeGroupRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: GROUP_ID,
    name: 'HL7 Feeds',
    description: 'All HL7 inbound channels',
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ----- Tests -----

beforeEach(() => {
  resetSelectState();
  vi.clearAllMocks();
  txState.channel = [{ id: CHANNEL_ID }];
  txState.groups = [];
  txState.removed = [];
  txState.insertError = null;
});

describe('ChannelGroupService', () => {
  describe('listGroups', () => {
    it('returns groups with member counts', async () => {
      const group = makeGroupRow();
      pushOrderableResponse([group]);
      pushResponse([{ value: 3 }]);

      const result = await ChannelGroupService.listGroups();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.name).toBe('HL7 Feeds');
      expect(result.value[0]!.memberCount).toBe(3);
    });
  });

  describe('listMemberships', () => {
    it('returns all memberships', async () => {
      const thenableResult = Object.assign(
        Promise.resolve([{ channelGroupId: GROUP_ID, channelId: CHANNEL_ID }]),
        { where: mockSelectWhere },
      );
      selectResponses.push(() => thenableResult);

      const result = await ChannelGroupService.listMemberships();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.channelGroupId).toBe(GROUP_ID);
    });

    it('returns empty array when no memberships', async () => {
      const thenableResult = Object.assign(
        Promise.resolve([]),
        { where: mockSelectWhere },
      );
      selectResponses.push(() => thenableResult);

      const result = await ChannelGroupService.listMemberships();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe('getById', () => {
    it('returns group with channel list', async () => {
      const group = makeGroupRow();
      pushResponse([group]);
      pushJoinableResponse([{ id: CHANNEL_ID, name: 'ADT Channel' }]);

      const result = await ChannelGroupService.getById(GROUP_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('HL7 Feeds');
      expect(result.value.channels).toHaveLength(1);
      expect(result.value.channels[0]!.name).toBe('ADT Channel');
    });

    it('returns NOT_FOUND for missing id', async () => {
      pushResponse([]);

      const result = await ChannelGroupService.getById(GROUP_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('create', () => {
    it('succeeds with valid input', async () => {
      const created = makeGroupRow();
      pushResponse([]);
      mockReturning.mockResolvedValueOnce([created]);

      const result = await ChannelGroupService.create({
        name: 'HL7 Feeds',
        description: 'All HL7 inbound channels',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('HL7 Feeds');
      expect(result.value.memberCount).toBe(0);
    });

    it('returns ALREADY_EXISTS for duplicate name', async () => {
      pushResponse([{ id: GROUP_ID }]);

      const result = await ChannelGroupService.create({
        name: 'HL7 Feeds',
        description: '',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('already exists'));
    });
  });

  describe('update', () => {
    it('succeeds with correct revision', async () => {
      const group = makeGroupRow();
      const updated = makeGroupRow({ name: 'Updated', revision: 2 });
      pushResponse([group]);
      mockUpdateReturning.mockResolvedValueOnce([updated]);
      pushResponse([{ value: 2 }]);

      const result = await ChannelGroupService.update(GROUP_ID, {
        revision: 1,
        description: 'updated desc',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.revision).toBe(2);
    });

    it('returns CONFLICT for stale revision', async () => {
      pushResponse([makeGroupRow({ revision: 2 })]);

      const result = await ChannelGroupService.update(GROUP_ID, {
        name: 'test',
        revision: 1,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('modified'));
    });

    it('returns NOT_FOUND for missing id', async () => {
      pushResponse([]);

      const result = await ChannelGroupService.update(GROUP_ID, {
        name: 'test',
        revision: 1,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });

    it('puts the expected revision in the UPDATE WHERE', async () => {
      pushResponse([makeGroupRow()]);
      mockUpdateReturning.mockResolvedValueOnce([makeGroupRow({ revision: 2 })]);
      pushResponse([{ value: 0 }]);

      await ChannelGroupService.update(GROUP_ID, { revision: 1, description: 'x' });

      expect(mockUpdateWhere).toHaveBeenCalledWith({
        type: 'and',
        args: [{ type: 'eq', val: GROUP_ID }, { type: 'eq', val: 1 }],
      });
    });

    it('returns CONFLICT when a concurrent update changed the revision first', async () => {
      // The read sees revision 1, but by the UPDATE another writer has bumped it,
      // so the revision-guarded UPDATE matches no row.
      pushResponse([makeGroupRow()]);
      mockUpdateReturning.mockResolvedValueOnce([]);

      const result = await ChannelGroupService.update(GROUP_ID, { revision: 1, description: 'x' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    });
  });

  describe('delete', () => {
    it('succeeds', async () => {
      pushResponse([{ id: GROUP_ID }]);

      const result = await ChannelGroupService.delete(GROUP_ID);

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing id', async () => {
      pushResponse([]);

      const result = await ChannelGroupService.delete(GROUP_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('setChannelGroups', () => {
    const GROUP_2 = '00000000-0000-0000-0000-000000000002';

    it('replaces the memberships inside one transaction and returns the new set', async () => {
      txState.groups = [{ id: GROUP_ID }, { id: GROUP_2 }];
      txState.removed = [{ channelGroupId: '00000000-0000-0000-0000-000000000009' }];

      const result = await ChannelGroupService.setChannelGroups(CHANNEL_ID, [GROUP_ID, GROUP_2], { userId: 'u1', ipAddress: null });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ channelId: CHANNEL_ID, groupIds: [GROUP_ID, GROUP_2] });
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(txFor).toHaveBeenCalledWith('update');
      expect(txDeleteWhere).toHaveBeenCalledTimes(1);
      expect(txInsertValues).toHaveBeenCalledWith([
        { channelGroupId: GROUP_ID, channelId: CHANNEL_ID },
        { channelGroupId: GROUP_2, channelId: CHANNEL_ID },
      ]);
      // Nothing is written outside the transaction.
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('audits the old and new groups after the transaction commits', async () => {
      txState.groups = [{ id: GROUP_ID }];
      txState.removed = [{ channelGroupId: GROUP_2 }];

      await ChannelGroupService.setChannelGroups(CHANNEL_ID, [GROUP_ID], { userId: 'u1', ipAddress: '10.0.0.1' });

      expect(emitSuccessEvent).toHaveBeenCalledWith('CHANNEL_GROUP_UPDATED', { userId: 'u1', ipAddress: '10.0.0.1' }, {
        action: 'setChannelGroups', channelId: CHANNEL_ID, groupIds: [GROUP_ID], previousGroupIds: [GROUP_2],
      });
    });

    it('with an empty list removes every membership and inserts nothing', async () => {
      txState.removed = [{ channelGroupId: GROUP_ID }];

      const result = await ChannelGroupService.setChannelGroups(CHANNEL_ID, []);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.groupIds).toEqual([]);
      expect(txDeleteWhere).toHaveBeenCalledTimes(1);
      expect(txInsertValues).not.toHaveBeenCalled();
    });

    it('inserts a repeated group once', async () => {
      txState.groups = [{ id: GROUP_ID }];

      await ChannelGroupService.setChannelGroups(CHANNEL_ID, [GROUP_ID, GROUP_ID]);

      expect(txInsertValues).toHaveBeenCalledWith([{ channelGroupId: GROUP_ID, channelId: CHANNEL_ID }]);
    });

    it('returns NOT_FOUND for an unknown channel and changes nothing', async () => {
      txState.channel = [];

      const result = await ChannelGroupService.setChannelGroups(CHANNEL_ID, [GROUP_ID]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
      expect(result.error.message).toContain(CHANNEL_ID);
      expect(txDeleteWhere).not.toHaveBeenCalled();
      expect(txInsertValues).not.toHaveBeenCalled();
      expect(emitSuccessEvent).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND naming each unknown group and changes nothing', async () => {
      txState.groups = [{ id: GROUP_ID }];

      const result = await ChannelGroupService.setChannelGroups(CHANNEL_ID, [GROUP_ID, GROUP_2]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
      expect(result.error.message).toBe(`Channel group not found: ${GROUP_2}`);
      expect(txDeleteWhere).not.toHaveBeenCalled();
      expect(emitSuccessEvent).not.toHaveBeenCalled();
    });

    it('returns the error and audits nothing when the insert fails', async () => {
      txState.groups = [{ id: GROUP_ID }];
      txState.insertError = new Error('violates foreign key constraint');

      const result = await ChannelGroupService.setChannelGroups(CHANNEL_ID, [GROUP_ID]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('foreign key');
      expect(emitSuccessEvent).not.toHaveBeenCalled();
    });
  });
});
