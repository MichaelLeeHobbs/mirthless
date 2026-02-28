// ===========================================
// Global Script Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock DB -----
// The GlobalScriptService uses two select patterns:
//   1. db.select().from(table) — returns all rows (getAll, final fetch in update)
//   2. db.select().from(table).where() — check if row exists (update upsert logic)
// We track call order with an index counter.

let fromCallIndex = 0;
let fromResponses: unknown[] = [];

function resetMockState(): void {
  fromCallIndex = 0;
  fromResponses = [];
}

function pushFromResponse(value: unknown): void {
  fromResponses.push(value);
}

// The .where() call resolves with the current fromResponse
const mockSelectWhere = vi.fn().mockImplementation(() => {
  const val = fromResponses[fromCallIndex];
  fromCallIndex++;
  return Promise.resolve(val ?? []);
});

// .from() returns an object that can be:
//   - awaited (resolves to rows) — when there's no .where() chain
//   - chained with .where() — when filtering
// We handle both via a thenable that also has .where()
const mockSelectFrom = vi.fn().mockImplementation(() => {
  return {
    where: mockSelectWhere,
    // Support await on the from() call directly (no .where())
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      const val = fromResponses[fromCallIndex];
      fromCallIndex++;
      return Promise.resolve(val ?? []).then(resolve, reject);
    },
  };
});

const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
}));

const { GlobalScriptService } = await import('../global-script.service.js');

// ----- Fixtures -----

function makeScriptRows(): Array<{ scriptType: string; script: string; updatedAt: Date }> {
  const now = new Date('2026-02-28T12:00:00Z');
  return [
    { scriptType: 'DEPLOY', script: '// deploy script', updatedAt: now },
    { scriptType: 'UNDEPLOY', script: '// undeploy script', updatedAt: now },
    { scriptType: 'PREPROCESSOR', script: '// pre', updatedAt: now },
    { scriptType: 'POSTPROCESSOR', script: '// post', updatedAt: now },
  ];
}

// ----- Tests -----

beforeEach(() => {
  resetMockState();
  vi.clearAllMocks();
});

describe('GlobalScriptService', () => {
  describe('getAll', () => {
    it('returns all 4 scripts when stored', async () => {
      // getAll: db.select().from(globalScripts) — no .where()
      pushFromResponse(makeScriptRows());

      const result = await GlobalScriptService.getAll();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.deploy).toBe('// deploy script');
      expect(result.value.undeploy).toBe('// undeploy script');
      expect(result.value.preprocessor).toBe('// pre');
      expect(result.value.postprocessor).toBe('// post');
    });

    it('returns empty strings for missing scripts', async () => {
      pushFromResponse([]);

      const result = await GlobalScriptService.getAll();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.deploy).toBe('');
      expect(result.value.undeploy).toBe('');
      expect(result.value.preprocessor).toBe('');
      expect(result.value.postprocessor).toBe('');
    });

    it('returns partial data when only some scripts exist', async () => {
      pushFromResponse([
        { scriptType: 'DEPLOY', script: 'logger.info("deploy")', updatedAt: new Date() },
      ]);

      const result = await GlobalScriptService.getAll();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.deploy).toBe('logger.info("deploy")');
      expect(result.value.undeploy).toBe('');
    });
  });

  describe('update', () => {
    it('updates existing script row', async () => {
      // For deploy field: select().from().where() — existing found
      pushFromResponse([{ scriptType: 'DEPLOY' }]);
      // Final fetch: select().from() — no .where()
      pushFromResponse([
        { scriptType: 'DEPLOY', script: 'new deploy', updatedAt: new Date() },
      ]);

      const result = await GlobalScriptService.update({ deploy: 'new deploy' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.deploy).toBe('new deploy');
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('inserts when script row does not exist', async () => {
      // For preprocessor field: select().from().where() — not found
      pushFromResponse([]);
      // Final fetch
      pushFromResponse([
        { scriptType: 'PREPROCESSOR', script: '// new pre', updatedAt: new Date() },
      ]);

      const result = await GlobalScriptService.update({ preprocessor: '// new pre' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(mockInsert).toHaveBeenCalled();
    });

    it('skips undefined fields', async () => {
      // No fields → goes straight to final fetch
      pushFromResponse([]);

      const result = await GlobalScriptService.update({});

      expect(result.ok).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('handles all 4 fields', async () => {
      // 4 existence checks (each uses select().from().where())
      pushFromResponse([{ scriptType: 'DEPLOY' }]);
      pushFromResponse([{ scriptType: 'UNDEPLOY' }]);
      pushFromResponse([{ scriptType: 'PREPROCESSOR' }]);
      pushFromResponse([{ scriptType: 'POSTPROCESSOR' }]);
      // Final fetch
      pushFromResponse(makeScriptRows());

      const result = await GlobalScriptService.update({
        deploy: 'a',
        undeploy: 'b',
        preprocessor: 'c',
        postprocessor: 'd',
      });

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalledTimes(4);
    });
  });
});
