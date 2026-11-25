// Builds a throwaway database at migration 0017, when each user's permissions
// came from users.role through a table in code, then applies the remaining
// migrations: each user must hold exactly the permissions they held before (#265).

import type pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeIntegration } from './_setup.js';
import { migratedFrom, type MigrationDb } from './_migration-db.js';

const LAST_BEFORE_ROLES = 17;

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

describeIntegration('role migration (real Postgres)', () => {
  let migrated: MigrationDb;
  let client: pg.Client;
  const userIds = new Map<string, string>();

  beforeAll(async () => {
    migrated = await migratedFrom(LAST_BEFORE_ROLES, async (before) => {
      for (const role of Object.keys(BEFORE)) {
        const { rows } = await before.query<{ id: string }>(
          `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, 'not-a-hash', $3) RETURNING id`,
          [`mig-${role}`, `mig-${role}@example.test`, role],
        );
        userIds.set(role, rows[0]!.id);
      }
    });
    client = migrated.client;
  });

  afterAll(async () => {
    await migrated?.drop();
  });

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
