// What mock-DB unit tests cannot verify: the real jsonb queries, ordering, TTL and pruning.

import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('CollectionService (real Postgres)', () => {
  let mods: ServerModules;
  const created: string[] = [];

  beforeAll(async () => {
    mods = await loadServerModules();
  });

  afterEach(async () => {
    // Cascade removes the records.
    const { db, schema, eq } = mods;
    for (const id of created.splice(0)) {
      await db.delete(schema.collections).where(eq(schema.collections.id, id));
    }
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  async function makeCollection(
    fields: string[],
    defaultTtlSeconds: number | null = null,
  ): Promise<{ id: string; name: string }> {
    const name = `itest-${Math.random().toString(36).slice(2)}`;
    const summary = unwrap(
      await mods.CollectionService.create({ name, description: '', indexedFields: fields, defaultTtlSeconds }),
    );
    created.push(summary.id);
    return { id: summary.id, name };
  }

  it('finds the newest matching record filtered by type (order/report matching)', async () => {
    const { CollectionService } = mods;
    const { name } = await makeCollection(['accessionNumber', 'institutionName', 'orderControl']);

    unwrap(await CollectionService.store(name, {
      fields: { accessionNumber: 'A1', institutionName: 'North', orderControl: 'NW' },
      payload: 'ORDER-NW',
    }));
    await new Promise((r) => setTimeout(r, 5));
    unwrap(await CollectionService.store(name, {
      fields: { accessionNumber: 'A1', institutionName: 'North', orderControl: 'SC' },
      payload: 'ORDER-SC',
    }));
    unwrap(await CollectionService.store(name, {
      fields: { accessionNumber: 'OTHER', institutionName: 'North', orderControl: 'SC' },
      payload: 'DECOY',
    }));

    const rows = unwrap(await CollectionService.find(name, {
      match: { accessionNumber: 'A1', institutionName: 'North' },
      filter: { orderControl: ['XO', 'NW', 'SC'] },
      latest: true,
      order: 'desc',
    }));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toBe('ORDER-SC');
  });

  it('supports multiple filter fields (scalar equality + IN), AND-combined', async () => {
    const { CollectionService } = mods;
    const { name } = await makeCollection(['accessionNumber', 'orderControl', 'messageCode']);

    unwrap(await CollectionService.store(name, {
      fields: { accessionNumber: 'A2', orderControl: 'NW', messageCode: 'ORM' },
      payload: 'MATCH',
    }));
    unwrap(await CollectionService.store(name, {
      fields: { accessionNumber: 'A2', orderControl: 'NW', messageCode: 'ADT' },
      payload: 'WRONG-CODE',
    }));

    const rows = unwrap(await CollectionService.find(name, {
      match: { accessionNumber: 'A2' },
      filter: { orderControl: ['NW', 'SC'], messageCode: 'ORM' },
      latest: false,
      order: 'desc',
    }));

    expect(rows.map((r) => r.payload)).toEqual(['MATCH']);
  });

  describe('an expired record (#417)', () => {
    const query = (match: Record<string, string>, latest = false): { match: Record<string, string>; latest: boolean; order: 'desc' } =>
      ({ match, latest, order: 'desc' });

    it('does not match, and one that lives on does', async () => {
      const { CollectionService } = mods;
      const { name } = await makeCollection(['k', 'kind']);
      const past = new Date(Date.now() - 1_000).toISOString();
      unwrap(await CollectionService.store(name, { fields: { k: 'a', kind: 'x' }, payload: 'never expires' }));
      unwrap(await CollectionService.store(name, { fields: { k: 'a', kind: 'x' }, payload: 'lives on', ttlSeconds: 3600 }));
      unwrap(await CollectionService.store(name, { fields: { k: 'a', kind: 'x' }, payload: 'expired', expireAt: past }));

      const found = unwrap(await CollectionService.find(name, { ...query({ k: 'a' }), filter: { kind: ['x'] } }));

      expect(found.map((r) => r.payload).sort()).toEqual(['lives on', 'never expires']);
    });

    it('is not the newest match: the newest that lives on is', async () => {
      const { CollectionService } = mods;
      const { name } = await makeCollection(['k']);
      unwrap(await CollectionService.store(name, { fields: { k: 'a' }, payload: 'older' }));
      unwrap(await CollectionService.store(name, { fields: { k: 'a' }, payload: 'newer, expired', expireAt: new Date(Date.now() - 1_000).toISOString() }));

      expect(unwrap(await CollectionService.find(name, query({ k: 'a' }, true))).map((r) => r.payload)).toEqual(['older']);
    });

    it('does not take the place of one that lives on under a limit', async () => {
      const { CollectionService } = mods;
      const { name } = await makeCollection(['k']);
      unwrap(await CollectionService.store(name, { fields: { k: 'a' }, payload: 'lives on' }));
      for (let i = 0; i < 3; i++) unwrap(await CollectionService.store(name, { fields: { k: 'a' }, payload: 'expired', expireAt: new Date(Date.now() - 1_000).toISOString() }));

      expect(unwrap(await CollectionService.find(name, { ...query({ k: 'a' }), limit: 2 })).map((r) => r.payload)).toEqual(['lives on']);
    });

    it.each([['is', 'ends at this very moment', 0, 0], ['is not', 'ends in a millisecond', -1, 1]])('%s one whose life %s', async (_is, _what, agoMs, found) => {
      const { CollectionService } = mods;
      const { name } = await makeCollection(['k']);
      const now = Date.parse('2026-11-25T12:00:00.000Z');
      unwrap(await CollectionService.store(name, { fields: { k: 'a' }, payload: 'p', expireAt: new Date(now - agoMs).toISOString() }));

      vi.useFakeTimers({ toFake: ['Date'], now });
      try {
        expect(unwrap(await CollectionService.find(name, query({ k: 'a' })))).toHaveLength(found);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the life it was stored with when the collection default changes', async () => {
      const { CollectionService } = mods;
      const { id, name } = await makeCollection(['k'], 1);
      const record = unwrap(await CollectionService.store(name, { fields: { k: 'a' }, payload: 'p' }));
      await mods.db.update(mods.schema.collectionRecords).set({ expireAt: new Date(record.expireAt!.getTime() - 60_000) }).where(mods.eq(mods.schema.collectionRecords.id, record.id));
      unwrap(await CollectionService.update(id, { defaultTtlSeconds: null }));

      expect(unwrap(await CollectionService.find(name, query({ k: 'a' })))).toEqual([]);
    });

    it('is gone for a script that changes it, and nothing is changed, unless the script extends its life', async () => {
      const { CollectionService } = mods;
      const { id, name } = await makeCollection(['k']);
      const expireAt = new Date(Date.now() - 1_000).toISOString();
      const record = unwrap(await CollectionService.store(name, { fields: { k: 'a' }, payload: 'first', expireAt }));

      expect(unwrap(await CollectionService.updateByName(name, record.id, { payload: 'second' }))).toBeNull();
      expect(unwrap(await CollectionService.listRecords(id, { page: 1, pageSize: 25, sort: 'createdAt', order: 'desc' })).items[0]?.payload).toBe('first');

      // A script that writes back all it read.
      expect(unwrap(await CollectionService.updateByName(name, record.id, { payload: 'second', expireAt }))).toBeNull();

      const later = new Date(Date.now() + 60_000).toISOString();
      expect(unwrap(await CollectionService.updateByName(name, record.id, { payload: 'second', expireAt: later }))).toMatchObject({ payload: 'second' });
    });

    it.each([['lives on', 60_000], ['never expires', null]])('is not one that %s: a script changes that one, and its life stays as it is', async (_what, livesMs) => {
      const { CollectionService } = mods;
      const { name } = await makeCollection(['k']);
      const life = livesMs === null ? {} : { expireAt: new Date(Date.now() + livesMs).toISOString() };
      const record = unwrap(await CollectionService.store(name, { fields: { k: 'a' }, payload: 'first', ...life }));

      const updated = unwrap(await CollectionService.updateByName(name, record.id, { payload: 'second' }));

      expect(updated).toMatchObject({ payload: 'second', expireAt: record.expireAt });
    });

    it('is what a script makes of a record whose life it ends', async () => {
      const { CollectionService } = mods;
      const { name } = await makeCollection(['k']);
      const record = unwrap(await CollectionService.store(name, { fields: { k: 'a' }, payload: 'p' }));

      expect(unwrap(await CollectionService.updateByName(name, record.id, { expireAt: new Date(Date.now() - 1).toISOString() }))).not.toBeNull();

      expect(unwrap(await CollectionService.find(name, query({ k: 'a' })))).toEqual([]);
    });

    it('is still there for a person, who can correct it, and for a script to delete', async () => {
      const { CollectionService } = mods;
      const { id, name } = await makeCollection(['k']);
      const record = unwrap(await CollectionService.store(name, { fields: { k: 'a' }, payload: 'p', expireAt: new Date(Date.now() - 1_000).toISOString() }));

      expect(unwrap(await CollectionService.updateRecord(id, record.id, { payload: 'q' }))).toMatchObject({ payload: 'q' });
      expect(unwrap(await CollectionService.removeByName(name, record.id))).toBe(true);
    });

    it('matches again once its life is extended, or it is to live for ever', async () => {
      const { CollectionService } = mods;
      const { name } = await makeCollection(['k']);
      const record = unwrap(await CollectionService.store(name, { fields: { k: 'a' }, payload: 'p', expireAt: new Date(Date.now() - 1_000).toISOString() }));
      expect(unwrap(await CollectionService.find(name, query({ k: 'a' })))).toEqual([]);

      unwrap(await CollectionService.updateByName(name, record.id, { expireAt: null }));

      expect(unwrap(await CollectionService.find(name, query({ k: 'a' })))).toHaveLength(1);
    });
  });

  it('applies the collection default TTL and prunes expired records', async () => {
    const { CollectionService, db, schema, eq } = mods;
    const { id, name } = await makeCollection(['k'], 1);

    unwrap(await CollectionService.store(name, { fields: { k: 'v' }, payload: 'EXPIRES' }));

    // Force it into the past so the pruner deletes it deterministically.
    await db
      .update(schema.collectionRecords)
      .set({ expireAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.collectionRecords.collectionId, id));

    const deleted = unwrap(await CollectionService.pruneExpired());
    expect(deleted).toBeGreaterThanOrEqual(1);

    const remaining = unwrap(await CollectionService.listRecords(id, { page: 1, pageSize: 25, sort: 'createdAt', order: 'desc' })).items;
    expect(remaining).toHaveLength(0);
  });

  it('honours a per-write TTL override over the collection default', async () => {
    const { CollectionService, db, schema, eq } = mods;
    const { id, name } = await makeCollection(['k'], null); // never expire by default

    unwrap(await CollectionService.store(name, { fields: { k: 'v' }, payload: 'p', ttlSeconds: 3600 }));

    const [row] = await db
      .select()
      .from(schema.collectionRecords)
      .where(eq(schema.collectionRecords.collectionId, id));
    expect(row?.expireAt).not.toBeNull();
  });

  it('rejects storing an unknown (non-indexed) field', async () => {
    const { CollectionService } = mods;
    const { name } = await makeCollection(['accessionNumber']);

    const result = await CollectionService.store(name, {
      fields: { accessionNumber: 'A', notIndexed: 'x' },
      payload: 'p',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a query filtering on an unknown field', async () => {
    const { CollectionService } = mods;
    const { name } = await makeCollection(['accessionNumber']);

    const result = await CollectionService.find(name, {
      match: {},
      filter: { bogus: 'x' },
      latest: false,
      order: 'desc',
    });
    expect(result.ok).toBe(false);
  });

  it('cascades record deletion when a collection is deleted', async () => {
    const { CollectionService, db, schema, eq } = mods;
    const { id, name } = await makeCollection(['k']);
    unwrap(await CollectionService.store(name, { fields: { k: 'v' }, payload: 'p' }));

    unwrap(await CollectionService.delete(id));
    created.splice(created.indexOf(id), 1); // already deleted

    const rows = await db
      .select()
      .from(schema.collectionRecords)
      .where(eq(schema.collectionRecords.collectionId, id));
    expect(rows).toHaveLength(0);
  });

  const PAGE = { page: 1, pageSize: 25, sort: 'createdAt', order: 'desc' } as const;

  async function makeGridCollection(): Promise<{ id: string; name: string }> {
    const made = await makeCollection(['accession', 'facility']);
    for (const [accession, facility, payload] of [
      ['B200', 'North', 'second order'],
      ['A100', 'South', 'first order 50% done'],
      ['C300', 'North', 'third order'],
    ] as const) {
      unwrap(await mods.CollectionService.store(made.name, { fields: { accession, facility }, payload }));
      await new Promise((r) => setTimeout(r, 5));
    }
    return made;
  }

  it('sorts by an indexed field and pages with the total', async () => {
    const { id } = await makeGridCollection();
    const asc = unwrap(await mods.CollectionService.listRecords(id, { ...PAGE, sort: 'fields.accession', order: 'asc' }));
    expect(asc.items.map((r) => r.fields['accession'])).toEqual(['A100', 'B200', 'C300']);
    expect(asc.total).toBe(3);

    const second = unwrap(await mods.CollectionService.listRecords(id, { ...PAGE, page: 2, pageSize: 2 }));
    expect(second.items.map((r) => r.fields['accession'])).toEqual(['B200']);
    expect(second.total).toBe(3);
  });

  it('searches every field and the payload case-insensitively, with the total narrowed', async () => {
    const { id } = await makeGridCollection();
    const byField = unwrap(await mods.CollectionService.listRecords(id, { ...PAGE, q: 'north' }));
    expect(byField.items.map((r) => r.fields['accession'])).toEqual(['C300', 'B200']);
    expect(byField.total).toBe(2);

    const byPayload = unwrap(await mods.CollectionService.listRecords(id, { ...PAGE, q: 'THIRD' }));
    expect(byPayload.items.map((r) => r.payload)).toEqual(['third order']);
  });

  it('scopes a search to one column and treats % as text, not a wildcard', async () => {
    const { id } = await makeGridCollection();
    const scoped = unwrap(await mods.CollectionService.listRecords(id, { ...PAGE, q: 'order', in: 'fields.facility' }));
    expect(scoped.total).toBe(0);

    const percent = unwrap(await mods.CollectionService.listRecords(id, { ...PAGE, q: '50%', in: 'payload' }));
    expect(percent.items.map((r) => r.fields['accession'])).toEqual(['A100']);
    const wildcard = unwrap(await mods.CollectionService.listRecords(id, { ...PAGE, q: '%' }));
    expect(wildcard.total).toBe(1);
  });

  it('rejects sorting by a field the collection does not index', async () => {
    const { id } = await makeGridCollection();
    const result = await mods.CollectionService.listRecords(id, { ...PAGE, sort: 'fields.bogus' });
    expect(result.ok).toBe(false);
  });

  it('creates, updates and deletes a record from the UI', async () => {
    const { CollectionService } = mods;
    const { id } = await makeCollection(['accession'], 3600);

    const created = unwrap(await CollectionService.createRecord(id, { fields: { accession: 'X1' }, payload: 'v1' }));
    expect(created.expireAt).not.toBeNull(); // collection default TTL applies

    const updated = unwrap(await CollectionService.updateRecord(id, created.id, { fields: { accession: 'X2' }, payload: 'v2', expireAt: null }));
    expect(updated).toMatchObject({ id: created.id, fields: { accession: 'X2' }, payload: 'v2', expireAt: null });

    unwrap(await CollectionService.deleteRecord(id, created.id));
    expect(unwrap(await CollectionService.listRecords(id, PAGE)).total).toBe(0);
  });

  it('will not edit or delete a record through another collection', async () => {
    const { CollectionService } = mods;
    const owner = await makeCollection(['accession']);
    const other = await makeCollection(['accession']);
    const record = unwrap(await CollectionService.createRecord(owner.id, { fields: { accession: 'X' }, payload: 'p' }));

    const edit = await CollectionService.updateRecord(other.id, record.id, { fields: {}, payload: 'hijack', expireAt: null });
    expect(edit.ok).toBe(false);
    const removed = await CollectionService.deleteRecord(other.id, record.id);
    expect(removed.ok).toBe(false);
    expect(unwrap(await CollectionService.listRecords(owner.id, PAGE)).items[0]?.payload).toBe('p');
  });

  it('rejects an update that sets a field the collection does not index', async () => {
    const { CollectionService } = mods;
    const { id } = await makeCollection(['accession']);
    const record = unwrap(await CollectionService.createRecord(id, { fields: { accession: 'X' }, payload: 'p' }));
    const result = await CollectionService.updateRecord(id, record.id, { fields: { bogus: 'x' }, payload: 'p', expireAt: null });
    expect(result.ok).toBe(false);
  });

  it('lets a script change only the payload and expiry, keeping the fields', async () => {
    const { CollectionService } = mods;
    const { name } = await makeCollection(['accession'], 3600);
    const record = unwrap(await CollectionService.store(name, { fields: { accession: 'A1' }, payload: 'ORDERED' }));

    const updated = unwrap(await CollectionService.updateByName(name, record.id, { payload: 'RESULTED', expireAt: null }));
    expect(updated).toMatchObject({ id: record.id, fields: { accession: 'A1' }, payload: 'RESULTED', expireAt: null });
  });

  it('returns null / false to a script when the record is already gone', async () => {
    const { CollectionService } = mods;
    const { name } = await makeCollection(['accession']);
    const record = unwrap(await CollectionService.store(name, { fields: { accession: 'A1' }, payload: 'p' }));

    expect(unwrap(await CollectionService.removeByName(name, record.id))).toBe(true);
    expect(unwrap(await CollectionService.removeByName(name, record.id))).toBe(false);
    expect(unwrap(await CollectionService.updateByName(name, record.id, { payload: 'x' }))).toBeNull();
  });

  it('will not let a script touch a record through another collection name', async () => {
    const { CollectionService } = mods;
    const owner = await makeCollection(['accession']);
    const other = await makeCollection(['accession']);
    const record = unwrap(await CollectionService.store(owner.name, { fields: { accession: 'A1' }, payload: 'p' }));

    expect(unwrap(await CollectionService.removeByName(other.name, record.id))).toBe(false);
    expect(unwrap(await CollectionService.updateByName(other.name, record.id, { payload: 'x' }))).toBeNull();
    expect(unwrap(await CollectionService.listRecords(owner.id, PAGE)).items[0]?.payload).toBe('p');
  });

  it('fails loudly when a script names a collection that does not exist', async () => {
    const result = await mods.CollectionService.removeByName('no-such-collection', '00000000-0000-4000-8000-000000000001');
    expect(result.ok).toBe(false);
  });
});
