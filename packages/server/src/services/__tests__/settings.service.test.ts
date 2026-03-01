// ===========================================
// Settings Service Tests
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

function consumeResponse(): unknown {
  const fn = selectResponses[selectCallIndex];
  selectCallIndex++;
  if (fn) return fn();
  return [];
}

const mockSelectWhere = vi.fn().mockImplementation(() => consumeResponse());

const mockSelectFrom = vi.fn().mockImplementation(() => {
  return {
    then(resolve: (v: unknown) => void, reject?: (e: unknown) => void): Promise<unknown> {
      const value = consumeResponse();
      return Promise.resolve(value).then(resolve, reject);
    },
    where: mockSelectWhere,
  };
});

const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockOnConflictDoUpdate = vi.fn();
const mockReturning = vi.fn();
const mockInsertValues = vi.fn().mockReturnValue({
  onConflictDoUpdate: mockOnConflictDoUpdate,
});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

const mockTransaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
  const txOnConflictDoUpdate = vi.fn().mockReturnValue({ returning: mockReturning });
  const txInsertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: txOnConflictDoUpdate });
  const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });

  return fn({
    insert: txInsert,
    select: mockSelect,
    delete: mockDelete,
  });
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
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

const { SettingsService } = await import('../settings.service.js');

// ----- Fixtures -----

const NOW = new Date('2026-03-01T12:00:00Z');
const SETTING_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function makeSettingRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: SETTING_ID,
    key: 'general.server_name',
    value: 'Production Server',
    type: 'string',
    description: 'The server display name',
    category: 'general',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ----- Tests -----

beforeEach(() => {
  resetSelectState();
  vi.clearAllMocks();
  mockOnConflictDoUpdate.mockReturnValue({ returning: mockReturning });
});

describe('SettingsService', () => {
  // ===== list =====

  describe('list', () => {
    it('returns all settings', async () => {
      const settings = [
        makeSettingRow(),
        makeSettingRow({ id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22', key: 'features.maintenance_mode', value: 'false', type: 'boolean', category: 'features' }),
      ];
      pushResponse(settings);

      const result = await SettingsService.list();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(result.value[0]!.key).toBe('general.server_name');
    });

    it('filters by category', async () => {
      pushResponse([makeSettingRow()]);

      const result = await SettingsService.list({ category: 'general' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(mockSelectWhere).toHaveBeenCalled();
    });

    it('returns empty list', async () => {
      pushResponse([]);

      const result = await SettingsService.list();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it('maps null optional fields', async () => {
      pushResponse([makeSettingRow({ value: undefined, description: undefined, category: undefined })]);

      const result = await SettingsService.list();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value[0]!.value).toBeNull();
      expect(result.value[0]!.description).toBeNull();
      expect(result.value[0]!.category).toBeNull();
    });
  });

  // ===== getByKey =====

  describe('getByKey', () => {
    it('returns setting detail', async () => {
      pushResponse([makeSettingRow()]);

      const result = await SettingsService.getByKey('general.server_name');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.key).toBe('general.server_name');
      expect(result.value.value).toBe('Production Server');
      expect(result.value.type).toBe('string');
    });

    it('returns NOT_FOUND for missing key', async () => {
      pushResponse([]);

      const result = await SettingsService.getByKey('nonexistent.key');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  // ===== upsert =====

  describe('upsert', () => {
    it('creates a new setting', async () => {
      const row = makeSettingRow();
      mockReturning.mockResolvedValueOnce([row]);

      const result = await SettingsService.upsert({
        key: 'general.server_name',
        value: 'Production Server',
        type: 'string',
        description: 'The server display name',
        category: 'general',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.key).toBe('general.server_name');
      expect(mockInsert).toHaveBeenCalled();
      expect(mockOnConflictDoUpdate).toHaveBeenCalled();
    });

    it('updates existing setting via conflict', async () => {
      const row = makeSettingRow({ value: 'Updated Server' });
      mockReturning.mockResolvedValueOnce([row]);

      const result = await SettingsService.upsert({
        key: 'general.server_name',
        value: 'Updated Server',
        type: 'string',
        description: null,
        category: 'general',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.value).toBe('Updated Server');
    });
  });

  // ===== bulkUpsert =====

  describe('bulkUpsert', () => {
    it('upserts multiple settings in transaction', async () => {
      const row1 = makeSettingRow();
      const row2 = makeSettingRow({ id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22', key: 'features.maintenance_mode', value: 'false' });
      mockReturning
        .mockResolvedValueOnce([row1])
        .mockResolvedValueOnce([row2]);

      const result = await SettingsService.bulkUpsert([
        { key: 'general.server_name', value: 'Production Server', type: 'string', description: null, category: 'general' },
        { key: 'features.maintenance_mode', value: 'false', type: 'boolean', description: null, category: 'features' },
      ]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  // ===== delete =====

  describe('delete', () => {
    it('deletes existing setting', async () => {
      pushResponse([{ id: SETTING_ID }]);

      const result = await SettingsService.delete('general.server_name');

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing setting', async () => {
      pushResponse([]);

      const result = await SettingsService.delete('nonexistent.key');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });
});
