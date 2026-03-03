// ===========================================
// User Preference Service Tests
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

const mockSelectWhere = vi.fn().mockImplementation(() => {
  const fn = selectResponses[selectCallIndex];
  selectCallIndex++;
  if (fn) return fn();
  return [];
});

const mockSelectFrom = vi.fn().mockImplementation(() => ({
  where: mockSelectWhere,
  orderBy: vi.fn().mockImplementation(() => {
    const fn = selectResponses[selectCallIndex];
    selectCallIndex++;
    if (fn) return fn();
    return [];
  }),
}));

const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockReturning = vi.fn();
const mockOnConflictDoUpdate = vi.fn().mockReturnValue({ returning: mockReturning });
const mockInsertValues = vi.fn().mockReturnValue({
  returning: mockReturning,
  onConflictDoUpdate: mockOnConflictDoUpdate,
});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockImplementation(() => ({
  where: mockDeleteWhere,
}));

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  delete: mockDelete,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  asc: vi.fn((_col: unknown) => ({ type: 'asc' })),
  sql: Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', strings, values }), {
    raw: (s: string) => ({ type: 'sql_raw', value: s }),
  }),
}));

const { UserPreferenceService } = await import('../user-preference.service.js');

// ----- Fixtures -----

const USER_ID = '00000000-0000-0000-0000-000000000001';

function makeEntry(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    userId: USER_ID,
    key: 'theme',
    value: 'dark',
    ...overrides,
  };
}

// ----- Tests -----

beforeEach(() => {
  resetSelectState();
  vi.clearAllMocks();
  mockDelete.mockImplementation(() => ({
    where: mockDeleteWhere,
  }));
});

describe('UserPreferenceService', () => {
  describe('list', () => {
    it('returns preferences sorted by key', async () => {
      const entries = [
        makeEntry({ key: 'locale' }),
        makeEntry({ key: 'theme' }),
      ];
      // list uses .where().orderBy() chain
      pushResponse(
        Object.assign(Promise.resolve(entries), {
          orderBy: vi.fn().mockResolvedValue(entries),
        }),
      );

      const result = await UserPreferenceService.list(USER_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(result.value[0]!.key).toBe('locale');
    });

    it('returns empty array when no preferences', async () => {
      pushResponse(
        Object.assign(Promise.resolve([]), {
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      );

      const result = await UserPreferenceService.list(USER_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe('getByKey', () => {
    it('returns preference when found', async () => {
      pushResponse([makeEntry()]);

      const result = await UserPreferenceService.getByKey(USER_ID, 'theme');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.key).toBe('theme');
      expect(result.value.value).toBe('dark');
    });

    it('returns NOT_FOUND for missing key', async () => {
      pushResponse([]);

      const result = await UserPreferenceService.getByKey(USER_ID, 'missing');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('upsert', () => {
    it('creates new preference', async () => {
      const entry = makeEntry();
      mockReturning.mockResolvedValueOnce([entry]);

      const result = await UserPreferenceService.upsert(USER_ID, 'theme', 'dark');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.key).toBe('theme');
      expect(result.value.value).toBe('dark');
    });

    it('updates existing preference', async () => {
      const updated = makeEntry({ value: 'light' });
      mockReturning.mockResolvedValueOnce([updated]);

      const result = await UserPreferenceService.upsert(USER_ID, 'theme', 'light');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.value).toBe('light');
    });
  });

  describe('delete', () => {
    it('succeeds when preference exists', async () => {
      pushResponse([{ key: 'theme' }]);

      const result = await UserPreferenceService.delete(USER_ID, 'theme');

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing key', async () => {
      pushResponse([]);

      const result = await UserPreferenceService.delete(USER_ID, 'missing');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('bulkUpsert', () => {
    it('upserts multiple entries in a single query', async () => {
      const rows = [
        makeEntry({ key: 'theme', value: 'dark' }),
        makeEntry({ key: 'locale', value: 'en-US' }),
      ];
      mockReturning.mockResolvedValueOnce(rows);

      const result = await UserPreferenceService.bulkUpsert(USER_ID, [
        { key: 'theme', value: 'dark' },
        { key: 'locale', value: 'en-US' },
      ]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(result.value[0]!.key).toBe('theme');
      expect(result.value[1]!.key).toBe('locale');
      // Verify single insert call (not N+1)
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });
  });
});
