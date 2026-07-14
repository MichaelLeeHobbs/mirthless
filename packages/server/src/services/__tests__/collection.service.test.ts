// ===========================================
// Collection Service Tests (unit, mocked DB)
// ===========================================
// The happy paths for store/find/pruneExpired need a real jsonb column and are
// covered by collection.itest.ts against Postgres. This unit test exercises the
// pure control-flow branches that integration can't easily force: update() field
// changes, the ALREADY_EXISTS duplicate-name guards on create()/update(), and the
// NOT_FOUND Result.error branches on getById()/update()/delete().

import { describe, it, expect, vi, beforeEach } from 'vitest';

// db.select().from(x).where(...) is awaited directly and returns an array of rows.
const selectWhere = vi.fn().mockResolvedValue([]);
// db.update(x).set(...).where(...).returning() — capture `set` to assert the patch.
const updateReturning = vi.fn();
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn(() => ({ where: updateWhere }));
// db.insert(x).values(...).returning()
const insertReturning = vi.fn();
const insertValues = vi.fn(() => ({ returning: insertReturning }));
// db.delete(x).where(...)
const deleteWhere = vi.fn().mockResolvedValue(undefined);

const mockDb = {
  select: vi.fn(() => ({ from: vi.fn(() => ({ where: selectWhere })) })),
  insert: vi.fn(() => ({ values: insertValues })),
  update: vi.fn(() => ({ set: updateSet })),
  delete: vi.fn(() => ({ where: deleteWhere })),
};

vi.mock('../../lib/db.js', () => ({ db: mockDb, default: mockDb }));
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((_c: unknown, v: unknown) => ({ v })),
  asc: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  lt: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));
const emitEvent = vi.fn();
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent }));

const { CollectionService } = await import('../collection.service.js');

// A full collections.$inferSelect-shaped row (what toSummary reads).
function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'col-1',
    name: 'patients',
    description: 'demographics',
    indexedFields: ['mrn'],
    defaultTtlSeconds: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectWhere.mockResolvedValue([]); // default: no row / no duplicate
});

describe('CollectionService.update', () => {
  it('applies field changes and returns the updated summary', async () => {
    const existing = makeRow();
    const updatedRow = makeRow({
      description: 'updated demographics',
      indexedFields: ['mrn', 'dob'],
      defaultTtlSeconds: 3600,
      updatedAt: new Date('2026-02-02T00:00:00Z'),
    });
    selectWhere.mockResolvedValueOnce([existing]); // existing lookup
    updateReturning.mockResolvedValue([updatedRow]);

    const result = await CollectionService.update('col-1', {
      description: 'updated demographics',
      indexedFields: ['mrn', 'dob'],
      defaultTtlSeconds: 3600,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.description).toBe('updated demographics');
    expect(result.value.indexedFields).toEqual(['mrn', 'dob']);
    expect(result.value.defaultTtlSeconds).toBe(3600);

    // The patch carried exactly the provided fields (plus updatedAt) and NOT name.
    const patch = updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch['description']).toBe('updated demographics');
    expect(patch['indexedFields']).toEqual(['mrn', 'dob']);
    expect(patch['defaultTtlSeconds']).toBe(3600);
    expect(patch).toHaveProperty('updatedAt');
    expect(patch).not.toHaveProperty('name');

    // No duplicate-name check ran (name was unchanged), so only one select.
    expect(mockDb.select).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });

  it('returns ALREADY_EXISTS when renaming to a name another collection holds', async () => {
    selectWhere
      .mockResolvedValueOnce([makeRow({ name: 'patients' })]) // existing
      .mockResolvedValueOnce([makeRow({ id: 'col-2', name: 'labs' })]); // dup on new name

    const result = await CollectionService.update('col-1', { name: 'labs' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'ALREADY_EXISTS');
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the collection to update does not exist', async () => {
    selectWhere.mockResolvedValueOnce([]); // existing lookup: empty

    const result = await CollectionService.update('missing', { description: 'x' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

describe('CollectionService.getById', () => {
  it('returns NOT_FOUND when no collection matches the id', async () => {
    selectWhere.mockResolvedValueOnce([]);

    const result = await CollectionService.getById('missing');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'NOT_FOUND');
  });
});

describe('CollectionService.delete', () => {
  it('returns NOT_FOUND and does not delete when the collection is absent', async () => {
    selectWhere.mockResolvedValueOnce([]);

    const result = await CollectionService.delete('missing');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });
});

describe('CollectionService.create', () => {
  it('returns ALREADY_EXISTS on a duplicate name and never inserts', async () => {
    selectWhere.mockResolvedValueOnce([{ id: 'col-existing' }]); // name already taken

    const result = await CollectionService.create({
      name: 'patients',
      description: '',
      indexedFields: ['mrn'],
      defaultTtlSeconds: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'ALREADY_EXISTS');
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });
});
