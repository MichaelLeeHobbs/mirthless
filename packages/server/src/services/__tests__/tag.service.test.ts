// ===========================================
// Tag Service Tests
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
    // Thenable response: returned directly from from() for queries without .where()
    if (result && typeof result === 'object' && 'then' in result) {
      selectCallIndex++;
      return result;
    }
  }
  return {
    where: mockSelectWhere,
    orderBy: vi.fn().mockImplementation(() => {
      const fn2 = selectResponses[selectCallIndex];
      selectCallIndex++;
      if (fn2) return fn2();
      return [];
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

const { TagService } = await import('../tag.service.js');

// ----- Fixtures -----

const TAG_ID = '00000000-0000-0000-0000-000000000001';
const CHANNEL_ID = '00000000-0000-0000-0000-000000000010';

function makeTagRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: TAG_ID,
    name: 'Production',
    color: '#FF0000',
    ...overrides,
  };
}

// ----- Tests -----

beforeEach(() => {
  resetSelectState();
  vi.clearAllMocks();
});

describe('TagService', () => {
  describe('listTags', () => {
    it('returns tags with assignment counts', async () => {
      const tag = makeTagRow();
      pushOrderableResponse([tag]);
      pushResponse([{ value: 5 }]);

      const result = await TagService.listTags();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.name).toBe('Production');
      expect(result.value[0]!.assignmentCount).toBe(5);
    });
  });

  describe('listAssignments', () => {
    it('returns all assignments', async () => {
      const thenableResult = Object.assign(
        Promise.resolve([{ tagId: TAG_ID, channelId: CHANNEL_ID }]),
        { where: mockSelectWhere },
      );
      selectResponses.push(() => thenableResult);

      const result = await TagService.listAssignments();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.tagId).toBe(TAG_ID);
    });

    it('returns empty array when no assignments', async () => {
      const thenableResult = Object.assign(
        Promise.resolve([]),
        { where: mockSelectWhere },
      );
      selectResponses.push(() => thenableResult);

      const result = await TagService.listAssignments();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe('create', () => {
    it('succeeds with valid input', async () => {
      const created = makeTagRow();
      pushResponse([]);
      mockReturning.mockResolvedValueOnce([created]);

      const result = await TagService.create({ name: 'Production', color: '#FF0000' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('Production');
      expect(result.value.color).toBe('#FF0000');
      expect(result.value.assignmentCount).toBe(0);
    });

    it('returns ALREADY_EXISTS for duplicate name', async () => {
      pushResponse([{ id: TAG_ID }]);

      const result = await TagService.create({ name: 'Production', color: '#FF0000' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('already exists'));
    });
  });

  describe('update', () => {
    it('succeeds', async () => {
      const tag = makeTagRow();
      const updated = makeTagRow({ color: '#00FF00' });
      pushResponse([tag]);
      mockUpdateReturning.mockResolvedValueOnce([updated]);
      pushResponse([{ value: 2 }]);

      const result = await TagService.update(TAG_ID, { color: '#00FF00' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.color).toBe('#00FF00');
    });

    it('returns NOT_FOUND for missing id', async () => {
      pushResponse([]);

      const result = await TagService.update(TAG_ID, { name: 'test' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('delete', () => {
    it('succeeds (cascades assignments)', async () => {
      pushResponse([{ id: TAG_ID }]);

      const result = await TagService.delete(TAG_ID);

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing id', async () => {
      pushResponse([]);

      const result = await TagService.delete(TAG_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('assign', () => {
    it('succeeds', async () => {
      pushResponse([{ id: TAG_ID }]);
      pushResponse([{ id: CHANNEL_ID }]);
      pushResponse([]);

      const result = await TagService.assign(TAG_ID, CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockInsert).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for invalid tag', async () => {
      pushResponse([]);

      const result = await TagService.assign(TAG_ID, CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('Tag'));
    });

    it('returns NOT_FOUND for invalid channel', async () => {
      pushResponse([{ id: TAG_ID }]);
      pushResponse([]);

      const result = await TagService.assign(TAG_ID, CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('Channel'));
    });
  });

  describe('unassign', () => {
    it('succeeds', async () => {
      pushResponse([{ tagId: TAG_ID }]);

      const result = await TagService.unassign(TAG_ID, CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for non-existent assignment', async () => {
      pushResponse([]);

      const result = await TagService.unassign(TAG_ID, CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not assigned'));
    });
  });
});
