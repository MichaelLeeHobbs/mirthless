// ===========================================
// Standalone Migration Runner (production image)
// ===========================================
// Applies Drizzle migrations using drizzle-orm's built-in migrator.
// This avoids shipping drizzle-kit (a devDependency) in the runtime image —
// drizzle-orm and pg are both production dependencies of @galvaniflow/server.
//
// Two database roles (D-307): MIGRATION_DATABASE_URL is the role that owns the
// tables, and runs the migrations. DATABASE_URL is the server's own role, which
// owns no application tables. After migrating, the owner creates the server's role if it is
// missing, sets its password from DATABASE_URL and grants it what the server
// needs (packages/server/src/db/runtime-role.ts). Then the server's connection is
// checked: it must not be a superuser or have the owner's rights.
//
// Runs at container start via docker/server-entrypoint.sh. Fail-loud: a
// non-zero exit stops the container before the server boots against an
// un-migrated schema or as the wrong role.
//
// Placed at /app/packages/server/migrate.mjs so Node resolves drizzle-orm
// and pg from packages/server/node_modules. Migrations are copied to the
// sibling ./migrations directory (including meta/_journal.json).

import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { checkRuntimeRole, provisionRuntimeRole, runtimeRoleFromUrl } from './dist/db/runtime-role.js';

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
// Mirrors buildDbSslConfig() in packages/server/src/lib/db.ts: verify the server
// certificate by default; opt out only with DATABASE_SSL_REJECT_UNAUTHORIZED=false.
const useSsl = process.env.DATABASE_SSL === 'true';
const ssl = useSsl
  ? {
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
      ...(process.env.DATABASE_SSL_CA ? { ca: process.env.DATABASE_SSL_CA } : {}),
    }
  : false;

/** Open a client on `connectionString`, run `work` with it, and close it. */
async function withClient(connectionString, work) {
  const client = new pg.Client({ connectionString, ssl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Exit with `label` and the error's message when a Result failed. */
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
