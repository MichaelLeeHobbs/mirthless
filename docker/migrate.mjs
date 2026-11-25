// drizzle-orm's migrator, not drizzle-kit, so the runtime image needs no devDependencies (D-155).
// Migrations run as the table owner (MIGRATION_DATABASE_URL); the server runs as its own role (D-307).
// Every failure exits non-zero so the container stops before the server boots un-migrated or as the wrong role.
// The image copies this file to packages/server/ so drizzle-orm and pg resolve from its node_modules.

import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { checkRuntimeRole, provisionRuntimeRole, runtimeRoleFromUrl } from './dist/db/runtime-role.js';
import './dist/lib/query-error.js';

const ROLES_DOC = 'docs/ops/upgrade.md#database-roles';
const databaseUrl = process.env.DATABASE_URL;
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) {
  console.error('[migrate] DATABASE_URL is not set');
  process.exit(1);
}
if (!migrationUrl) {
  console.error(
    '[migrate] MIGRATION_DATABASE_URL is not set. Migrations run as the role that owns the tables, '
    + `and the server (DATABASE_URL) runs as its own role that owns none. See ${ROLES_DOC}`,
  );
  process.exit(1);
}

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));
// Keep in step with buildDbSslConfig() in packages/server/src/lib/db.ts.
const useSsl = process.env.DATABASE_SSL === 'true';
const ssl = useSsl
  ? {
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
      ...(process.env.DATABASE_SSL_CA ? { ca: process.env.DATABASE_SSL_CA } : {}),
    }
  : false;

async function withClient(connectionString, work) {
  const client = new pg.Client({ connectionString, ssl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function failOn(label, result) {
  if (result.ok) return;
  console.error(`[migrate] ${label}: ${result.error.message}`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: migrationUrl, ssl });
try {
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(drizzle(pool), { migrationsFolder });
  console.log('[migrate] migrations applied');
} catch (err) {
  console.error('[migrate] migration failed:', err);
  process.exit(1);
} finally {
  await pool.end();
}

const role = runtimeRoleFromUrl(databaseUrl);
failOn('reading the server role from DATABASE_URL', role);
const ownerRole = runtimeRoleFromUrl(migrationUrl);
failOn('reading the owner from MIGRATION_DATABASE_URL', ownerRole);
if (role.value.password.length > 0 && role.value.password === ownerRole.value.password) {
  console.error(`[migrate] the server role and the owner have the same password. Give POSTGRES_APP_PASSWORD its own value; see ${ROLES_DOC}`);
  process.exit(1);
}
failOn(
  `granting the server role "${role.value.user}"`,
  await withClient(migrationUrl, (owner) => provisionRuntimeRole(owner, role.value)),
);
failOn('checking the server role', await withClient(databaseUrl, (runtime) => checkRuntimeRole(runtime)));
console.log(`[migrate] the server runs as "${role.value.user}", which owns no application tables`);
