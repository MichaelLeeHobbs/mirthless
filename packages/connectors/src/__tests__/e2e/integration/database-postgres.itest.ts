import { it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { ConnectionPool } from '../../../index.js';
import { gate, startSource, stopSource, type RunningSource } from './database-source.js';
import { describeDb, requireDb } from './gates.js';

const TABLE = 'itest_db_source';

describeDb('DATABASE source (real PostgreSQL)', () => {
  const pool = new ConnectionPool();
  let sources: RunningSource[] = [];
  const zone = process.env['TZ'];

  async function sql(text: string): Promise<readonly Record<string, unknown>[]> {
    const result = await pool.query(text, []);
    if (!result.ok) throw result.error;
    return result.value.rows;
  }

  async function start(...args: Parameters<typeof startSource> extends [unknown, ...infer Rest] ? Rest : never): Promise<RunningSource> {
    const source = await startSource(requireDb(), ...args);
    sources.push(source);
    return source;
  }

  async function doneIds(): Promise<readonly unknown[]> {
    return (await sql(`SELECT id FROM ${TABLE} WHERE done ORDER BY id`)).map((row) => row['id']);
  }

  beforeAll(async () => {
    const created = await pool.create(requireDb());
    if (!created.ok) throw created.error;
  });

  beforeEach(async () => {
    await sql(`DROP TABLE IF EXISTS ${TABLE}`);
  });

  afterEach(async () => {
    for (const source of sources) await stopSource(source);
    sources = [];
    if (zone === undefined) delete process.env['TZ'];
    else process.env['TZ'] = zone;
  });

  afterAll(async () => {
    await sql(`DROP TABLE IF EXISTS ${TABLE}`);
    await pool.destroy();
  });

  it.each(['America/Los_Angeles', 'Asia/Tokyo', 'UTC'])('sends every value whole and unshifted with the server in %s', async (tz) => {
    process.env['TZ'] = tz;
    await sql(`CREATE TABLE ${TABLE} (
      d date, ts timestamp, tz timestamptz, ds date[], tss timestamp[], n numeric, ns numeric[], f float8, fs float8[],
      j json, jb jsonb, js jsonb[], i8 bigint, t time, forever timestamptz, iv interval, done boolean NOT NULL DEFAULT false)`);
    await sql(`INSERT INTO ${TABLE} VALUES (
      '2026-01-15', '2026-01-15 00:30:00.123456', '2026-01-15 00:30:00.123456+09', '{2026-01-15,NULL}', '{"2026-01-15 00:30:00.5"}',
      1.10, '{1.10,12345678901234567890.123}', 'NaN', '{1.5,Infinity}',
      '{"a":12345678901234567890,"b":1.5,"c":0.12345678901234567891,"d":"12345678901234567890"}', '[12345678901234567890, 7]',
      ARRAY['{"n":9007199254740993}'::jsonb], 9007199254740993, '00:30:00.123456', 'infinity', '1 day 02:00:00')`);

    const source = await start({ selectQuery: `SELECT * FROM ${TABLE} WHERE NOT done`, updateQuery: `UPDATE ${TABLE} SET done = true` });
    await expect.poll(() => source.rows.length).toBe(1);

    expect(source.rows[0]).toEqual({
      d: '2026-01-15',
      ts: '2026-01-15T00:30:00.123456',
      tz: '2026-01-14T15:30:00.123456Z',
      ds: ['2026-01-15', null],
      tss: ['2026-01-15T00:30:00.500'],
      n: '1.10',
      ns: ['1.10', '12345678901234567890.123'],
      f: 'NaN',
      fs: [1.5, 'Infinity'],
      j: { a: '12345678901234567890', b: 1.5, c: '0.12345678901234567891', d: '12345678901234567890' },
      jb: ['12345678901234567890', 7],
      js: [{ n: '9007199254740993' }],
      i8: '9007199254740993',
      t: '00:30:00.123456',
      forever: 'infinity',
      iv: { days: 1, hours: 2 },
      done: false,
    });
  });

  it('gives the mark statement the values the row has, so it finds the row by its time', async () => {
    process.env['TZ'] = 'America/Los_Angeles';
    await sql(`CREATE TABLE ${TABLE} (id int, d date, ts timestamp, tz timestamptz, ns numeric[], done boolean NOT NULL DEFAULT false)`);
    await sql(`INSERT INTO ${TABLE} VALUES (1, '2026-01-15', '2026-01-15 00:30:00.123456', '2026-01-15 00:30:00.654321+09', '{1.10,12345678901234567890.123}')`);

    await start({
      selectQuery: `SELECT * FROM ${TABLE} WHERE NOT done`,
      updateQuery: `UPDATE ${TABLE} SET done = true WHERE d = \${d} AND ts = \${ts} AND tz = \${tz} AND ns = \${ns}`,
    });

    await expect.poll(doneIds).toEqual([1]);
  });

  it('dispatches a row once when the statement that marks it fails, and marks it once it can', async () => {
    await sql(`CREATE TABLE ${TABLE} (id int, done boolean NOT NULL DEFAULT false, CONSTRAINT two_waits CHECK (id <> 2 OR NOT done))`);
    await sql(`INSERT INTO ${TABLE} (id) VALUES (1), (2), (3)`);

    const source = await start({
      selectQuery: `SELECT id FROM ${TABLE} WHERE NOT done ORDER BY id`,
      updateQuery: `UPDATE ${TABLE} SET done = true WHERE id = \${id}`,
    });
    await expect.poll(doneIds).toEqual([1, 3]);
    const failures = (): number => source.log.errors.filter((e) => e.msg.includes('UPDATE failed')).length;
    await expect.poll(failures).toBeGreaterThan(3);
    expect(source.rows.map((row) => row['id'])).toEqual([1, 2, 3]);

    await sql(`ALTER TABLE ${TABLE} DROP CONSTRAINT two_waits`);
    await expect.poll(doneIds).toEqual([1, 2, 3]);
    expect(source.rows.map((row) => row['id'])).toEqual([1, 2, 3]);
  });

  it('claims the rows of a query that asks for a share lock', async () => {
    await sql(`CREATE TABLE ${TABLE} (id int PRIMARY KEY, done boolean NOT NULL DEFAULT false)`);
    await sql(`INSERT INTO ${TABLE} (id) VALUES (1)`);
    const release = gate();
    const settings = {
      selectQuery: `SELECT id FROM ${TABLE} WHERE NOT done FOR SHARE`,
      updateQuery: `UPDATE ${TABLE} SET done = true WHERE id = \${id}`,
    };

    const first = await start(settings, () => release.opened);
    await expect.poll(() => first.rows.length).toBe(1);
    const second = await start(settings);
    const waiting = `SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%${TABLE}%'`;
    await expect.poll(async () => second.rows.length + (await sql(waiting)).length).toBeGreaterThan(0);
    release.open();
    await expect.poll(doneIds).toEqual([1]);
    await stopSource(second);

    expect([...first.rows, ...second.rows]).toHaveLength(1);
  });

  it('takes no more rows once it is stopped, and marks the one it dispatched', async () => {
    await sql(`CREATE TABLE ${TABLE} (id int, done boolean NOT NULL DEFAULT false)`);
    await sql(`INSERT INTO ${TABLE} (id) VALUES (1), (2), (3)`);
    const release = gate();
    const source = await start({
      selectQuery: `SELECT id FROM ${TABLE} WHERE NOT done ORDER BY id`,
      updateQuery: `UPDATE ${TABLE} SET done = true WHERE id = \${id}`,
    }, () => release.opened);
    await expect.poll(() => source.rows.length).toBe(1);

    const stopped = source.receiver.onStop();
    release.open();
    await stopped;

    expect(source.rows.map((row) => row['id'])).toEqual([1]);
    expect(await doneIds()).toEqual([1]);
  });

  it('reports a statement over its limit as the server stopped it, so it has not taken effect', async () => {
    await sql(`CREATE TABLE ${TABLE} (id int)`);
    const limited = new ConnectionPool();
    expect((await limited.create({ ...requireDb(), statementTimeoutMs: 300 })).ok).toBe(true);
    try {
      const result = await limited.query(`INSERT INTO ${TABLE} SELECT 1 FROM pg_sleep(20)`, []);
      expect(!result.ok && result.error.message).toContain('canceling statement due to statement timeout');
      expect(await sql(`SELECT * FROM ${TABLE}`)).toEqual([]);
    } finally {
      await limited.destroy();
    }
  });
});
