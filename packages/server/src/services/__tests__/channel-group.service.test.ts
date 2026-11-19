import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    if (result && typeof result === 'object' && 'innerJoin' in result) {
      selectCallIndex++;
      return result;
    }
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
// The channel lookup locks FOR NO KEY UPDATE, the group lookup FOR KEY SHARE.
const txFor = vi.fn().mockImplementation(async (strength: string) => (strength === 'key share' ? txState.groups : txState.channel));
const txWhere = vi.fn().mockReturnValue({ for: txFor });
const mockTx = {
  select: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({ where: txWhere }),
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
  isNull: vi.fn((col: unknown) => ({ type: 'isNull', col })),
}));

const { emitEvent } = vi.hoisted(() => ({ emitEvent: vi.fn() }));
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent }));

// Which groups give access is read from the assignment tables, which only the
// grant service reads; covered against Postgres in group-grants.itest.ts.
const groupsGivingAccess = vi.fn().mockResolvedValue(new Set<string>());
const removeGroupMemberships = vi.fn().mockResolvedValue(undefined);
vi.mock('../grant.service.js', () => ({ GrantService: { groupsGivingAccess, applyChannelGroups: vi.fn(), removeGroupMemberships } }));

const { ChannelGroupService } = await import('../channel-group.service.js');

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
      expect(result.value[0]!.givesAccess).toBe(false);
    });

    it('marks a group a live assignment is scoped to as giving access', async () => {
      groupsGivingAccess.mockResolvedValueOnce(new Set([GROUP_ID]));
      pushOrderableResponse([makeGroupRow()]);
      pushResponse([{ value: 0 }]);

      const result = await ChannelGroupService.listGroups();

      expect(result.ok && result.value[0]!.givesAccess).toBe(true);
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
      pushResponse([makeGroupRow()]);
      mockUpdateReturning.mockResolvedValueOnce([]);

      const result = await ChannelGroupService.update(GROUP_ID, { revision: 1, description: 'x' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    });
  });

  describe('delete', () => {
    it('takes the channels out through the grant service, then deletes, in one transaction', async () => {
      pushResponse([{ id: GROUP_ID }]);

      const result = await ChannelGroupService.delete(GROUP_ID);

      expect(result.ok).toBe(true);
      expect(removeGroupMemberships).toHaveBeenCalledWith(mockTx, GROUP_ID, expect.objectContaining({ userId: null }));
      expect(mockTx.delete).toHaveBeenCalled();
      expect(removeGroupMemberships.mock.invocationCallOrder[0]!).toBeLessThan(mockTx.delete.mock.invocationCallOrder.at(-1)!);
    });

    it('answers CONFLICT when an assignment is scoped to the group', async () => {
      pushResponse([{ id: GROUP_ID }]);
      txDeleteWhere.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('fk'), { code: '23503', table: 'assignment_groups' })));

      const result = await ChannelGroupService.delete(GROUP_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    });

    it('returns NOT_FOUND for missing id', async () => {
      pushResponse([]);

      const result = await ChannelGroupService.delete(GROUP_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  // setChannelGroups goes through GrantService.applyChannelGroups (D-310); covered
  // against Postgres in channel-group.itest.ts and group-grants.itest.ts.
});
