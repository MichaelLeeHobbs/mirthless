// ===========================================
// Startup Security Checks
// ===========================================
// Loud, non-fatal warnings for insecure defaults at boot.

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from './db.js';
import { users } from '../db/schema/index.js';
import logger from './logger.js';

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'Admin123!';

/**
 * Warn loudly if the seeded admin still uses the default password. Never throws —
 * a failed check must not prevent the server from starting.
 */
export async function warnIfDefaultAdminPassword(): Promise<void> {
  try {
    const [admin] = await db
      .select({ passwordHash: users.passwordHash, mustChangePassword: users.mustChangePassword })
      .from(users)
      .where(eq(users.username, DEFAULT_ADMIN_USERNAME));

    if (!admin) {
      return;
    }

    const usingDefault = await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, admin.passwordHash);
    if (usingDefault) {
      logger.warn(
        { mustChangePassword: admin.mustChangePassword },
        'SECURITY: the default admin account is still using the default password. Change it immediately.',
      );
    }
  } catch (err: unknown) {
    logger.warn(
      { errMsg: err instanceof Error ? err.message : String(err) },
      'Default admin password check failed',
    );
  }
}
