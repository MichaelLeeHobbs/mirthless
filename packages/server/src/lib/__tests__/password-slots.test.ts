// The hash limit: a burst of logins must not take every thread-pool thread (D-324).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { pending } = vi.hoisted(() => ({
  pending: [] as Array<{ settle: (ok: boolean) => void }>,
}));

vi.mock('bcrypt', () => {
  const hold = <T>(value: T): Promise<T> => new Promise<T>((resolve, reject) => {
    pending.push({ settle: (ok) => { if (ok) resolve(value); else reject(new Error('bcrypt failed')); } });
  });
  return { default: { compare: vi.fn(() => hold(true)), hash: vi.fn(() => hold('$2b$12$hash')) } };
});

const { verifyPassword, hashPassword, MAX_CONCURRENT_HASHES } = await import('../password.js');

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('password hash limit', () => {
  beforeEach(() => { pending.length = 0; });

  it(`runs at most ${String(MAX_CONCURRENT_HASHES)} at once and the rest in turn`, async () => {
    const calls = [
      verifyPassword('a', 'h'), hashPassword('b'), verifyPassword('c', 'h'), verifyPassword('d', 'h'), hashPassword('e'),
    ];
    await flush();
    expect(pending).toHaveLength(MAX_CONCURRENT_HASHES);

    for (let started = MAX_CONCURRENT_HASHES; started < calls.length; started++) {
      pending.shift()?.settle(true);
      await flush();
      expect(pending).toHaveLength(MAX_CONCURRENT_HASHES);
    }
    while (pending.length > 0) { pending.shift()?.settle(true); await flush(); }

    expect(await Promise.all(calls)).toEqual([true, '$2b$12$hash', true, true, '$2b$12$hash']);
  });

  it('frees the slot of a call that fails, so the next one still runs', async () => {
    const calls = Array.from({ length: MAX_CONCURRENT_HASHES + 1 }, () => verifyPassword('a', 'h'));
    const failed = expect(calls[0]).rejects.toThrow('bcrypt failed');
    await flush();
    pending.shift()?.settle(false);
    await failed;
    await flush();
    expect(pending).toHaveLength(MAX_CONCURRENT_HASHES);
    while (pending.length > 0) { pending.shift()?.settle(true); await flush(); }
    expect(await Promise.all(calls.slice(1))).toEqual(Array.from({ length: MAX_CONCURRENT_HASHES }, () => true));
  });
});
