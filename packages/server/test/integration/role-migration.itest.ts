// ===========================================
// Roles become rows: nobody's access changes (real Postgres, #265 slice 6)
// ===========================================
// Builds a throwaway database at migration 0017, when each user's permissions
// came from users.role through a table in code, adds a user for every role the
// code knew plus one it did not, then applies the remaining migrations. Each
// user must hold exactly the permissions they held before, now resolved from
// their assignments by the resolver every request uses. The built-in role rows
// the migration wrote must match db/seeds/roles.ts.

import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeIntegration } from './_setup.js';

const MIGRATIONS = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const LAST_BEFORE_ROLES = 17;
const DB_NAME = `gf_rolemig_${randomUUID().replace(/-/g, '').slice(0, 12)}_test`;

/** What each role granted before roles were rows (lib/role-permissions.ts at 0017). Unknown roles granted nothing. */
const BEFORE: Readonly<Record<string, readonly string[] | 'all'>> = {
  admin: 'all',
  deployer: [
    'channels:read', 'channels:write', 'channels:deploy', 'messages:read', 'messages:reprocess',
    'code_templates:read', 'code_templates:write', 'code_templates:delete',
    'alerts:read', 'alerts:write', 'alerts:delete', 'events:read',
    'resources:read', 'resources:write', 'resources:delete',
    'collections:read', 'collections:write', 'collections:delete',
    'datasources:read', 'datasources:write', 'datasources:delete',
    'global_scripts:read', 'global_map:read', 'config_map:read', 'system:info',
  ],
  developer: [
    'channels:read', 'channels:write', 'messages:read', 'code_templates:read', 'code_templates:write',
    'alerts:read', 'events:read', 'resources:read', 'resources:write', 'collections:read', 'collections:write',
    'datasources:read', 'global_scripts:read', 'global_map:read', 'config_map:read',
  ],
  viewer: [
    'channels:read', 'messages:read', 'code_templates:read', 'alerts:read', 'events:read',
    'resources:read', 'collections:read', 'datasources:read',
  ],
  wizard: [],
};

function urlFor(database: string): string {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${database}`;
  return url.toString();
}

/** A copy of the migrations folder holding only the migrations up to `last`. */
function migrationsUpTo(last: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gf-rolemig-'));
  mkdirSync(path.join(dir, 'meta'));
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
  const entries = journal.entries.filter((e) => e.idx <= last);
  for (const e of entries) cpSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  return dir;
}

describeIntegration('role migration (real Postgres)', () => {
  let admin: pg.Client;
  let client: pg.Client;
  let partial: string;
  const userIds = new Map<string, string>();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${DB_NAME}"`);
    client = new pg.Client({ connectionString: urlFor(DB_NAME) });
    await client.connect();

    partial = migrationsUpTo(LAST_BEFORE_ROLES);
    await migrate(drizzle(client), { migrationsFolder: partial });
    for (const role of Object.keys(BEFORE)) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, 'not-a-hash', $3) RETURNING id`,
        [`mig-${role}`, `mig-${role}@example.test`, role],
      );
      userIds.set(role, rows[0]!.id);
    }
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  }, 120_000);

  // Dropping a migrated database is server work a loaded machine slows down: the
  // teardown gets the setup's budget, not the 30 s default (#294).
  afterAll(async () => {
    await client?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
      await admin.end();
    }
    if (partial) rmSync(partial, { recursive: true, force: true });
  }, 120_000);

  it('leaves every user holding exactly the permissions their role gave them', async () => {
    const { queryUserStanding } = await import('../../src/lib/principal.js');
    const { PERMISSIONS } = await import('@galvanigraph/core-models');
    const all = Object.values(PERMISSIONS).sort();
    for (const [role, before] of Object.entries(BEFORE)) {
      const standing = await queryUserStanding(drizzle(client), userIds.get(role)!);
      const expected = before === 'all' ? all : [...before].sort();
      expect(standing?.permissions, role).toEqual(expected);
      expect(standing?.roles, role).toEqual(before === 'all' || before.length > 0 ? [role] : []);
    }
  });

  it('drops users.role and the unused user_permissions table', async () => {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role'`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
    const tables = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'user_permissions'`);
    expect(tables.rowCount).toBe(0);
  });

  it('refuses a second admin role: the last-admin lock and the resolver assume one', async () => {
    const UNIQUE_VIOLATION = '23505';
    const code = await client.query(`INSERT INTO roles (name, admin) VALUES ('second-admin', true)`)
      .then(() => undefined, (err: { code?: string }) => err.code);
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it('writes the built-in roles exactly as db/seeds/roles.ts defines them', async () => {
    const { defaultRoles } = await import('../../src/db/seeds/roles.js');
    const { rows } = await client.query<{ name: string; admin: boolean; built_in: boolean; description: string; permissions: string[] }>(
      `SELECT r.name, r.admin, r.built_in, r.description,
              coalesce(array_agg(rp.permission ORDER BY rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.name`,
    );
    const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : 1);
    const actual = rows.map((r) => ({ ...r, permissions: [...r.permissions].sort() })).sort(byName);
    const expected = defaultRoles
      .map((r) => ({
        name: r.name, admin: r.admin, built_in: true, description: r.description,
        permissions: r.admin ? [] : [...r.permissions].sort(),
      }))
      .sort(byName);
    expect(actual).toEqual(expected);
  });
});
