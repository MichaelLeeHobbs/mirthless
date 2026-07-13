// ===========================================
// Collection Service — real Postgres integration
// ===========================================
// Exercises the real jsonb queries (@> match, ->> multi-filter), newest-wins
// ordering, TTL default/override, and expiry pruning — behaviour that mock-DB
// unit tests cannot verify. Models the order/report matching use case.

import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

describeIntegration('CollectionService (real Postgres)', () => {
  let mods: ServerModules;
  const created: string[] = [];

  beforeAll(async () => {
    mods = await loadServerModules();
  });

  afterEach(async () => {
    // Clean up collections created by each test (cascade removes records).
    const { db, schema, eq } = mods;
    for (const id of created.splice(0)) {
      await db.delete(schema.collections).where(eq(schema.collections.id, id));
    }
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  /** Create a uniquely-named collection and track it for cleanup. */
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

    // Two orders for the same accession/institution: an older NW, a newer SC.
    unwrap(await CollectionService.store(name, {
      fields: { accessionNumber: 'A1', institutionName: 'Valor', orderControl: 'NW' },
      payload: 'ORDER-NW',
    }));
    await new Promise((r) => setTimeout(r, 5));
    unwrap(await CollectionService.store(name, {
      fields: { accessionNumber: 'A1', institutionName: 'Valor', orderControl: 'SC' },
      payload: 'ORDER-SC',
    }));
    // A decoy for a different accession.
    unwrap(await CollectionService.store(name, {
      fields: { accessionNumber: 'OTHER', institutionName: 'Valor', orderControl: 'SC' },
      payload: 'DECOY',
    }));

    const rows = unwrap(await CollectionService.find(name, {
      match: { accessionNumber: 'A1', institutionName: 'Valor' },
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

  it('applies the collection default TTL and prunes expired records', async () => {
    const { CollectionService, db, schema, eq } = mods;
    // Default TTL of 1s; the stored record expires almost immediately.
    const { id, name } = await makeCollection(['k'], 1);

    unwrap(await CollectionService.store(name, { fields: { k: 'v' }, payload: 'EXPIRES' }));

    // Force it into the past so the pruner deletes it deterministically.
    await db
      .update(schema.collectionRecords)
      .set({ expireAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.collectionRecords.collectionId, id));

    const deleted = unwrap(await CollectionService.pruneExpired());
    expect(deleted).toBeGreaterThanOrEqual(1);

    const remaining = unwrap(await CollectionService.listRecords(id));
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
});
