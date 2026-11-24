// What a key issue does with real grants is covered against Postgres (api-keys.itest.ts).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_CHANNELS, type FoldedGrants } from '@galvanigraph/core-models';

const readStanding = vi.fn<(userId: string, at: Date) => Promise<unknown>>();

vi.mock('../../lib/principal.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/principal.js')>()),
  queryUserStanding: (_reader: unknown, userId: string, at: Date) => readStanding(userId, at),
}));

vi.mock('../../lib/db.js', () => {
  const row = [{ id: 'admin-role' }];
  const where = (): unknown => Object.assign(Promise.resolve(row), { for: () => Promise.resolve(row) });
  const tx = { select: () => ({ from: () => ({ where }) }), selectDistinct: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) };
  const db = { transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
  return { db, default: db };
});

const { ApiKeyService } = await import('../api-key.service.js');

const DAY_MS = 86_400_000;

function issue(): Promise<unknown> {
  return ApiKeyService.issue({
    name: 'feed', description: '', reason: '', permissions: ['channels:read'], groupIds: null,
    expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
  }, { userId: 'issuer' });
}

function standing(grants: FoldedGrants): unknown {
  return { enabled: true, grants, permissions: [...grants.keys()] };
}

beforeEach(() => { readStanding.mockReset(); });

describe('issuing a key the issuer covers now', () => {
  const now = standing(new Map([['channels:read', ALL_CHANNELS], ['api_keys:manage', ALL_CHANNELS]]));
  const atEnd = (at: Date): boolean => at.getTime() > Date.now() + DAY_MS / 2;

  it('reports a failed read of the issuer\'s access at the key\'s end as that failure, not as access that ends too soon', async () => {
    readStanding.mockImplementation(async (_id, at) => {
      if (atEnd(at)) throw new Error('connection refused');
      return now;
    });

    await expect(issue()).rejects.toThrow('connection refused');
  });

  it('refuses a key that would outlast the issuer\'s access', async () => {
    readStanding.mockImplementation(async (_id, at) => (atEnd(at) ? standing(new Map()) : now));

    await expect(issue()).rejects.toMatchObject({ code: 'FORBIDDEN', message: expect.stringContaining('cannot outlast your own access') as string });
  });
});
