// GHSA-r434-hwqg-cvcw: the server never issues an access token without a session
// id, so one without must not count as live.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionRows = vi.hoisted(() => ({ rows: [] as unknown[] }));
const mockWhere = vi.fn(() => Promise.resolve(sessionRows.rows));
vi.mock('../db.js', () => ({
  db: { select: () => ({ from: () => ({ where: mockWhere }) }) },
}));

const { isSessionLive } = await import('../session-live.js');

beforeEach(() => {
  mockWhere.mockClear();
  sessionRows.rows = [{ id: 's1' }];
});

describe('isSessionLive', () => {
  it('refuses a token with no session id without asking the database', async () => {
    expect(await isSessionLive(undefined, 'u1')).toBe(false);
    expect(mockWhere).not.toHaveBeenCalled();
  });

  it('refuses an empty session id', async () => {
    expect(await isSessionLive('', 'u1')).toBe(false);
    expect(mockWhere).not.toHaveBeenCalled();
  });

  it('accepts a session id whose session row exists and has not expired', async () => {
    expect(await isSessionLive('s1', 'u1')).toBe(true);
  });

  it('refuses a session id with no live session row', async () => {
    sessionRows.rows = [];
    expect(await isSessionLive('s1', 'u1')).toBe(false);
  });
});
