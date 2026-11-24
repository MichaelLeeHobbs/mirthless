// Native bcrypt hashes on libuv's thread pool, off the event loop (#257, D-324).
// It reads the `$2a$` and `$2b$` hashes bcryptjs wrote.

import bcrypt from 'bcrypt';
import { createSlots } from '@galvanigraph/core-util';

export const PASSWORD_HASH_COST = 12;

/**
 * The thread pool (4 threads by default) also serves file system calls and
 * `dns.lookup`, which connectors and the database driver need (D-324).
 */
export const MAX_CONCURRENT_HASHES = 2;

const withHashSlot = createSlots(MAX_CONCURRENT_HASHES);

export function hashPassword(password: string): Promise<string> {
  return withHashSlot(() => bcrypt.hash(password, PASSWORD_HASH_COST));
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return withHashSlot(() => bcrypt.compare(password, hash));
}
