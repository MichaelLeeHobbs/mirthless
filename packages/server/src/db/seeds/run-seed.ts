// Idempotent: safe to run more than once. The built-in roles are rows written by
// migration 0018 (db/seeds/roles.ts). Demo content is never seeded by default in
// production, where it would add a global preprocessor that runs on every channel,
// a data source with a dev password, an enabled alert and fabricated messages.

import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';

import { DEFAULT_GROUP_NAME } from '@galvanigraph/core-models';
import * as schema from '../schema/index.js';
import { defaultSettings } from './settings.js';
import { demoDataEnabled } from './seed-options.js';
import { hashPassword } from '../../lib/password.js';
import '../../lib/query-error.js';

loadEnv({ path: '../../.env', quiet: true });
loadEnv({ path: '.env', quiet: true });

const ADMIN_USERNAME = 'admin';
const ADMIN_EMAIL = 'admin@galvanigraph.local';
const ADMIN_PASSWORD = 'Admin123!';

/** Same TLS rules as the server pool (lib/db.ts buildDbSslConfig). */
function seedSslConfig(): false | { rejectUnauthorized: boolean; ca?: string } {
  if (process.env['DATABASE_SSL'] !== 'true') return false;
  const ca = process.env['DATABASE_SSL_CA'];
  return {
    rejectUnauthorized: process.env['DATABASE_SSL_REJECT_UNAUTHORIZED'] !== 'false',
    ...(ca ? { ca } : {}),
  };
}

async function seed(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  // The server pool's idle timeout (lib/db.ts), not pg's 10s default, so a pool
  // left open holds the process long enough for seed-exit.itest.ts to notice.
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: seedSslConfig(), idleTimeoutMillis: 30_000 });
  const db = drizzle(pool, { schema });

  try {
    await db.transaction(async (tx) => {
      // eslint-disable-next-line no-console
      console.log('Seeding system settings...');
      for (const setting of defaultSettings) {
        const [existing] = await tx
          .select()
          .from(schema.systemSettings)
          .where(eq(schema.systemSettings.key, setting.key));

        if (!existing) {
          await tx.insert(schema.systemSettings).values(setting);
          // eslint-disable-next-line no-console
          console.log(`  + ${setting.key}`);
        } else {
          // eslint-disable-next-line no-console
          console.log(`  = ${setting.key} (exists)`);
        }
      }

      // eslint-disable-next-line no-console
      console.log('\nSeeding admin user...');
      const [existingAdmin] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, ADMIN_USERNAME));

      let adminId: string;

      if (!existingAdmin) {
        const passwordHash = await hashPassword(ADMIN_PASSWORD);
        const [admin] = await tx
          .insert(schema.users)
          .values({
            username: ADMIN_USERNAME,
            email: ADMIN_EMAIL,
            passwordHash,
            enabled: true,
            mustChangePassword: true,
          })
          .returning({ id: schema.users.id });

        if (!admin) {
          throw new Error('Failed to create admin user');
        }

        adminId = admin.id;
        // eslint-disable-next-line no-console
        console.log(`  + Created admin user (${ADMIN_USERNAME} / ${ADMIN_PASSWORD})`);
      } else {
        adminId = existingAdmin.id;
        // eslint-disable-next-line no-console
        console.log(`  = Admin user exists (${ADMIN_USERNAME})`);
      }

      // eslint-disable-next-line no-console
      console.log('\nSeeding the admin assignment...');
      const [adminRole] = await tx.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.admin, true));
      if (!adminRole) {
        throw new Error('The admin role is missing; run the migrations first');
      }
      const [held] = await tx
        .select({ id: schema.assignments.id })
        .from(schema.assignments)
        .where(eq(schema.assignments.userId, adminId));
      if (!held) {
        await tx.insert(schema.assignments).values({ userId: adminId, roleId: adminRole.id, reason: 'Seeded admin' });
        // Written here directly, not through GrantService, so the access replay
        // starts again from a baseline that includes it (migration 0022).
        await tx.execute(sql`SELECT public.record_grant_baseline('seed: admin assignment')`);
        // eslint-disable-next-line no-console
        console.log('  + admin');
      } else {
        // eslint-disable-next-line no-console
        console.log('  = admin user already holds a role');
      }

      // eslint-disable-next-line no-console
      console.log('\nSeeding default channel group...');
      const [existingGroup] = await tx
        .select()
        .from(schema.channelGroups)
        .where(eq(schema.channelGroups.name, DEFAULT_GROUP_NAME));

      if (!existingGroup) {
        await tx.insert(schema.channelGroups).values({
          name: DEFAULT_GROUP_NAME,
          description: 'Default group for new channels',
        });
        // eslint-disable-next-line no-console
        console.log(`  + Created "${DEFAULT_GROUP_NAME}" channel group`);
      } else {
        // eslint-disable-next-line no-console
        console.log(`  = "${DEFAULT_GROUP_NAME}" channel group exists`);
      }

      // eslint-disable-next-line no-console
      console.log('\nSeed complete.');
    });

    if (!demoDataEnabled(process.env)) {
      // eslint-disable-next-line no-console
      console.log('\nSkipping demo content (set SEED_DEMO_DATA=true to seed example channels and data).');
      return;
    }

    // Separate from the main transaction: it uses channel IDs.
    const { seedExampleChannels } = await import('./seed-examples.js');
    const exampleDb = drizzle(pool, { schema });
    await seedExampleChannels(exampleDb);
    // The example channels joined groups directly; start the access replay after them.
    await exampleDb.execute(sql`SELECT public.record_grant_baseline('seed: example channels')`);

    const { seedShowcase } = await import('./seed-showcase.js');
    await seedShowcase(exampleDb);

    // seedExampleMessages writes through the server's db singleton, so close that
    // pool too: its idle connections would keep the process alive for 30s.
    const { seedExampleMessages } = await import('./seed-example-messages.js');
    const { pool: serverPool } = await import('../../lib/db.js');
    try {
      await seedExampleMessages();
    } finally {
      await serverPool.end();
    }
  } finally {
    await pool.end();
  }
}

seed().then(
  () => {
    // Printed once every pool is closed. seed-exit.itest.ts times the exit from
    // this line, so keep the text in step with SEED_FINISHED there.
    // eslint-disable-next-line no-console
    console.log('\nSeed finished.');
  },
  (err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    process.exit(1);
  },
);
