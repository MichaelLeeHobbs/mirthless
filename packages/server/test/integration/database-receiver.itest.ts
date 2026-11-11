// ===========================================
// Database Receiver — real Postgres integration
// ===========================================
// A failed mark-as-processed UPDATE aborts a Postgres transaction unless it
// runs in a savepoint. A mocked pool cannot show that; a real one can.

import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from 'vitest';
import { DatabaseReceiver } from '@galvaniflow/connectors';
import { describeIntegration, loadServerModules, type ServerModules } from './_setup.js';

describeIntegration('DatabaseReceiver (real Postgres)', () => {
  let mods: ServerModules;
  let receiver: DatabaseReceiver | null = null;
  const TABLE = 'itest_db_receiver_rows';

  function connection(): { host: string; port: number; database: string; username: string; password: string } {
    const url = new URL(process.env['DATABASE_URL'] ?? '');
    return {
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.replace(/^\//, ''),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  }

  beforeAll(async () => {
    mods = await loadServerModules();
  });

  beforeEach(async () => {
    await mods.pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await mods.pool.query(`CREATE TABLE ${TABLE} (id int PRIMARY KEY, processed boolean NOT NULL DEFAULT false, check_col int)`);
    await mods.pool.query(`INSERT INTO ${TABLE} (id) VALUES (1), (2), (3)`);
  });

  afterEach(async () => {
    await receiver?.onStop();
    receiver = null;
    await mods.pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  });

  afterAll(async () => {
    await mods?.pool.end();
  });

  async function processedIds(): Promise<number[]> {
    const result = await mods.pool.query(`SELECT id FROM ${TABLE} WHERE processed ORDER BY id`);
    return (result.rows as Array<{ id: number }>).map((r) => r.id);
  }

  it('keeps the rows that were acknowledged when one acknowledgement fails', async () => {
    const dispatched: number[] = [];
    receiver = new DatabaseReceiver({
      ...connection(),
      selectQuery: `SELECT id FROM ${TABLE} WHERE NOT processed ORDER BY id`,
      // Divides by zero for id 2, so that row's UPDATE fails.
      updateQuery: `UPDATE ${TABLE} SET processed = true, check_col = 1 / (\${id}::int - 2) WHERE id = \${id}::int`,
      updateMode: 'ON_SUCCESS',
      pollingIntervalMs: 100,
      rowFormat: 'JSON',
    });
    receiver.setDispatcher(async (raw) => {
      dispatched.push((JSON.parse(raw.content) as { id: number }).id);
      return { ok: true, value: { messageId: dispatched.length }, error: null };
    });
    expect((await receiver.onDeploy()).ok).toBe(true);
    expect((await receiver.onStart()).ok).toBe(true);

    await expect.poll(processedIds, { timeout: 5_000 }).toEqual([1, 3]);
    await new Promise((resolve) => { setTimeout(resolve, 350); });
    await receiver.onStop();
    receiver = null;

    // Rows 1 and 3 were dispatched once. Only row 2, whose acknowledgement
    // keeps failing, is read again.
    expect(dispatched.filter((id) => id === 1)).toHaveLength(1);
    expect(dispatched.filter((id) => id === 3)).toHaveLength(1);
    expect(dispatched.filter((id) => id === 2).length).toBeGreaterThan(1);
  });
});
