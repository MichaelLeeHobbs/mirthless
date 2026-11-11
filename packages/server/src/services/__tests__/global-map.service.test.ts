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
    isJson: false,
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

  describe('persist (engine writes)', () => {
    it('saves the value with its JSON flag and emits no audit event', async () => {
      const { emitEvent } = await import('../../lib/event-emitter.js');
      mockOnConflictDoUpdate.mockResolvedValueOnce(undefined);

      const result = await GlobalMapService.persist('count', '7', true);

      expect(result.ok).toBe(true);
      expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ key: 'count', value: '7', isJson: true }));
      expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({ set: expect.objectContaining({ value: '7', isJson: true }) }));
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it('returns the error when the database rejects', async () => {
      mockOnConflictDoUpdate.mockRejectedValueOnce(new Error('db down'));

      const result = await GlobalMapService.persist('k', 'v', false);

      expect(result.ok).toBe(false);
    });

    it('persistRemoval deletes without requiring the key to exist', async () => {
      const result = await GlobalMapService.persistRemoval('gone');

      expect(result.ok).toBe(true);
      expect(mockDeleteWhere).toHaveBeenCalledWith({ type: 'eq', val: 'gone' });
    });
  });

  describe('change notifications', () => {
    it('tells the listener about API edits, deletes and clears, but not engine writes', async () => {
      const seen: unknown[] = [];
      GlobalMapService.onChange((change) => { seen.push(change); });

      mockReturning.mockResolvedValueOnce([makeEntry({ key: 'k', value: 'v' })]);
      await GlobalMapService.upsert('k', 'v');
      pushResponse([{ key: 'k' }]);
      await GlobalMapService.delete('k');
      mockDelete.mockResolvedValueOnce(undefined);
      await GlobalMapService.clear();
      mockOnConflictDoUpdate.mockResolvedValueOnce(undefined);
      await GlobalMapService.persist('k', 'v', false);

      expect(seen).toEqual([
        { type: 'set', row: { key: 'k', value: 'v', isJson: false } },
        { type: 'delete', key: 'k' },
        { type: 'clear' },
      ]);
    });

    it('an API upsert stores plain text even over a JSON entry', async () => {
      mockReturning.mockResolvedValueOnce([makeEntry({ key: 'count', value: '7' })]);

      await GlobalMapService.upsert('count', '7');

      expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({ set: expect.objectContaining({ isJson: false }) }));
    });
  });
});
