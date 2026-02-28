// ===========================================
// Code Template Service Tests
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
  count: vi.fn(() => 'count_agg'),
  asc: vi.fn((_col: unknown) => ({ type: 'asc' })),
}));

const { CodeTemplateService } = await import('../code-template.service.js');

// ----- Fixtures -----

const NOW = new Date('2026-02-28T12:00:00Z');
const LIB_ID = '00000000-0000-0000-0000-000000000001';
const TMPL_ID = '00000000-0000-0000-0000-000000000010';

function makeLibRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: LIB_ID,
    name: 'My Library',
    description: 'Shared helpers',
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTmplRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: TMPL_ID,
    libraryId: LIB_ID,
    name: 'myHelper',
    description: 'A helper function',
    type: 'FUNCTION',
    code: 'return 42;',
    contexts: ['SOURCE_FILTER_TRANSFORMER'],
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

describe('CodeTemplateService', () => {
  // ===== Libraries =====

  describe('listLibraries', () => {
    it('returns libraries with template counts', async () => {
      const lib = makeLibRow();
      // First call: select all libraries
      pushOrderableResponse([lib]);
      // Second call: count templates for lib
      pushResponse([{ value: 3 }]);

      const result = await CodeTemplateService.listLibraries();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.name).toBe('My Library');
      expect(result.value[0]!.templateCount).toBe(3);
    });

    it('returns empty array when no libraries', async () => {
      pushOrderableResponse([]);

      const result = await CodeTemplateService.listLibraries();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe('createLibrary', () => {
    it('creates library when name is unique', async () => {
      const created = makeLibRow();
      // Check for duplicate name
      pushResponse([]);
      // Insert returning
      mockReturning.mockResolvedValueOnce([created]);

      const result = await CodeTemplateService.createLibrary({
        name: 'My Library',
        description: 'Shared helpers',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('My Library');
      expect(result.value.templateCount).toBe(0);
    });

    it('returns error when name already exists', async () => {
      pushResponse([{ id: LIB_ID }]);

      const result = await CodeTemplateService.createLibrary({
        name: 'My Library',
        description: '',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('already exists'));
    });
  });

  describe('updateLibrary', () => {
    it('updates library with correct revision', async () => {
      const lib = makeLibRow();
      const updated = makeLibRow({ name: 'Updated', revision: 2 });
      // Find existing (same name → no dup check)
      pushResponse([lib]);
      // Update returning
      mockUpdateReturning.mockResolvedValueOnce([updated]);
      // Count templates after update
      pushResponse([{ value: 2 }]);

      const result = await CodeTemplateService.updateLibrary(LIB_ID, {
        revision: 1,
        description: 'updated desc',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.revision).toBe(2);
    });

    it('returns NOT_FOUND when library does not exist', async () => {
      pushResponse([]);

      const result = await CodeTemplateService.updateLibrary(LIB_ID, {
        name: 'test',
        revision: 1,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });

    it('returns CONFLICT when revision does not match', async () => {
      pushResponse([makeLibRow({ revision: 2 })]);

      const result = await CodeTemplateService.updateLibrary(LIB_ID, {
        name: 'test',
        revision: 1,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('modified'));
    });

    it('returns ALREADY_EXISTS when duplicate name', async () => {
      const lib = makeLibRow();
      // Find existing
      pushResponse([lib]);
      // Check duplicate name
      pushResponse([{ id: 'other-id' }]);

      const result = await CodeTemplateService.updateLibrary(LIB_ID, {
        name: 'Duplicate Name',
        revision: 1,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('already exists'));
    });
  });

  describe('deleteLibrary', () => {
    it('deletes existing library', async () => {
      pushResponse([{ id: LIB_ID }]);

      const result = await CodeTemplateService.deleteLibrary(LIB_ID);

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND when library does not exist', async () => {
      pushResponse([]);

      const result = await CodeTemplateService.deleteLibrary(LIB_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  // ===== Templates =====

  describe('listTemplates', () => {
    it('returns all templates without filter', async () => {
      const tmpl = makeTmplRow();
      pushOrderableResponse([tmpl]);

      const result = await CodeTemplateService.listTemplates();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.name).toBe('myHelper');
    });
  });

  describe('getTemplate', () => {
    it('returns template when found', async () => {
      pushResponse([makeTmplRow()]);

      const result = await CodeTemplateService.getTemplate(TMPL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(TMPL_ID);
      expect(result.value.code).toBe('return 42;');
    });

    it('returns NOT_FOUND when not found', async () => {
      pushResponse([]);

      const result = await CodeTemplateService.getTemplate(TMPL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('createTemplate', () => {
    it('creates template when library exists', async () => {
      const created = makeTmplRow();
      // Check library exists
      pushResponse([{ id: LIB_ID }]);
      // Insert returning
      mockReturning.mockResolvedValueOnce([created]);

      const result = await CodeTemplateService.createTemplate({
        libraryId: LIB_ID,
        name: 'myHelper',
        description: 'A helper function',
        type: 'FUNCTION',
        code: 'return 42;',
        contexts: ['SOURCE_FILTER_TRANSFORMER'],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('myHelper');
      expect(result.value.type).toBe('FUNCTION');
    });

    it('returns NOT_FOUND when library does not exist', async () => {
      pushResponse([]);

      const result = await CodeTemplateService.createTemplate({
        libraryId: LIB_ID,
        name: 'test',
        description: '',
        type: 'FUNCTION',
        code: '',
        contexts: [],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('Library'));
    });
  });

  describe('updateTemplate', () => {
    it('updates template with correct revision', async () => {
      const tmpl = makeTmplRow();
      const updated = makeTmplRow({ name: 'renamedHelper', revision: 2 });
      pushResponse([tmpl]);
      mockUpdateReturning.mockResolvedValueOnce([updated]);

      const result = await CodeTemplateService.updateTemplate(TMPL_ID, {
        name: 'renamedHelper',
        revision: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('renamedHelper');
      expect(result.value.revision).toBe(2);
    });

    it('returns NOT_FOUND when template does not exist', async () => {
      pushResponse([]);

      const result = await CodeTemplateService.updateTemplate(TMPL_ID, {
        code: 'x',
        revision: 1,
      });

      expect(result.ok).toBe(false);
    });

    it('returns CONFLICT when revision mismatch', async () => {
      pushResponse([makeTmplRow({ revision: 5 })]);

      const result = await CodeTemplateService.updateTemplate(TMPL_ID, {
        code: 'x',
        revision: 1,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('modified'));
    });
  });

  describe('deleteTemplate', () => {
    it('deletes existing template', async () => {
      pushResponse([{ id: TMPL_ID }]);

      const result = await CodeTemplateService.deleteTemplate(TMPL_ID);

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND when template does not exist', async () => {
      pushResponse([]);

      const result = await CodeTemplateService.deleteTemplate(TMPL_ID);

      expect(result.ok).toBe(false);
    });
  });
});
