// Native bcrypt hashes on libuv's thread pool, off the event loop (#257, D-324).
// It reads the `$2a$` and `$2b$` hashes bcryptjs wrote.

import bcrypt from 'bcrypt';

export const PASSWORD_HASH_COST = 12;

/**
 * The thread pool (4 threads by default) also serves file system calls and
 * `dns.lookup`, which connectors and the database driver need (D-324).
 */
export const MAX_CONCURRENT_HASHES = 2;

let running = 0;
const waiting: Array<() => void> = [];

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

export function hashPassword(password: string): Promise<string> {
  return withHashSlot(() => bcrypt.hash(password, PASSWORD_HASH_COST));
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return withHashSlot(() => bcrypt.compare(password, hash));
}
