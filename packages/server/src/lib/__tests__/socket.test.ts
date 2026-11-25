import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';

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

// The resolver (lib/principal.ts) is the database boundary here.
let userRow: import('../../../test/standing.js').StandingRow | undefined = { id: 'user-1', enabled: true, role: 'viewer' };
vi.mock('../principal.js', async () => {
  const { standingFor } = await import('../../../test/standing.js');
  return { loadUserStanding: vi.fn(() => Promise.resolve(userRow ? standingFor(userRow) : null)) };
});

const channelGroups = vi.hoisted(() => new Map<string, string[]>());
vi.mock('../channel-scope.js', async () => {
  const { ALL_CHANNELS, can } = await import('@galvanigraph/core-models');
  const groupsOf = vi.fn((id: string) => Promise.resolve(channelGroups.get(id) ?? []));
  return {
    channelGroupIds: groupsOf,
    holdsOnChannel: async (grants: Map<string, unknown>, permission: string, channelId: string): Promise<boolean> => {
      const scope = grants.get(permission);
      if (scope === undefined) return false;
      if (scope === ALL_CHANNELS) return true;
      return can(grants as never, permission as never, { groupIds: (await groupsOf(channelId)) as never });
    },
  };
});

const session = vi.hoisted(() => ({ live: true }));
const { mockIsSessionLive } = vi.hoisted(() => ({ mockIsSessionLive: vi.fn() }));
vi.mock('../session-live.js', () => ({ isSessionLive: mockIsSessionLive }));

import {
  authMiddleware, initializeSocketIO, revalidateSocket, emitToRoom, emitToRoomCoalesced, emitToChannelAudience, shutdownSocketIO,
  LIVE_EVENT_COALESCE_MS, _resetIO, audienceRooms, ALL_CHANNELS_ROOM,
} from '../socket.js';
import { builtInRolePermissions } from '../../db/seeds/roles.js';
import type { Server as SocketIOServer } from 'socket.io';

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

describe('Socket.IO Auth & Room Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetIO(null);
    userRow = { id: 'user-1', enabled: true };
    session.live = true;
    mockIsSessionLive.mockImplementation(async () => session.live);
  });

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
      const token = createValidToken({ userId: 'user-1', sessionId: 's1', type: 'access' });
      const socket = createMockSocket(token);
      const next = vi.fn();

      await authMiddleware(socket, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    it('rejects an access token with no session id (GHSA-r434-hwqg-cvcw)', async () => {
      userRow = { id: 'user-1', enabled: true, role: 'admin' };
      const socket = createMockSocket(createValidToken({ userId: 'user-1', type: 'access' }));
      const next = vi.fn();

      await authMiddleware(socket, next);

      const err = next.mock.calls[0]![0] as Error;
      expect(err.message).toBe('Authentication required');
      expect(socket.data['user']).toBeUndefined();
    });

    it('rejects connection when the user is disabled', async () => {
      userRow = { id: 'user-1', enabled: false };
      const token = createValidToken({ userId: 'user-1', sessionId: 's1', type: 'access' });
      const socket = createMockSocket(token);
      const next = vi.fn();

      await authMiddleware(socket, next);

      const err = next.mock.calls[0]![0] as Error;
      expect(err.message).toBe('Authentication required');
    });

    it('stores user data and permissions resolved live from the role after successful auth', async () => {
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
      expect(userData.permissions).toEqual([...builtInRolePermissions('viewer')].sort());
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
      leave: Mock<(room: string) => unknown>; join: Mock<(room: string) => unknown>; disconnect: Mock<(close?: boolean) => unknown>;
    } {
      return {
        id: 'sock-1',
        data: { user: { userId: 'user-1', sessionId: 's1', type: 'access', permissions: builtInRolePermissions('admin') } },
        rooms: new Set(['sock-1', ...rooms]),
        leave: vi.fn<(room: string) => unknown>(),
        join: vi.fn<(room: string) => unknown>(),
        disconnect: vi.fn<(close?: boolean) => unknown>(),
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

    it('moves a socket whose access narrowed to groups: out of the all-channel room and a channel outside them', async () => {
      const LAB = '3f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0c';
      const RAD = '4f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0d';
      channelGroups.set(LAB, ['g-lab']).set(RAD, ['g-rad']);
      userRow = { id: 'user-1', enabled: true, role: 'viewer', groups: ['g-lab'] };
      const socket = connectedSocket([ALL_CHANNELS_ROOM, `channel:${LAB}`, `channel:${RAD}`]);

      expect(await revalidateSocket(socket)).toBe(true);

      expect(socket.leave).toHaveBeenCalledWith(ALL_CHANNELS_ROOM);
      expect(socket.join).toHaveBeenCalledWith('group:g-lab');
      expect(socket.leave).toHaveBeenCalledWith(`channel:${RAD}`);
      expect(socket.leave).not.toHaveBeenCalledWith(`channel:${LAB}`);
    });

    it('leaves rooms the user lost permission for after a role change', async () => {
      userRow = { id: 'user-1', enabled: true, role: 'viewer' };
      const socket = connectedSocket(['logs', 'dashboard', 'channel:abc']);

      expect(await revalidateSocket(socket)).toBe(true);

      expect(socket.leave).toHaveBeenCalledWith('logs');
      expect(socket.leave).not.toHaveBeenCalledWith('dashboard');
      expect(socket.leave).not.toHaveBeenCalledWith('channel:abc');
      expect(socket.leave).not.toHaveBeenCalledWith('sock-1');
      expect((socket.data['user'] as { permissions: string[] }).permissions).toEqual([...builtInRolePermissions('viewer')].sort());
    });
  });

  describe('a token that is not text', () => {
    it('is refused', () => {
      const socket = createMockSocket();
      const next = vi.fn();

      socket.handshake.auth['token'] = 12345;
      authMiddleware(socket, next);

      const err = next.mock.calls[0]![0] as Error;
      expect(err.message).toBe('Authentication required');
    });
  });

  describe('joining a channel', () => {
    const CHANNEL = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const CAPS = CHANNEL.toUpperCase();

    afterEach(async () => { await shutdownSocketIO(); });

    function connect(): { readonly send: (event: string, arg: unknown) => void; readonly join: Mock; readonly leave: Mock; readonly emit: Mock } {
      const handlers = new EventEmitter();
      const join = vi.fn();
      const leave = vi.fn();
      const emit = vi.fn();
      const socket = {
        id: 'sock-1', rooms: new Set(['sock-1']), join, leave, emit, disconnect: vi.fn(),
        data: { user: { userId: 'user-1', sessionId: 'sess-1', type: 'access', permissions: [], grants: new Map() } },
        on: (event: string, handler: (arg: unknown) => void) => handlers.on(event, handler),
      };
      const [connection] = initializeSocketIO(createServer()).of('/').listeners('connection');
      (connection as (s: unknown) => void)(socket);
      return { send: (event, arg) => { handlers.emit(event, arg); }, join, leave, emit };
    }

    it.each([CHANNEL, CAPS])('joins and leaves the room the channel\'s events go to, for id %s', async (id) => {
      userRow = { id: 'user-1', enabled: true, role: 'viewer' };
      const client = connect();

      client.send('join:channel', id);
      await vi.waitFor(() => { expect(client.join).toHaveBeenCalledWith(`channel:${CHANNEL}`); });
      client.send('leave:channel', id);

      expect(client.leave).toHaveBeenCalledWith(`channel:${CHANNEL}`);
      expect(client.join).not.toHaveBeenCalledWith(`channel:${CAPS}`);
    });

    it.each([7, '', 'abc', undefined])('ignores %s, which is not a channel id', async (id) => {
      const client = connect();
      client.join.mockClear();

      client.send('join:channel', id);
      client.send('leave:channel', id);
      await new Promise((resolve) => { setImmediate(resolve); });

      expect(mockIsSessionLive).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
      expect(client.leave).not.toHaveBeenCalled();
    });
  });

  describe('emitToRoom', () => {
    it('no-ops when io is null', () => {
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

  // #231, D-306.

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

  describe('emitToChannelAudience', () => {
    it('sends a channel\'s event to the all-channel room and the rooms of its groups only', async () => {
      const CHANNEL = '5f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0e';
      channelGroups.set(CHANNEL, ['g-lab', 'g-icu']);
      const emit = vi.fn();
      const to = vi.fn(() => ({ emit }));
      _resetIO({ to } as unknown as SocketIOServer);

      emitToChannelAudience(CHANNEL, 'channel:state', { channelId: CHANNEL, state: 'STARTED' });
      await vi.waitFor(() => { expect(emit).toHaveBeenCalled(); });

      expect(to).toHaveBeenCalledWith(['scope:all', 'group:g-lab', 'group:g-icu']);
      expect(emit).toHaveBeenCalledWith('channel:state', { channelId: CHANNEL, state: 'STARTED' });
    });

    it('keeps a channel\'s events in order however its lookups finish', async () => {
      const CHANNEL = '6f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0f';
      const seen: string[] = [];
      _resetIO({ to: () => ({ emit: (_e: string, d: { state: string }) => { seen.push(d.state); } }) } as unknown as SocketIOServer);

      emitToChannelAudience(CHANNEL, 'channel:state', { state: 'STARTED' });
      emitToChannelAudience(CHANNEL, 'channel:state', { state: 'PAUSED' });
      await vi.waitFor(() => { expect(seen).toHaveLength(2); });

      expect(seen).toEqual(['STARTED', 'PAUSED']);
    });

    it('sends nothing when the channel\'s groups cannot be read', async () => {
      const { channelGroupIds } = await import('../channel-scope.js');
      vi.mocked(channelGroupIds).mockRejectedValueOnce(new Error('connection lost'));
      const to = vi.fn();
      _resetIO({ to } as unknown as SocketIOServer);

      emitToChannelAudience('7f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b00', 'channel:state', {});
      await new Promise((r) => { setTimeout(r, 0); });

      expect(to).not.toHaveBeenCalled();
    });
  });

  afterEach(() => {
    _resetIO(null);
  });

  describe('audienceRooms', () => {
    it('puts an all-channel reader in the all-channel room, a scoped one in its groups, and others nowhere', async () => {
      const { standingFor } = await import('../../../test/standing.js');
      expect(audienceRooms(standingFor({ id: 'u', role: 'viewer' }).grants)).toEqual([ALL_CHANNELS_ROOM]);
      expect(audienceRooms(standingFor({ id: 'u', role: 'viewer', groups: ['g1', 'g2'] }).grants)).toEqual(['group:g1', 'group:g2']);
      expect(audienceRooms(standingFor({ id: 'u' }).grants)).toEqual([]);
    });
  });
});
