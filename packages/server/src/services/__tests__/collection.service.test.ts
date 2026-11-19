// The happy paths for store/find/pruneExpired need a real jsonb column and are
// covered by collection.itest.ts against Postgres.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const selectWhere = vi.fn().mockResolvedValue([]);
const updateReturning = vi.fn();
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn((_patch: Record<string, unknown>) => ({ where: updateWhere }));
const insertReturning = vi.fn();
const insertValues = vi.fn(() => ({ returning: insertReturning }));
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
  or: vi.fn((...args: unknown[]) => ({ or: args })),
  sql: vi.fn(() => ({})),
}));
// The real event emitter runs; the event store underneath it is the boundary,
// so the tests see the exact audit record that would be written.
const emitEvent = vi.fn().mockResolvedValue({ ok: true, value: undefined });
vi.mock('../event.service.js', () => ({ EventService: { create: emitEvent } }));
const { sql } = await import('drizzle-orm');

const { CollectionService } = await import('../collection.service.js');

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
  selectWhere.mockResolvedValue([]);
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
    selectWhere.mockResolvedValueOnce([existing]);
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

    const patch = updateSet.mock.calls[0]?.[0] ?? {};
    expect(patch['description']).toBe('updated demographics');
    expect(patch['indexedFields']).toEqual(['mrn', 'dob']);
    expect(patch['defaultTtlSeconds']).toBe(3600);
    expect(patch).toHaveProperty('updatedAt');
    expect(patch).not.toHaveProperty('name');

    // Name unchanged, so no duplicate-name select.
    expect(mockDb.select).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });

  it('returns ALREADY_EXISTS when renaming to a name another collection holds', async () => {
    selectWhere
      .mockResolvedValueOnce([makeRow({ name: 'patients' })])
      .mockResolvedValueOnce([makeRow({ id: 'col-2', name: 'labs' })]);

    const result = await CollectionService.update('col-1', { name: 'labs' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'ALREADY_EXISTS');
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the collection to update does not exist', async () => {
    selectWhere.mockResolvedValueOnce([]);

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
    expect(result.error).toHaveProperty('message', 'Collection missing not found');
  });

  it('returns the summary of the matching collection', async () => {
    selectWhere.mockResolvedValueOnce([makeRow({ extra: 'not part of the summary' })]);

    const result = await CollectionService.getById('col-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toStrictEqual({
      id: 'col-1',
      name: 'patients',
      description: 'demographics',
      indexedFields: ['mrn'],
      defaultTtlSeconds: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });
});

describe('CollectionService.listRecords search', () => {
  function mockListQueries(): void {
    mockDb.select
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([makeRow()]) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ offset: vi.fn().mockResolvedValue([]) })) })) })) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ total: 0 }]) })) });
  }

  function boundPatterns(): unknown[] {
    return vi.mocked(sql).mock.calls.flatMap((call) => call.slice(1)).filter((v) => typeof v === 'string' && v.startsWith('%'));
  }

  it('escapes %, _ and \\ in the search text so they match literally', async () => {
    mockListQueries();

    const result = await CollectionService.listRecords('col-1', {
      page: 1, pageSize: 25, sort: 'createdAt', order: 'desc', q: ' 50%_a\\b ',
    });

    expect(result.ok).toBe(true);
    const patterns = boundPatterns();
    expect(patterns.length).toBeGreaterThan(0);
    for (const p of patterns) expect(p).toBe('%50\\%\\_a\\\\b%');
  });
});

describe('CollectionService audit events', () => {
  it('records a COLLECTION_UPDATED success event with the caller and attributes on create', async () => {
    selectWhere.mockResolvedValueOnce([]);
    insertReturning.mockResolvedValue([makeRow()]);

    const result = await CollectionService.create(
      { name: 'patients', description: '', indexedFields: ['mrn'], defaultTtlSeconds: null },
      { userId: 'user-1', ipAddress: '192.0.2.1' },
    );

    expect(result.ok).toBe(true);
    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(emitEvent.mock.calls[0]?.[0]).toStrictEqual({
      level: 'INFO', name: 'COLLECTION_UPDATED', outcome: 'SUCCESS',
      userId: 'user-1', channelId: null, serverId: null, ipAddress: '192.0.2.1',
      attributes: { action: 'create', collectionName: 'patients' },
    });
  });

  it('records null user and address when there is no audit context', async () => {
    selectWhere.mockResolvedValueOnce([{ id: 'col-1' }]);

    const result = await CollectionService.delete('col-1');

    expect(result.ok).toBe(true);
    expect(emitEvent.mock.calls[0]?.[0]).toStrictEqual({
      level: 'INFO', name: 'COLLECTION_UPDATED', outcome: 'SUCCESS',
      userId: null, channelId: null, serverId: null, ipAddress: null,
      attributes: { action: 'delete', collectionId: 'col-1' },
    });
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
    selectWhere.mockResolvedValueOnce([{ id: 'col-existing' }]);

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
