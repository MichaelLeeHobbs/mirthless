// A failed statement's error text reaches logs, alerts and stored messages, so it
// must hold none of the statement's parameters.

import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { tryCatch } from 'stderr-lib';
import { describe, expect, it } from 'vitest';
import { QueryError } from '../query-error.js';

const SECRET = 'hunter2';
const notes = pgTable('notes', { id: text('id'), body: text('body') });

type Db = NodePgDatabase<{ readonly notes: typeof notes }>;

function failingWith(cause: unknown): Db {
  return drizzle({ query: () => Promise.reject(cause as Error) } as never, { schema: { notes } });
}

async function thrownBy(run: () => PromiseLike<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('It did not fail');
}

/** As pg builds it: the values are in these properties. */
const refusal = (): Error => Object.assign(new Error('duplicate key'), {
  code: '23505', constraint: 'notes_body_idx', table: 'notes',
  detail: `Key (body)=(${SECRET}) already exists.`, where: `row "${SECRET}"`, internalQuery: `SELECT '${SECRET}'`,
});

describe('a failed statement', () => {
  it.each([
    ['an insert', (db: Db) => db.insert(notes).values({ id: '1', body: SECRET })],
    ['an insert that returns rows', (db: Db) => db.insert(notes).values({ id: '1', body: SECRET }).returning()],
    ['an update', (db: Db) => db.update(notes).set({ body: SECRET }).where(eq(notes.id, '1'))],
    ['a select', (db: Db) => db.select().from(notes).where(eq(notes.body, SECRET))],
    ['a delete', (db: Db) => db.delete(notes).where(eq(notes.body, SECRET))],
    ['raw SQL', (db: Db) => db.execute(sql`SELECT ${SECRET}`)],
    ['a count', (db: Db) => db.$count(notes, eq(notes.body, SECRET))],
    ['a prepared statement', (db: Db) => db.select().from(notes).where(eq(notes.body, sql.placeholder('body'))).prepare('p').execute({ body: SECRET })],
    ['a relational query', (db: Db) => db.query.notes.findFirst({ where: eq(notes.body, SECRET) })],
  ])('names the statement and the reason, and no parameter: %s', async (_what, run) => {
    const refused = refusal();
    const err = await thrownBy(() => run(failingWith(refused)));

    expect(err).toBeInstanceOf(QueryError);
    const { message, stack } = err as QueryError;
    expect(message).toMatch(/^Failed query \(23505, notes_body_idx\): (insert|update|select|delete)/i);
    expect(inspect(err, { depth: 10 })).not.toContain(SECRET);
    expect(message + String(stack)).not.toContain(SECRET);
    expect(String(stack)).toContain('query-error.test');
    expect((err as QueryError).cause).toBe(refused);
    expect(refused).toMatchObject({ message: 'duplicate key', code: '23505', constraint: 'notes_body_idx', table: 'notes' });
  });

  it('says why the driver failed when the database did not answer', async () => {
    const err = await thrownBy(() => failingWith(new Error('timeout exceeded when trying to connect')).insert(notes).values({ body: SECRET }));
    expect((err as Error).message).toMatch(/^Failed query \(timeout exceeded when trying to connect\): insert/);
    expect((err as Error).message).not.toContain(SECRET);
  });

  it.each([undefined, null, 'text', { code: 7 }])('is an error without a reason when the cause is %j', async (cause) => {
    const err = await thrownBy(() => failingWith(cause).insert(notes).values({ body: SECRET }));
    expect((err as Error).message).toMatch(/^Failed query: insert/);
    expect(inspect(err)).not.toContain(SECRET);
  });

  it('keeps its parameters out of a Result and of what a logger or the console prints of it', async () => {
    const result = await tryCatch(async () => { await failingWith(refusal()).insert(notes).values({ body: SECRET }); });

    expect(result.ok).toBe(false);
    expect(inspect(result.error, { depth: 10 })).not.toContain(SECRET);
    expect(JSON.stringify(result.error)).not.toContain(SECRET);
    expect(String(result.error)).not.toContain(SECRET);
    expect(JSON.stringify(result.error)).toContain('23505');
  });

  it('leaves an error that a transaction\'s own code throws as it is', async () => {
    const own = new Error('mine');
    const db = drizzle({ query: () => Promise.resolve({ rows: [] }) } as never);
    expect(await thrownBy(() => db.transaction(() => Promise.reject(own)))).toBe(own);
  });

  it('is converted inside a transaction too', async () => {
    const db = drizzle({
      query: (q: { text: string }) => (q.text.startsWith('insert') ? Promise.reject(refusal()) : Promise.resolve({ rows: [] })),
    } as never);
    const err = await thrownBy(() => db.transaction(async (tx) => { await tx.insert(notes).values({ body: SECRET }); }));
    expect(err).toBeInstanceOf(QueryError);
    expect((err as Error).message).not.toContain(SECRET);
  });
});

describe('every file that makes a Drizzle client', () => {
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));
  const files = [...globSync('packages/server/src/**/*.ts', { cwd: root }), ...globSync('docker/*.mjs', { cwd: root })]
    .filter((file) => !/__tests__/.test(file))
    .filter((file) => /\bdrizzle\(/.test(readFileSync(root + file, 'utf8')));

  it('is found', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files)('imports query-error: %s', (file) => {
    expect(readFileSync(root + file, 'utf8')).toMatch(/^import '.*\/query-error\.js';$/m);
  });
});
