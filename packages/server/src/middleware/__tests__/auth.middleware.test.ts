import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockVerify = vi.fn();
vi.mock('../../lib/jwt.js', () => ({
  verifyAccessToken: (token: string) => mockVerify(token),
}));

const mockEmit = vi.fn();
vi.mock('../../lib/event-emitter.js', () => ({ emitAuditEvent: (...args: unknown[]) => { mockEmit(...args); } }));

vi.mock('../../lib/logger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The resolver is the database boundary: the user as it would load them.
let userRow: import('../../../test/standing.js').StandingRow | undefined;
vi.mock('../../lib/principal.js', async () => {
  const { standingFor } = await import('../../../test/standing.js');
  return {
    loadUserStanding: vi.fn(() => Promise.resolve(userRow ? standingFor(userRow) : null)),
    roleLabel: (names: readonly string[]) => names.join(', '),
  };
});
// Session liveness has its own tests (session-live.test.ts, forged-token.routes.test.ts).
vi.mock('../../lib/session-live.js', () => ({ isSessionLive: vi.fn(() => Promise.resolve(true)) }));

// The key lookup is the database boundary for API keys (api-key.service.ts, api-keys.itest.ts).
const mockResolveKey = vi.fn();
const mockTouchKey = vi.fn((_id: string, _ip: string | null) => Promise.resolve());
vi.mock('../../services/api-key.service.js', () => ({
  ApiKeyService: { resolve: (token: string) => mockResolveKey(token), touch: (id: string, ip: string | null) => mockTouchKey(id, ip) },
}));

const { authenticate, keyInQuery } = await import('../auth.middleware.js');

function makeRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; }) as unknown as Response['status'];
  res.json = vi.fn((payload: unknown) => { res.body = payload; return res; }) as unknown as Response['json'];
  return res;
}

function makeReq(method: string, originalUrl: string): Request {
  return {
    method, originalUrl,
    headers: { authorization: 'Bearer tok' },
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockReturnValue({ userId: 'u1', sessionId: 's1', type: 'access' });
});

describe('authenticate — forced password change gate', () => {
  it('blocks a normal request with 403 PASSWORD_CHANGE_REQUIRED when mustChangePassword is set', async () => {
    userRow = { id: 'u1', username: 'admin', email: 'a@b.c', role: 'admin', enabled: true, mustChangePassword: true };
    const res = makeRes();
    const next = vi.fn();

    await authenticate(makeReq('GET', '/api/v1/channels'), res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'PASSWORD_CHANGE_REQUIRED', message: expect.any(String) },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows the self password-change endpoint while mustChangePassword is set', async () => {
    userRow = { id: 'u1', username: 'admin', email: 'a@b.c', role: 'admin', enabled: true, mustChangePassword: true };
    const res = makeRes();
    const next = vi.fn();

    await authenticate(makeReq('POST', '/api/v1/users/me/password'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('allows logout while mustChangePassword is set', async () => {
    userRow = { id: 'u1', username: 'admin', email: 'a@b.c', role: 'admin', enabled: true, mustChangePassword: true };
    const res = makeRes();
    const next = vi.fn();

    await authenticate(makeReq('POST', '/api/v1/auth/logout'), res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('passes a normal request through when mustChangePassword is false', async () => {
    userRow = { id: 'u1', username: 'admin', email: 'a@b.c', role: 'admin', enabled: true, mustChangePassword: false };
    const res = makeRes();
    const next = vi.fn();

    await authenticate(makeReq('GET', '/api/v1/channels'), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });
});

describe('authenticate — refusals are recorded through deny()', () => {
  const recorded = (): Record<string, unknown> => mockEmit.mock.calls.at(-1)?.[0] as Record<string, unknown>;

  it('records a refused password-change caller by user id', async () => {
    userRow = { id: 'u-pw', username: 'admin', email: 'a@b.c', role: 'admin', enabled: true, mustChangePassword: true };

    await authenticate(makeReq('GET', '/api/v1/channels'), makeRes(), vi.fn());

    expect(recorded()).toMatchObject({ action: 'ACCESS_DENIED', userId: 'u-pw', attributes: { reason: 'password_change_required', principal: 'user', route: null } });
  });

  it('records a disabled account by user id', async () => {
    userRow = { id: 'u-off', username: 'x', email: 'a@b.c', role: 'viewer', enabled: false, mustChangePassword: false };
    const res = makeRes();

    await authenticate(makeReq('GET', '/api/v1/channels'), res, vi.fn());

    expect(res.body).toEqual({ success: false, error: { code: 'ACCOUNT_DEACTIVATED', message: 'Account is deactivated' } });
    expect(recorded()).toMatchObject({ userId: 'u-off', attributes: { reason: 'account_disabled' } });
  });

  it('records a token that does not verify as an anonymous bad token', async () => {
    mockVerify.mockImplementation(() => { throw new Error('jwt malformed'); });
    const res = makeRes();

    await authenticate(makeReq('GET', '/api/v1/channels'), res, vi.fn());

    expect(res.statusCode).toBe(401);
    expect(recorded()).toMatchObject({ userId: null, attributes: { reason: 'bad_token', principal: 'anonymous' } });
  });
});

describe('authenticate: API keys (D-313)', () => {
  const KEY = 'gf_0f8fad5b-d9cb-469f-a165-70867728950e_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

  function keyReq(originalUrl = '/api/v1/channels', token = KEY): Request {
    return { method: 'GET', originalUrl, ip: '10.0.0.9', headers: { authorization: `Bearer ${token}` } } as unknown as Request;
  }

  it('signs in as the key\'s principal, without a session, and never tries the token as a JWT', async () => {
    const { standingFor } = await import('../../../test/standing.js');
    mockResolveKey.mockResolvedValue({ keyId: 'k1', standing: standingFor({ id: 'key-user', username: 'api-key:k1', role: 'viewer' }) });
    const req = keyReq();
    const next = vi.fn();
    await authenticate(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(mockVerify).not.toHaveBeenCalled();
    expect(req.apiKeyId).toBe('k1');
    expect(req.principal?.userId).toBe('key-user');
    expect(req.sessionId).toBeUndefined();
  });

  it('answers a key it cannot resolve with the same 401 as a bad token', async () => {
    mockResolveKey.mockResolvedValue(null);
    const keyRes = makeRes();
    await authenticate(keyReq(), keyRes, vi.fn());
    mockVerify.mockImplementation(() => { throw new Error('bad'); });
    const jwtRes = makeRes();
    await authenticate(makeReq('GET', '/api/v1/channels'), jwtRes, vi.fn());
    expect(keyRes.statusCode).toBe(401);
    expect(keyRes.body).toEqual(jwtRes.body);
  });

  it('refuses a key in the query string, encoded or not, before looking anything up', async () => {
    for (const url of [`/api/v1/channels?k=${KEY}`, `/api/v1/channels?k=${encodeURIComponent(KEY)}`, `/api/v1/channels?a=1&k=${KEY.toUpperCase()}`]) {
      const res = makeRes();
      const next = vi.fn();
      await authenticate(keyReq(url), res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    }
    expect(mockResolveKey).not.toHaveBeenCalled();
  });

  it('writes a key\'s last use at most once a minute', async () => {
    const { standingFor } = await import('../../../test/standing.js');
    mockResolveKey.mockResolvedValue({ keyId: 'k-throttle', standing: standingFor({ id: 'key-user', role: 'viewer' }) });
    vi.useFakeTimers({ now: new Date('2026-11-17T10:00:00Z') });
    try {
      await authenticate(keyReq(), makeRes(), vi.fn());
      await authenticate(keyReq(), makeRes(), vi.fn());
      expect(mockTouchKey).toHaveBeenCalledTimes(1);
      expect(mockTouchKey).toHaveBeenCalledWith('k-throttle', '10.0.0.9');
      vi.setSystemTime(new Date('2026-11-17T10:01:01Z'));
      await authenticate(keyReq(), makeRes(), vi.fn());
      expect(mockTouchKey).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('authenticate: a failure to read is not a refusal (#473)', () => {
  const KEY = 'gf_0f8fad5b-d9cb-469f-a165-70867728950e_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
  const outage = (): Error => new Error('Connection terminated due to connection timeout');

  async function answerTo(req: Request): Promise<{ res: ReturnType<typeof makeRes>; next: ReturnType<typeof vi.fn> }> {
    const res = makeRes();
    const next = vi.fn();
    await authenticate(req, res, next);
    return { res, next };
  }

  async function expectUnavailable(req: Request): Promise<void> {
    const logger = (await import('../../lib/logger.js')).default;
    const { res, next } = await answerTo(req);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ success: false, error: { code: 'UNAVAILABLE', message: expect.any(String) } });
    expect(mockEmit).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ errMsg: 'Connection terminated due to connection timeout' }),
      expect.any(String),
    );
  }

  it('answers 503 and records no refusal when the user cannot be read', async () => {
    const { loadUserStanding } = await import('../../lib/principal.js');
    vi.mocked(loadUserStanding).mockRejectedValueOnce(outage());
    await expectUnavailable(makeReq('GET', '/api/v1/channels'));
  });

  it('answers 503 when the session cannot be read', async () => {
    userRow = { id: 'u1', username: 'admin', email: 'a@b.c', role: 'admin', enabled: true, mustChangePassword: false };
    const { isSessionLive } = await import('../../lib/session-live.js');
    vi.mocked(isSessionLive).mockRejectedValueOnce(outage());
    await expectUnavailable(makeReq('GET', '/api/v1/channels'));
  });

  it('answers 503 when an API key cannot be read', async () => {
    mockResolveKey.mockRejectedValueOnce(outage());
    await expectUnavailable({ method: 'GET', originalUrl: '/api/v1/channels', headers: { authorization: `Bearer ${KEY}` } } as unknown as Request);
  });

  it('still answers 401 for a token that does not verify, without reading anything', async () => {
    const { loadUserStanding } = await import('../../lib/principal.js');
    mockVerify.mockImplementation(() => { throw new Error('invalid signature'); });
    const { res, next } = await answerTo(makeReq('GET', '/api/v1/channels'));
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(loadUserStanding).not.toHaveBeenCalled();
  });

  it('still answers a revoked session 401 once the reads succeed', async () => {
    userRow = { id: 'u1', username: 'admin', email: 'a@b.c', role: 'admin', enabled: true, mustChangePassword: false };
    const { isSessionLive } = await import('../../lib/session-live.js');
    vi.mocked(isSessionLive).mockResolvedValueOnce(false);
    const { res, next } = await answerTo(makeReq('GET', '/api/v1/channels'));
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ACCESS_DENIED', userId: 'u1', attributes: expect.objectContaining({ reason: 'session_revoked' }) }));
  });
});

describe('keyInQuery', () => {
  it('looks only at the query string', () => {
    expect(keyInQuery('/api/v1/channels/gf_0f8fad5b-d9cb-469f')).toBe(false);
    expect(keyInQuery('/api/v1/channels')).toBe(false);
    expect(keyInQuery('/api/v1/messages?q=gf_0f8fad5b-d9cb-469f-a165')).toBe(true);
    expect(keyInQuery('/api/v1/messages?q=%gf')).toBe(false);
  });
});
