// ===========================================
// Password hashing
// ===========================================
// Passwords are stored as bcrypt hashes. The native bcrypt package hashes and
// compares on libuv's thread pool, so a burst of logins leaves the event loop
// free for the API and message processing; bcryptjs, used before, did the work
// on the event loop (#257, D-324). It reads the `$2a$` and `$2b$` hashes that
// bcryptjs wrote, so no password has to be reset.

import bcrypt from 'bcrypt';

/** bcrypt cost for new hashes. */
export const PASSWORD_HASH_COST = 12;

/** A bcrypt hash of `password` at PASSWORD_HASH_COST. */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_HASH_COST);
}

/** Whether `password` matches the bcrypt hash `hash`. */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
