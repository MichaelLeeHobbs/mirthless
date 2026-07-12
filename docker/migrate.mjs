// ===========================================
// Standalone Migration Runner (production image)
// ===========================================
// Applies Drizzle migrations using drizzle-orm's built-in migrator.
// This avoids shipping drizzle-kit (a devDependency) in the runtime image —
// drizzle-orm and pg are both production dependencies of @mirthless/server.
//
// Runs at container start via docker/server-entrypoint.sh. Fail-loud: a
// non-zero exit stops the container before the server boots against an
// un-migrated schema.
//
// Placed at /app/packages/server/migrate.mjs so Node resolves drizzle-orm
// and pg from packages/server/node_modules. Migrations are copied to the
// sibling ./migrations directory (including meta/_journal.json).

import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[migrate] DATABASE_URL is not set');
  process.exit(1);
}

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));
const useSsl = process.env.DATABASE_SSL === 'true';

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});
const db = drizzle(pool);

try {
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log('[migrate] migrations applied');
} catch (err) {
  console.error('[migrate] migration failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
