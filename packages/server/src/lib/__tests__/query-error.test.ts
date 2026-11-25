// A failed statement's error text reaches logs, alerts and stored messages, so it
// must hold none of the statement's parameters.

import { inspect } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { tryCatch } from 'stderr-lib';
import { describe, expect, it } from 'vitest';
import { QueryError } from '../query-error.js';

const SECRET = 'hunter2';
const notes = pgTable('notes', { id: text('id'), body: text('body') });

function failingWith(cause: unknown): NodePgDatabase {
  return drizzle({ query: () => Promise.reject(cause as Error) } as never);
}

async function thrownBy(run: () => PromiseLike<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('It did not fail');
}

const refused = Object.assign(new Error(`duplicate key`), { code: '23505', constraint: 'notes_body_idx', detail: `Key (body)=(${SECRET}) already exists.` });

describe('a failed statement', () => {
  it.each([
    ['an insert', (db: NodePgDatabase) => db.insert(notes).values({ id: '1', body: SECRET })],
    ['an insert that returns rows', (db: NodePgDatabase) => db.insert(notes).values({ id: '1', body: SECRET }).returning()],
    ['an update', (db: NodePgDatabase) => db.update(notes).set({ body: SECRET }).where(eq(notes.id, '1'))],
    ['a select', (db: NodePgDatabase) => db.select().from(notes).where(eq(notes.body, SECRET))],
    ['a delete', (db: NodePgDatabase) => db.delete(notes).where(eq(notes.body, SECRET))],
    ['raw SQL', (db: NodePgDatabase) => db.execute(sql`SELECT ${SECRET}`)],
  ])('names the statement and the reason, and no parameter: %s', async (_what, run) => {
    const err = await thrownBy(() => run(failingWith(refused)));

    expect(err).toBeInstanceOf(QueryError);
    const { message, stack } = err as QueryError;
    expect(message).toMatch(/^Failed query \(23505, notes_body_idx\): (insert|update|select|delete)/i);
    expect(message + String(stack)).not.toContain(SECRET);
    expect(String(stack)).toContain('query-error.test');
    expect((err as QueryError).cause).toBe(refused);
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
    const cause = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    const result = await tryCatch(async () => { await failingWith(cause).insert(notes).values({ body: SECRET }); });

    expect(result.ok).toBe(false);
    expect(inspect(result.error, { depth: 10 })).not.toContain(SECRET);
    expect(JSON.stringify(result.error)).not.toContain(SECRET);
    expect(JSON.stringify(result.error)).toContain('57014');
  });

  it('leaves an error that a transaction\'s own code throws as it is', async () => {
    const own = new Error('mine');
    const db = drizzle({ query: () => Promise.resolve({ rows: [] }) } as never);
    expect(await thrownBy(() => db.transaction(() => Promise.reject(own)))).toBe(own);
  });

  it('is converted inside a transaction too', async () => {
    const db = drizzle({
      query: (q: { text: string }) => (q.text.startsWith('insert') ? Promise.reject(refused) : Promise.resolve({ rows: [] })),
    } as never);
    const err = await thrownBy(() => db.transaction(async (tx) => { await tx.insert(notes).values({ body: SECRET }); }));
    expect(err).toBeInstanceOf(QueryError);
    expect((err as Error).message).not.toContain(SECRET);
  });
});
