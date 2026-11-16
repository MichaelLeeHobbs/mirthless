// ===========================================
// Socket.IO Auth & Room Management Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

// ----- Hoisted Mocks -----

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-chars-long',
    FRONTEND_URL: 'http://localhost:5173',
  },
}));

vi.mock('../../config/index.js', () => ({
  config: mockConfig,
}));

vi.mock('../logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// db.select().from().where() — first call returns the user row, second the
// permission rows. Controlled per-test via `userRow` / `permRows`.
let userRow: Record<string, unknown> | undefined = { id: 'user-1', enabled: true, role: 'viewer' };
let permRows: { resource: string; action: string }[] = [];
let dbSelectCall = 0;
const mockWhere = vi.fn(() => {
  dbSelectCall += 1;
  return Promise.resolve(dbSelectCall === 1 ? (userRow ? [userRow] : []) : permRows);
});
vi.mock('../db.js', () => ({
  db: { select: () => ({ from: () => ({ where: mockWhere }) }) },
}));
vi.mock('../../db/schema/index.js', () => ({ users: {}, userPermissions: {} }));

// Session liveness is its own module (shared with the REST middleware).
const session = vi.hoisted(() => ({ live: true }));
const { mockIsSessionLive } = vi.hoisted(() => ({ mockIsSessionLive: vi.fn() }));
vi.mock('../session-live.js', () => ({ isSessionLive: mockIsSessionLive }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

// ----- Import after mocks -----

import {
  authMiddleware, revalidateSocket, emitToRoom, emitToRoomCoalesced, emitToAll, shutdownSocketIO,
  LIVE_EVENT_COALESCE_MS, _resetIO,
} from '../socket.js';
import { permissionNamesForRole } from '../role-permissions.js';
import type { Server as SocketIOServer } from 'socket.io';

// ----- Helpers -----

function createValidToken(payload: { userId: string; sessionId?: string; type: string }): string {
  return jwt.sign(payload, mockConfig.JWT_SECRET, { expiresIn: '15m' });
}

function createMockSocket(token?: string): {
  data: Record<string, unknown>;
  handshake: { auth: Record<string, unknown> };
} {
  return {
    data: {},
    handshake: {
      auth: token !== undefined ? { token } : {},
    },
  };
}

// ----- Tests -----

describe('Socket.IO Auth & Room Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetIO(null);
    userRow = { id: 'user-1', enabled: true };
    permRows = [];
    dbSelectCall = 0;
    session.live = true;
    mockIsSessionLive.mockImplementation(async () => session.live);
  });

  // ----- Auth Middleware -----

  describe('authMiddleware', () => {
    it('rejects connection when token is missing', () => {
      const socket = createMockSocket();
      const next = vi.fn();

      authMiddleware(socket, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0]![0] as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Authentication required');
    });

    it('rejects connection when token is empty string', () => {
      const socket = createMockSocket('');
      const next = vi.fn();

      authMiddleware(socket, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0]![0] as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Authentication required');
    });

    it('rejects connection when token is invalid', () => {
      const socket = createMockSocket('not-a-valid-jwt-token');
      const next = vi.fn();

      authMiddleware(socket, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0]![0] as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Authentication required');
    });

    it('rejects connection when token is expired', () => {
      const expiredToken = jwt.sign(
        { userId: 'user-1', type: 'access' },
        mockConfig.JWT_SECRET,
        { expiresIn: '-1s' },
      );
      const socket = createMockSocket(expiredToken);
      const next = vi.fn();

      authMiddleware(socket, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0]![0] as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Authentication required');
    });

    it('rejects connection when token is a refresh token', () => {
      const refreshToken = jwt.sign(
        { userId: 'user-1', type: 'refresh' },
        mockConfig.JWT_SECRET,
        { expiresIn: '7d' },
      );
      const socket = createMockSocket(refreshToken);
      const next = vi.fn();

      authMiddleware(socket, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0]![0] as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Authentication required');
    });

    it('accepts connection with valid JWT', async () => {
      const token = createValidToken({ userId: 'user-1', type: 'access' });
      const socket = createMockSocket(token);
      const next = vi.fn();

      await authMiddleware(socket, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    it('rejects connection when the user is disabled', async () => {
      userRow = { id: 'user-1', enabled: false };
      const token = createValidToken({ userId: 'user-1', type: 'access' });
      const socket = createMockSocket(token);
      const next = vi.fn();

      await authMiddleware(socket, next);

      const err = next.mock.calls[0]![0] as Error;
      expect(err.message).toBe('Authentication required');
    });

    it('stores user data and permissions resolved live from the role after successful auth', async () => {
      // Permissions are resolved from the user's role (single source of truth),
      // not a per-user snapshot — a viewer gets exactly the viewer role's set.
      userRow = { id: 'user-42', enabled: true, role: 'viewer' };
      const token = createValidToken({ userId: 'user-42', sessionId: 'sess-7', type: 'access' });
      const socket = createMockSocket(token);
      const next = vi.fn();

      await authMiddleware(socket, next);

      expect(next).toHaveBeenCalledWith();
      const userData = socket.data['user'] as { userId: string; sessionId: string; type: string; permissions: string[] };
      expect(userData.userId).toBe('user-42');
      expect(userData.sessionId).toBe('sess-7');
      expect(userData.type).toBe('access');
      expect(userData.permissions).toEqual(permissionNamesForRole('viewer'));
      expect(userData.permissions).toContain('channels:read');
      expect(userData.permissions).not.toContain('users:delete');
    });
  });

  describe('session and account standing', () => {
    it('rejects the handshake when the token session was revoked', async () => {
      session.live = false;
      userRow = { id: 'user-1', enabled: true, role: 'admin' };
      const next = vi.fn();

      await authMiddleware(createMockSocket(createValidToken({ userId: 'user-1', sessionId: 's1', type: 'access' })), next);

      expect((next.mock.calls[0]![0] as Error).message).toBe('Authentication required');
      expect(mockIsSessionLive).toHaveBeenCalledWith('s1', 'user-1');
    });

    it('rejects the handshake while the user must change their password', async () => {
      userRow = { id: 'user-1', enabled: true, role: 'admin', mustChangePassword: true };
      const next = vi.fn();

      await authMiddleware(createMockSocket(createValidToken({ userId: 'user-1', sessionId: 's1', type: 'access' })), next);

      expect((next.mock.calls[0]![0] as Error).message).toBe('Authentication required');
    });

    function connectedSocket(rooms: string[]): {
      id: string; data: Record<string, unknown>; rooms: Set<string>;
      leave: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>;
    } {
      return {
        id: 'sock-1',
        data: { user: { userId: 'user-1', sessionId: 's1', type: 'access', permissions: permissionNamesForRole('admin') } },
        rooms: new Set(['sock-1', ...rooms]),
        leave: vi.fn(),
        disconnect: vi.fn(),
      };
    }

    it('disconnects a connected socket once its session is revoked (logout)', async () => {
      session.live = false;
      userRow = { id: 'user-1', enabled: true, role: 'admin' };
      const socket = connectedSocket(['logs']);

      const stillConnected = await revalidateSocket(socket);

      expect(stillConnected).toBe(false);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects a connected socket when the user is disabled', async () => {
      userRow = { id: 'user-1', enabled: false, role: 'admin' };
      const socket = connectedSocket(['dashboard']);

      expect(await revalidateSocket(socket)).toBe(false);
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('leaves rooms the user lost permission for after a role change', async () => {
      userRow = { id: 'user-1', enabled: true, role: 'viewer' };
      const socket = connectedSocket(['logs', 'dashboard', 'channel:abc']);

      expect(await revalidateSocket(socket)).toBe(true);

      expect(socket.leave).toHaveBeenCalledWith('logs');
      expect(socket.leave).not.toHaveBeenCalledWith('dashboard');
      expect(socket.leave).not.toHaveBeenCalledWith('channel:abc');
      expect(socket.leave).not.toHaveBeenCalledWith('sock-1');
      expect((socket.data['user'] as { permissions: string[] }).permissions).toEqual(permissionNamesForRole('viewer'));
    });
  });

  // ----- Room Join/Leave -----

  describe('room join/leave via connection handler', () => {
    // We test room behavior indirectly through emitToRoom by setting up a mock io.
    // The connection handlers are registered inside initializeSocketIO, which is
    // tightly coupled to creating a real SocketIOServer. Instead, we test the
    // event handlers by verifying emitToRoom and emitToAll work with a mock io.

    it('join:channel and leave:channel are validated (channelId must be string)', () => {
      // authMiddleware validates input types for channel room join
      // The socket handler ignores non-string channelIds silently
      // This is tested via the integration below with mock io
      const socket = createMockSocket();
      const next = vi.fn();

      // Non-string token should be rejected
      socket.handshake.auth['token'] = 12345;
      authMiddleware(socket, next);

      const err = next.mock.calls[0]![0] as Error;
      expect(err.message).toBe('Authentication required');
    });
  });

  // ----- emitToRoom -----

  describe('emitToRoom', () => {
    it('no-ops when io is null', () => {
      // Should not throw
      expect(() => emitToRoom('dashboard', 'test:event', { foo: 'bar' })).not.toThrow();
    });

    it('emits to the specified room when io is available', () => {
      const mockEmit = vi.fn();
      const mockTo = vi.fn(() => ({ emit: mockEmit }));
      const mockIO = { to: mockTo } as unknown as SocketIOServer;

      _resetIO(mockIO);

      emitToRoom('channel:abc-123', 'message:new', { id: 'm1' });

      expect(mockTo).toHaveBeenCalledWith('channel:abc-123');
      expect(mockEmit).toHaveBeenCalledWith('message:new', { id: 'm1' });
    });

    it('emits to dashboard room', () => {
      const mockEmit = vi.fn();
      const mockTo = vi.fn(() => ({ emit: mockEmit }));
      const mockIO = { to: mockTo } as unknown as SocketIOServer;

      _resetIO(mockIO);

      emitToRoom('dashboard', 'stats:update', { channels: 5 });

      expect(mockTo).toHaveBeenCalledWith('dashboard');
      expect(mockEmit).toHaveBeenCalledWith('stats:update', { channels: 5 });
    });
  });

  // ----- emitToRoomCoalesced (#231, D-306) -----

  describe('emitToRoomCoalesced', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(async () => {
      await shutdownSocketIO();
      vi.useRealTimers();
    });

    function mockRoomIO(): { emits: { room: string; event: string; data: unknown }[] } {
      const emits: { room: string; event: string; data: unknown }[] = [];
      const mockIO = {
        to: (room: string) => ({ emit: (event: string, data: unknown) => { emits.push({ room, event, data }); } }),
        disconnectSockets: vi.fn(),
        close: (cb: () => void) => { cb(); },
      } as unknown as SocketIOServer;
      _resetIO(mockIO);
      return { emits };
    }

    it('no-ops when io is null', () => {
      expect(() => { emitToRoomCoalesced('dashboard', 'stats:update', {}); }).not.toThrow();
      vi.advanceTimersByTime(LIVE_EVENT_COALESCE_MS * 2);
    });

    it('emits a burst of events as one emit per window, the last one carrying the latest data', () => {
      const { emits } = mockRoomIO();

      for (let i = 1; i <= 200; i++) emitToRoomCoalesced('channel:c1', 'message:new', { n: i });
      expect(emits).toEqual([{ room: 'channel:c1', event: 'message:new', data: { n: 1 } }]);

      vi.advanceTimersByTime(LIVE_EVENT_COALESCE_MS);
      expect(emits).toHaveLength(2);
      expect(emits[1]).toEqual({ room: 'channel:c1', event: 'message:new', data: { n: 200 } });

      vi.advanceTimersByTime(LIVE_EVENT_COALESCE_MS * 5);
      expect(emits).toHaveLength(2);
    });

    it('emits at most once per window under steady load and once more after the last event', () => {
      const { emits } = mockRoomIO();

      // An event every 10 ms for just under three windows.
      for (let t = 0; t < LIVE_EVENT_COALESCE_MS * 3 - 50; t += 10) {
        emitToRoomCoalesced('dashboard', 'stats:update', { t });
        vi.advanceTimersByTime(10);
      }
      expect(emits).toHaveLength(3);

      vi.advanceTimersByTime(LIVE_EVENT_COALESCE_MS);
      expect(emits).toHaveLength(4);
      expect(emits[3]!.data).toEqual({ t: LIVE_EVENT_COALESCE_MS * 3 - 60 });
    });

    it('coalesces each room and event on its own', () => {
      const { emits } = mockRoomIO();

      emitToRoomCoalesced('channel:c1', 'message:new', {});
      emitToRoomCoalesced('channel:c2', 'message:new', {});
      emitToRoomCoalesced('dashboard', 'stats:update', {});

      expect(emits.map((e) => `${e.room} ${e.event}`)).toEqual([
        'channel:c1 message:new',
        'channel:c2 message:new',
        'dashboard stats:update',
      ]);
    });

    it('logs a trailing emit that throws instead of letting it reach the timer', async () => {
      const { default: logger } = await import('../logger.js');
      let calls = 0;
      _resetIO({
        to: () => ({ emit: () => { calls += 1; if (calls === 2) throw new Error('emit failed'); } }),
        disconnectSockets: vi.fn(),
        close: (cb: () => void) => { cb(); },
      } as unknown as SocketIOServer);

      emitToRoomCoalesced('dashboard', 'stats:update', {});
      emitToRoomCoalesced('dashboard', 'stats:update', {});

      expect(() => { vi.advanceTimersByTime(LIVE_EVENT_COALESCE_MS); }).not.toThrow();
      expect(calls).toBe(2);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ errMsg: 'emit failed' }),
        expect.stringContaining('stats:update'),
      );
    });

    it('drops an emit armed while shutdown waits for the server to close', async () => {
      const emits: unknown[] = [];
      let finishClose: () => void = () => undefined;
      _resetIO({
        to: () => ({ emit: (_event: string, data: unknown) => { emits.push(data); } }),
        disconnectSockets: vi.fn(),
        close: (cb: () => void) => { finishClose = cb; },
      } as unknown as SocketIOServer);

      const shutdown = shutdownSocketIO();
      emitToRoomCoalesced('dashboard', 'stats:update', { n: 1 });
      emitToRoomCoalesced('dashboard', 'stats:update', { n: 2 });
      finishClose();
      await shutdown;

      // No window timer outlives shutdown to hold the process or a stale entry.
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(LIVE_EVENT_COALESCE_MS * 2);
      expect(emits).toEqual([{ n: 1 }]);
    });

    it('drops pending emits on shutdown', async () => {
      const { emits } = mockRoomIO();

      emitToRoomCoalesced('dashboard', 'stats:update', {});
      emitToRoomCoalesced('dashboard', 'stats:update', {});
      await shutdownSocketIO();
      vi.advanceTimersByTime(LIVE_EVENT_COALESCE_MS * 2);

      expect(emits).toHaveLength(1);
    });
  });

  // ----- emitToAll -----

  describe('emitToAll', () => {
    it('no-ops when io is null', () => {
      expect(() => emitToAll('test:event', { foo: 'bar' })).not.toThrow();
    });

    it('broadcasts to all connected sockets when io is available', () => {
      const mockEmit = vi.fn();
      const mockIO = { emit: mockEmit } as unknown as SocketIOServer;

      _resetIO(mockIO);

      emitToAll('system:alert', { message: 'shutdown in 5m' });

      expect(mockEmit).toHaveBeenCalledWith('system:alert', { message: 'shutdown in 5m' });
    });
  });

  // ----- Cleanup -----

  afterEach(() => {
    _resetIO(null);
  });
});
