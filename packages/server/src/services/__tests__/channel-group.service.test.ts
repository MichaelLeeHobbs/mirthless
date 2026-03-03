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

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
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
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
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

  describe('addMember', () => {
    it('succeeds', async () => {
      // Group exists
      pushResponse([{ id: GROUP_ID }]);
      // Channel exists
      pushResponse([{ id: CHANNEL_ID }]);
      // No existing membership
      pushResponse([]);

      const result = await ChannelGroupService.addMember(GROUP_ID, CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockInsert).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for invalid group', async () => {
      pushResponse([]);

      const result = await ChannelGroupService.addMember(GROUP_ID, CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('group'));
    });

    it('returns NOT_FOUND for invalid channel', async () => {
      pushResponse([{ id: GROUP_ID }]);
      pushResponse([]);

      const result = await ChannelGroupService.addMember(GROUP_ID, CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('Channel'));
    });

    it('returns ALREADY_EXISTS for duplicate membership', async () => {
      pushResponse([{ id: GROUP_ID }]);
      pushResponse([{ id: CHANNEL_ID }]);
      pushResponse([{ channelGroupId: GROUP_ID }]);

      const result = await ChannelGroupService.addMember(GROUP_ID, CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('already a member'));
    });
  });

  describe('removeMember', () => {
    it('succeeds', async () => {
      pushResponse([{ channelGroupId: GROUP_ID }]);

      const result = await ChannelGroupService.removeMember(GROUP_ID, CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for non-existent membership', async () => {
      pushResponse([]);

      const result = await ChannelGroupService.removeMember(GROUP_ID, CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not a member'));
    });
  });
});
