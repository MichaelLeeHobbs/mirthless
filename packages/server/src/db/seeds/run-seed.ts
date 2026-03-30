// ===========================================
// Database Seed Script
// ===========================================
// Idempotent seed: safe to run multiple times.
// Seeds: settings -> permissions -> roles -> admin user
//
// Usage: tsx src/db/seeds/run-seed.ts

import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

import { DEFAULT_GROUP_NAME } from '@mirthless/core-models';
import * as schema from '../schema/index.js';
import { defaultSettings } from './settings.js';
import { defaultPermissions } from './permissions.js';

loadEnv({ path: '../../.env' });
loadEnv({ path: '.env' });

const SALT_ROUNDS = 12;
const ADMIN_USERNAME = 'admin';
const ADMIN_EMAIL = 'admin@mirthless.local';
const ADMIN_PASSWORD = 'Admin123!';

async function seed(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
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
        const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
        const [admin] = await tx
          .insert(schema.users)
          .values({
            username: ADMIN_USERNAME,
            email: ADMIN_EMAIL,
            passwordHash,
            role: 'admin',
            enabled: true,
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
      console.log('\nSeeding permissions for admin...');

      // Load existing admin permissions once
      const existingPerms = await tx
        .select({ resource: schema.userPermissions.resource, action: schema.userPermissions.action })
        .from(schema.userPermissions)
        .where(eq(schema.userPermissions.userId, adminId));

      const existingPermSet = new Set(
        existingPerms.map((p) => `${p.resource}:${p.action}`)
      );

      for (const permDef of defaultPermissions) {
        if (existingPermSet.has(permDef.name)) {
          // eslint-disable-next-line no-console
          console.log(`  = ${permDef.name} (exists)`);
          continue;
        }

        await tx.insert(schema.userPermissions).values({
          userId: adminId,
          resource: permDef.resource,
          action: permDef.action,
          scope: 'all',
        });
        // eslint-disable-next-line no-console
        console.log(`  + ${permDef.name}`);
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

    // Seed example channels (separate from main transaction — uses channel IDs)
    const { seedExampleChannels } = await import('./seed-examples.js');
    const exampleDb = drizzle(pool, { schema });
    await seedExampleChannels(exampleDb);
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  process.exit(1);
});
