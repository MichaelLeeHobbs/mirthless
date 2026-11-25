import { it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DATABASE_VENDOR, MysqlPool } from '../../../index.js';
import { gate, openGates, startSource, stopSource, type RunningSource } from './database-source.js';
import { describeMysql, requireMysql } from './gates.js';

const TABLE = 'itest_db_source';
const PROCEDURE = 'itest_db_slow_insert';

/**
 * The server's own limit is 5 s below this: 1.5 s. A statement here sleeps 8 s for each of three rows; one SLEEP
 * alone would end early when it is stopped, and the statement would go on.
 */
const STATEMENT_TIMEOUT_MS = 6_500;

describeMysql('DATABASE on a real MySQL', () => {
  const admin = new MysqlPool();
  let limited: MysqlPool;
  let sources: RunningSource[] = [];

  async function sql(text: string): Promise<readonly Record<string, unknown>[]> {
    const result = await admin.query(text, []);
    if (!result.ok) throw result.error;
    return result.value.rows;
  }

  async function start(...args: Parameters<typeof startSource> extends [unknown, infer S, ...infer Rest] ? [S, ...Rest] : never): Promise<RunningSource> {
    const [settings, ...rest] = args;
    const source = await startSource(requireMysql(), { vendor: DATABASE_VENDOR.MYSQL, ...settings }, ...rest);
    sources.push(source);
    return source;
  }

  async function doneIds(): Promise<readonly unknown[]> {
    return (await sql(`SELECT id FROM ${TABLE} WHERE done = 1 ORDER BY id`)).map((row) => row['id']);
  }

  /** How many statements that name the table or the procedure still run on the server. */
  async function running(): Promise<number> {
    const rows = await sql(`SELECT ID FROM information_schema.PROCESSLIST
      WHERE ID <> CONNECTION_ID() AND COMMAND <> 'Sleep' AND (INFO LIKE '%${TABLE}%' OR INFO LIKE '%${PROCEDURE}%' OR INFO LIKE '%SLEEP%')`);
    return rows.length;
  }

  beforeAll(async () => {
    const created = await admin.create(requireMysql());
    if (!created.ok) throw created.error;
  });

  beforeEach(async () => {
    await sql(`DROP TABLE IF EXISTS ${TABLE}`);
    await sql(`CREATE TABLE ${TABLE} (id INT PRIMARY KEY, done TINYINT NOT NULL DEFAULT 0)`);
    await sql(`INSERT INTO ${TABLE} (id) VALUES (1), (2), (3)`);
    limited = new MysqlPool();
    const created = await limited.create({ ...requireMysql(), statementTimeoutMs: STATEMENT_TIMEOUT_MS });
    if (!created.ok) throw created.error;
  });

  afterEach(async () => {
    openGates();
    for (const source of sources) await stopSource(source);
    sources = [];
    await limited.destroy();
  });

  afterAll(async () => {
    await sql(`DROP TABLE IF EXISTS ${TABLE}`);
    await sql(`DROP PROCEDURE IF EXISTS ${PROCEDURE}`);
    await admin.destroy();
  });

  it.each([
    ['INSERT', `INSERT INTO ${TABLE} (id) SELECT id + 10 FROM ${TABLE} WHERE SLEEP(8) = 0`],
    ['UPDATE', `UPDATE ${TABLE} SET done = 1 WHERE SLEEP(8) = 0`],
    ['DELETE', `DELETE FROM ${TABLE} WHERE SLEEP(8) = 0`],
    ['CALL', `CALL ${PROCEDURE}()`],
  ])('%s over its limit is stopped on the server and does not take effect', async (_what, statement) => {
    await sql(`DROP PROCEDURE IF EXISTS ${PROCEDURE}`);
    await sql(`CREATE PROCEDURE ${PROCEDURE}() BEGIN UPDATE ${TABLE} SET done = 1 WHERE SLEEP(8) = 0; INSERT INTO ${TABLE} (id) VALUES (9); END`);

    const result = await limited.query(statement, []);

    expect(!result.ok && result.error.message).toContain('interrupted');
    await expect.poll(running).toBe(0);
    expect(await sql(`SELECT id, done FROM ${TABLE} ORDER BY id`)).toEqual([{ id: 1, done: 0 }, { id: 2, done: 0 }, { id: 3, done: 0 }]);
  });

  it('a statement over its limit in a transaction rolls it back', async () => {
    const result = await limited.transaction(async (tx) => {
      await tx.query(`UPDATE ${TABLE} SET done = 1 WHERE id = ?`, [2]);
      await tx.query(`UPDATE ${TABLE} SET done = 1 WHERE SLEEP(8) = ?`, [0]);
    });

    expect(!result.ok && result.error.message).toContain('interrupted');
    await expect.poll(running).toBe(0);
    expect(await doneIds()).toEqual([]);
  });

  it('a statement that waits for a metadata lock fails at the limit and does not take effect once the lock is free', async () => {
    const altered = await limited.transaction(async (tx) => {
      await tx.query(`SELECT id FROM ${TABLE}`, []);
      return limited.query(`ALTER TABLE ${TABLE} ADD COLUMN extra INT`, []);
    });

    expect(altered.ok && !altered.value.ok && altered.value.error.message).toMatch(/lock wait timeout|interrupted/i);
    await expect.poll(running).toBe(0);
    expect(await sql(`SHOW COLUMNS FROM ${TABLE} LIKE 'extra'`)).toEqual([]);
  });

  it('uses a fresh connection after a statement was stopped', async () => {
    expect((await limited.query(`UPDATE ${TABLE} SET done = 1 WHERE SLEEP(8) = 0`, [])).ok).toBe(false);

    const next = await limited.query(`UPDATE ${TABLE} SET done = 1 WHERE id = ?`, [2]);

    expect(next.ok && next.value.rowCount).toBe(1);
    expect(await doneIds()).toEqual([2]);
  });

  it('marks the row it dispatched when it is stopped mid-poll, and takes no more', async () => {
    const release = gate();
    const source = await start({
      selectQuery: `SELECT id FROM ${TABLE} WHERE done = 0 ORDER BY id`,
      updateQuery: `UPDATE ${TABLE} SET done = 1 WHERE id = \${id}`,
    }, () => release.opened);
    await expect.poll(() => source.rows.length).toBe(1);

    const stopped = source.receiver.onStop();
    release.open();
    await stopped;

    expect(source.rows.map((row) => row['id'])).toEqual([1]);
    expect(await doneIds()).toEqual([1]);
  });

  it('marks the row it dispatched when it is halted mid-poll, without the halt waiting for it', async () => {
    const release = gate();
    const source = await start({
      selectQuery: `SELECT id FROM ${TABLE} WHERE done = 0 ORDER BY id`,
      updateQuery: `UPDATE ${TABLE} SET done = 1 WHERE id = \${id}`,
    }, () => release.opened);
    await expect.poll(() => source.rows.length).toBe(1);

    await source.receiver.onHalt();
    await source.receiver.onUndeploy();
    release.open();

    await expect.poll(doneIds).toEqual([1]);
    expect(source.rows.map((row) => row['id'])).toEqual([1]);
  });

  it('dispatches a row once when the statement that marks it fails, and marks it once it can', async () => {
    await sql(`ALTER TABLE ${TABLE} ADD CONSTRAINT two_waits CHECK (id <> 2 OR done = 0)`);
    const source = await start({
      selectQuery: `SELECT id FROM ${TABLE} WHERE done = 0 ORDER BY id`,
      updateQuery: `UPDATE ${TABLE} SET done = 1 WHERE id = \${id}`,
    });
    await expect.poll(doneIds).toEqual([1, 3]);
    const failures = (): number => source.log.errors.filter((e) => e.msg.includes('UPDATE failed')).length;
    await expect.poll(failures).toBeGreaterThan(3);
    expect(source.rows.map((row) => row['id'])).toEqual([1, 2, 3]);

    await sql(`ALTER TABLE ${TABLE} DROP CONSTRAINT two_waits`);
    await expect.poll(doneIds).toEqual([1, 2, 3]);
    expect(source.rows.map((row) => row['id'])).toEqual([1, 2, 3]);
  });

  it('does not dispatch an unmarked row again after another transaction held it', async () => {
    await sql(`ALTER TABLE ${TABLE} ADD CONSTRAINT two_waits CHECK (id <> 2 OR done = 0)`);
    const source = await start({
      selectQuery: `SELECT id FROM ${TABLE} WHERE done = 0 AND id IN (2, 3) ORDER BY id`,
      updateQuery: `UPDATE ${TABLE} SET done = 1 WHERE id = \${id}`,
    });
    await expect.poll(doneIds).toEqual([3]);
    const failures = (): number => source.log.errors.filter((e) => e.msg.includes('UPDATE failed')).length;

    const held = await limited.transaction(async (tx) => {
      await tx.query(`SELECT id FROM ${TABLE} WHERE id = 2 FOR UPDATE`, []);
      // No poll that began before the lock still runs, and one that began after it has ended: both take row 3.
      for (const round of [1, 2]) {
        await sql(`UPDATE ${TABLE} SET done = 0 WHERE id = 3`);
        await expect.poll(() => source.rows.filter((row) => row['id'] === 3).length).toBe(round + 1);
        await expect.poll(doneIds).toEqual([3]);
      }
    });
    expect(held.ok).toBe(true);

    const before = failures();
    await expect.poll(failures).toBeGreaterThan(before + 1);
    expect(source.rows.filter((row) => row['id'] === 2)).toHaveLength(1);
  });

  it('claims the rows of a query that asks for a share lock', async () => {
    const release = gate();
    const settings = (ids: string): Parameters<typeof start>[0] => ({
      selectQuery: `SELECT id FROM ${TABLE} WHERE done = 0 AND id IN (${ids}) FOR SHARE SKIP LOCKED`,
      updateQuery: `UPDATE ${TABLE} SET done = 1 WHERE id = \${id}`,
    });

    const first = await start(settings('1'), () => release.opened);
    await expect.poll(() => first.rows.length).toBe(1);
    const second = await start(settings('1, 2'));
    // The poll that takes row 2 has seen row 1 as well.
    await expect.poll(() => second.rows.map((row) => row['id'])).toContain(2);
    release.open();
    await expect.poll(doneIds).toEqual([1, 2]);
    await stopSource(second);

    expect(first.rows.map((row) => row['id'])).toEqual([1]);
    expect(second.rows.map((row) => row['id'])).toEqual([2]);
  });
});
