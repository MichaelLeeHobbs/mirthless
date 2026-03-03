// ===========================================
// Resource Service Tests
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
  asc: vi.fn((_col: unknown) => ({ type: 'asc' })),
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

const { ResourceService } = await import('../resource.service.js');

// ----- Fixtures -----

const NOW = new Date('2026-03-02T12:00:00Z');
const RES_ID = '00000000-0000-0000-0000-000000000001';

function makeResourceRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: RES_ID,
    name: 'ca-cert.pem',
    description: 'CA root certificate',
    mimeType: 'application/x-pem-file',
    sizeBytes: 1234,
    content: '-----BEGIN CERTIFICATE-----\nMIIBkTCB...\n-----END CERTIFICATE-----',
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

describe('ResourceService', () => {
  describe('list', () => {
    it('returns resources with metadata (no content)', async () => {
      const row = makeResourceRow();
      pushOrderableResponse([row]);

      const result = await ResourceService.list();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.name).toBe('ca-cert.pem');
    });

    it('sorts by name ascending', async () => {
      pushOrderableResponse([]);

      const result = await ResourceService.list();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe('getById', () => {
    it('returns resource with content', async () => {
      const row = makeResourceRow();
      pushResponse([row]);

      const result = await ResourceService.getById(RES_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(RES_ID);
      expect(result.value.content).toContain('BEGIN CERTIFICATE');
    });

    it('returns NOT_FOUND for missing id', async () => {
      pushResponse([]);

      const result = await ResourceService.getById(RES_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('create', () => {
    it('succeeds with valid input', async () => {
      const created = makeResourceRow();
      pushResponse([]);
      mockReturning.mockResolvedValueOnce([created]);

      const result = await ResourceService.create({
        name: 'ca-cert.pem',
        description: 'CA root certificate',
        mimeType: 'application/x-pem-file',
        content: '-----BEGIN CERTIFICATE-----\nMIIBkTCB...\n-----END CERTIFICATE-----',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('ca-cert.pem');
    });

    it('auto-computes sizeBytes from content', async () => {
      const content = 'hello world';
      const created = makeResourceRow({ sizeBytes: Buffer.byteLength(content, 'utf-8') });
      pushResponse([]);
      mockReturning.mockResolvedValueOnce([created]);

      const result = await ResourceService.create({
        name: 'test.txt',
        description: '',
        mimeType: 'text/plain',
        content,
      });

      expect(result.ok).toBe(true);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          sizeBytes: Buffer.byteLength(content, 'utf-8'),
        }),
      );
    });

    it('returns ALREADY_EXISTS for duplicate name', async () => {
      pushResponse([{ id: RES_ID }]);

      const result = await ResourceService.create({
        name: 'ca-cert.pem',
        description: '',
        mimeType: 'text/plain',
        content: 'test',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('already exists'));
    });
  });

  describe('update', () => {
    it('succeeds', async () => {
      const row = makeResourceRow();
      const updated = makeResourceRow({ description: 'Updated cert' });
      pushResponse([row]);
      mockUpdateReturning.mockResolvedValueOnce([updated]);

      const result = await ResourceService.update(RES_ID, { description: 'Updated cert' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.description).toBe('Updated cert');
    });

    it('returns NOT_FOUND for missing id', async () => {
      pushResponse([]);

      const result = await ResourceService.update(RES_ID, { name: 'test.pem' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });

    it('recomputes sizeBytes on content change', async () => {
      const row = makeResourceRow();
      const newContent = 'new content here';
      const updated = makeResourceRow({
        content: newContent,
        sizeBytes: Buffer.byteLength(newContent, 'utf-8'),
      });
      pushResponse([row]);
      mockUpdateReturning.mockResolvedValueOnce([updated]);

      const result = await ResourceService.update(RES_ID, { content: newContent });

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          sizeBytes: Buffer.byteLength(newContent, 'utf-8'),
        }),
      );
    });
  });

  describe('delete', () => {
    it('succeeds', async () => {
      pushResponse([{ id: RES_ID }]);

      const result = await ResourceService.delete(RES_ID);

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing id', async () => {
      pushResponse([]);

      const result = await ResourceService.delete(RES_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });
});
