// ===========================================
// Global Map Service Tests
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
  asc: vi.fn((_col: unknown) => ({ type: 'asc' })),
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

const { GlobalMapService } = await import('../global-map.service.js');

// ----- Fixtures -----

const NOW = new Date('2026-03-02T12:00:00Z');

function makeEntry(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    key: 'test.key',
    value: 'test-value',
    updatedAt: NOW,
    ...overrides,
  };
}

// ----- Tests -----

beforeEach(() => {
  resetSelectState();
  vi.clearAllMocks();
  // Reset delete mock to return chainable object
  mockDelete.mockImplementation(() => ({
    where: mockDeleteWhere,
  }));
});

describe('GlobalMapService', () => {
  describe('list', () => {
    it('returns entries sorted by key', async () => {
      const entries = [
        makeEntry({ key: 'alpha' }),
        makeEntry({ key: 'beta' }),
      ];
      pushOrderableResponse(entries);

      const result = await GlobalMapService.list();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(result.value[0]!.key).toBe('alpha');
      expect(result.value[1]!.key).toBe('beta');
    });

    it('returns empty array when no entries', async () => {
      pushOrderableResponse([]);

      const result = await GlobalMapService.list();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe('getByKey', () => {
    it('returns entry when found', async () => {
      pushResponse([makeEntry()]);

      const result = await GlobalMapService.getByKey('test.key');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.key).toBe('test.key');
      expect(result.value.value).toBe('test-value');
    });

    it('returns NOT_FOUND for missing key', async () => {
      pushResponse([]);

      const result = await GlobalMapService.getByKey('missing');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('upsert', () => {
    it('creates new entry', async () => {
      const entry = makeEntry();
      mockReturning.mockResolvedValueOnce([entry]);

      const result = await GlobalMapService.upsert('test.key', 'test-value');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.key).toBe('test.key');
      expect(result.value.value).toBe('test-value');
    });

    it('updates existing entry', async () => {
      const updated = makeEntry({ value: 'new-value' });
      mockReturning.mockResolvedValueOnce([updated]);

      const result = await GlobalMapService.upsert('test.key', 'new-value');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.value).toBe('new-value');
    });

    it('calls onConflictDoUpdate', async () => {
      const entry = makeEntry();
      mockReturning.mockResolvedValueOnce([entry]);

      await GlobalMapService.upsert('test.key', 'test-value');

      expect(mockOnConflictDoUpdate).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('succeeds when entry exists', async () => {
      pushResponse([{ key: 'test.key' }]);

      const result = await GlobalMapService.delete('test.key');

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing key', async () => {
      pushResponse([]);

      const result = await GlobalMapService.delete('missing');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('clear', () => {
    it('succeeds with entries', async () => {
      // clear calls db.delete(table) with no where
      mockDelete.mockResolvedValueOnce(undefined);

      const result = await GlobalMapService.clear();

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('succeeds when already empty', async () => {
      mockDelete.mockResolvedValueOnce(undefined);

      const result = await GlobalMapService.clear();

      expect(result.ok).toBe(true);
    });
  });
});
