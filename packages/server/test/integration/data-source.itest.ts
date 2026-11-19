// The data sources point at the test database itself. Needs CONTENT_ENCRYPTION_KEY.

import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { describeIntegration, loadServerModules, unwrap, type ServerModules } from './_setup.js';

function dbParts(): { host: string; port: number; database: string; user: string; password: string } {
  const url = new URL(process.env.DATABASE_URL ?? '');
  return {
    host: url.hostname,
    port: Number(url.port || '5432'),
    database: url.pathname.replace(/^\//, ''),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

describeIntegration('DataSourceService (real Postgres)', () => {
  let mods: ServerModules;
  const created: string[] = [];

  beforeAll(async () => {
    mods = await loadServerModules();
  });

  afterEach(async () => {
    const { db, schema, eq } = mods;
    for (const id of created.splice(0)) {
      await db.delete(schema.dataSources).where(eq(schema.dataSources.id, id));
    }
  });

  afterAll(async () => {
    await mods?.dataSourcePoolManager.shutdown();
    await mods?.pool.end();
  });

  async function makeSource(readOnly: boolean, overrides: Record<string, unknown> = {}): Promise<string> {
    const name = `itest-ds-${Math.random().toString(36).slice(2)}`;
    const summary = unwrap(await mods.DataSourceService.create({
      name, description: '', driver: 'postgres', ...dbParts(), readOnly, tls: false,
      maxConnections: 2, statementTimeoutMs: 10_000, maxRows: 10_000, ...overrides,
    }));
    created.push(summary.id);
    expect((summary as unknown as Record<string, unknown>)['password']).toBeUndefined();
    return name;
  }

  it('runs a read-only query end-to-end (encrypted creds round-trip)', async () => {
    const name = await makeSource(true);
    const rows = unwrap(await mods.DataSourceService.runQuery(name, 'SELECT 42 AS n', []));
    expect(rows).toEqual([{ n: 42 }]);
  });

  it('passes parameters positionally', async () => {
    const name = await makeSource(true);
    const rows = unwrap(await mods.DataSourceService.runQuery(name, 'SELECT $1::int AS a, $2::text AS b', [7, 'x']));
    expect(rows).toEqual([{ a: 7, b: 'x' }]);
  });

  it('blocks writes on a read-only data source', async () => {
    const name = await makeSource(true);
    const table = `_ro_${Math.random().toString(36).slice(2)}`;
    const result = await mods.DataSourceService.runQuery(name, `CREATE TEMP TABLE ${table}(i int)`, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/read-only transaction/i);
  });

  it('blocks a multi-statement write that tries to COMMIT out of the read-only transaction', async () => {
    const name = await makeSource(true);
    const table = `_ro_${Math.random().toString(36).slice(2)}`;
    const result = await mods.DataSourceService.runQuery(name, `COMMIT; CREATE TABLE ${table}(i int)`, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/multiple commands/i);
  });

  it('allows writes on a read-write data source', async () => {
    const name = await makeSource(false);
    const table = `_rw_${Math.random().toString(36).slice(2)}`;
    const result = await mods.DataSourceService.runQuery(name, `CREATE TEMP TABLE ${table}(i int)`, []);
    expect(result.ok).toBe(true);
  });

  it('rejects a result set larger than maxRows', async () => {
    const name = await makeSource(true, { maxRows: 3 });
    const result = await mods.DataSourceService.runQuery(name, 'SELECT * FROM generate_series(1, 10)', []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/exceeding maxRows/);
  });

  it('fails with NOT_FOUND after the data source is deleted (pool invalidated)', async () => {
    const name = await makeSource(true);
    const list = unwrap(await mods.DataSourceService.list());
    const id = list.find((s) => s.name === name)!.id;

    unwrap(await mods.DataSourceService.delete(id));
    created.splice(created.indexOf(id), 1);

    const result = await mods.DataSourceService.runQuery(name, 'SELECT 1', []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/not found/i);
  });
});
