// ===========================================
// Configuration Map Service Tests
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

// For queries that chain .where().orderBy()
function pushWhereOrderableResponse(value: unknown): void {
  selectResponses.push(() => ({
    orderBy: vi.fn().mockResolvedValue(value),
  }));
}

// For queries that call .orderBy() directly (no where)
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
    // Check if this is a direct-orderable response (thenable with orderBy)
    if (result && typeof result === 'object' && 'orderBy' in result && !('then' in result)) {
      // This is a where-orderable response — return it from .where()
      return {
        where: vi.fn().mockImplementation(() => {
          selectCallIndex++;
          return result;
        }),
        orderBy: vi.fn().mockImplementation(() => {
          selectCallIndex++;
          const fn2 = selectResponses[selectCallIndex - 1];
          if (fn2) return fn2();
          return [];
        }),
      };
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
const mockOnConflictDoUpdate = vi.fn().mockReturnValue({ returning: mockReturning });
const mockInsertValues = vi.fn().mockReturnValue({
  returning: mockReturning,
  onConflictDoUpdate: mockOnConflictDoUpdate,
});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

// Mock transaction
const mockTransaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
  const tx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: mockReturning,
        }),
      }),
    }),
  };
  await fn(tx);
});

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
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
  asc: vi.fn((_col: unknown) => ({ type: 'asc' })),
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

const { ConfigMapService } = await import('../config-map.service.js');

// ----- Fixtures -----

function makeEntry(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    category: 'smtp',
    name: 'host',
    value: 'mail.example.com',
    ...overrides,
  };
}

// ----- Tests -----

beforeEach(() => {
  resetSelectState();
  vi.clearAllMocks();
});

describe('ConfigMapService', () => {
  describe('list', () => {
    it('returns all entries sorted by category then name', async () => {
      const entries = [
        makeEntry({ category: 'db', name: 'host' }),
        makeEntry({ category: 'smtp', name: 'host' }),
      ];
      pushOrderableResponse(entries);

      const result = await ConfigMapService.list();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
    });

    it('filters by category', async () => {
      const entries = [makeEntry()];
      pushWhereOrderableResponse(entries);

      const result = await ConfigMapService.list({ category: 'smtp' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.category).toBe('smtp');
    });

    it('returns empty array when no entries', async () => {
      pushOrderableResponse([]);

      const result = await ConfigMapService.list();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe('getByKey', () => {
    it('returns entry when found', async () => {
      pushResponse([makeEntry()]);

      const result = await ConfigMapService.getByKey('smtp', 'host');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.category).toBe('smtp');
      expect(result.value.name).toBe('host');
      expect(result.value.value).toBe('mail.example.com');
    });

    it('returns NOT_FOUND for missing key', async () => {
      pushResponse([]);

      const result = await ConfigMapService.getByKey('smtp', 'missing');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('upsert', () => {
    it('creates new entry', async () => {
      const entry = makeEntry();
      mockReturning.mockResolvedValueOnce([entry]);

      const result = await ConfigMapService.upsert('smtp', 'host', 'mail.example.com');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.category).toBe('smtp');
      expect(result.value.value).toBe('mail.example.com');
    });

    it('updates existing entry via onConflictDoUpdate', async () => {
      const updated = makeEntry({ value: 'new-host.example.com' });
      mockReturning.mockResolvedValueOnce([updated]);

      const result = await ConfigMapService.upsert('smtp', 'host', 'new-host.example.com');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.value).toBe('new-host.example.com');
      expect(mockOnConflictDoUpdate).toHaveBeenCalled();
    });
  });

  describe('bulkUpsert', () => {
    it('upserts multiple entries in transaction', async () => {
      const entries = [
        { category: 'smtp', name: 'host', value: 'mail.example.com' },
        { category: 'smtp', name: 'port', value: '587' },
      ];
      mockReturning
        .mockResolvedValueOnce([makeEntry()])
        .mockResolvedValueOnce([makeEntry({ name: 'port', value: '587' })]);

      const result = await ConfigMapService.bulkUpsert(entries);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('succeeds when entry exists', async () => {
      pushResponse([{ category: 'smtp' }]);

      const result = await ConfigMapService.delete('smtp', 'host');

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing key', async () => {
      pushResponse([]);

      const result = await ConfigMapService.delete('smtp', 'missing');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });
});
