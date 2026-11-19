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

/**
 * Most hashes or comparisons running at once. The thread pool (4 threads by
 * default) also serves file system calls and `dns.lookup`, which connectors and
 * the database driver need; a burst of logins waits here instead of taking every
 * thread (D-324).
 */
export const MAX_CONCURRENT_HASHES = 2;

let running = 0;
const waiting: Array<() => void> = [];

/** Run `work` once fewer than MAX_CONCURRENT_HASHES others are running, in arrival order. */
async function withHashSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running < MAX_CONCURRENT_HASHES) {
    running += 1;
  } else {
    await new Promise<void>((resolve) => { waiting.push(resolve); });
  }
  try {
    return await work();
  } finally {
    // Hand the slot straight to the next caller, so no newcomer can slip in between.
    const next = waiting.shift();
    if (next) next(); else running -= 1;
  }
}

/** A bcrypt hash of `password` at PASSWORD_HASH_COST. */
export function hashPassword(password: string): Promise<string> {
  return withHashSlot(() => bcrypt.hash(password, PASSWORD_HASH_COST));
}

/** Whether `password` matches the bcrypt hash `hash`. */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return withHashSlot(() => bcrypt.compare(password, hash));
}
