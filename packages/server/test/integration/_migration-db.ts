// A throwaway database at an earlier migration, filled, then taken to the newest one.

import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const MIGRATIONS = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

function urlFor(database: string): string {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${database}`;
  return url.toString();
}

function migrationsUpTo(last: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gf-migration-'));
  mkdirSync(path.join(dir, 'meta'));
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
  const entries = journal.entries.filter((e) => e.idx <= last);
  for (const e of entries) cpSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  return dir;
}

export interface MigrationDb {
  readonly client: pg.Client;
  drop(): Promise<void>;
}

/** `last`: the last migration already applied when `fill` runs. */
export async function migratedFrom(last: number, fill: (client: pg.Client) => Promise<void>): Promise<MigrationDb> {
  const name = `gf_migration_${randomUUID().replace(/-/g, '').slice(0, 12)}_test`;
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  const client = new pg.Client({ connectionString: urlFor(name) });
  const drop = async (): Promise<void> => {
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  };
  await admin.query(`CREATE DATABASE "${name}"`);
  const partial = migrationsUpTo(last);
  try {
    await client.connect();
    await migrate(drizzle(client), { migrationsFolder: partial });
    await fill(client);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  } catch (error) {
    await drop();
    throw error;
  } finally {
    rmSync(partial, { recursive: true, force: true });
  }
  return { client, drop };
}
