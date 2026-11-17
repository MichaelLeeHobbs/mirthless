// ===========================================
// Socket.IO Server
// ===========================================
// Singleton Socket.IO server instance with JWT auth
// and channel-based room management.

import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { ALL_CHANNELS, PERMISSIONS, holdsPermission, type FoldedGrants, type Permission } from '@galvanigraph/core-models';
import { createThrottle, errorInfo, type Throttle } from '@galvanigraph/core-util';
import { config } from '../config/index.js';
import { loadUserStanding } from './principal.js';
import logger from './logger.js';
import { verifyAccessToken } from './jwt.js';
import { isSessionLive } from './session-live.js';
import { channelGroupIds, holdsOnChannel } from './channel-scope.js';

/** User data stored on authenticated sockets. */
export interface SocketUserData {
  readonly userId: string;
  readonly sessionId?: string | undefined;
  readonly type: string;
  readonly permissions: readonly string[];
  /** What the user holds on which channels (D-310): decides the channel rooms and audience rooms. */
  readonly grants: FoldedGrants;
}

/** The room every socket that reads all channels is in. */
export const ALL_CHANNELS_ROOM = 'scope:all';

/** The room of the sockets that read the channels of one group. */
export function groupRoom(groupId: string): string {
  return `group:${groupId}`;
}

/**
 * The audience rooms a socket belongs in: where a channel's state changes go
 * (D-310, plan section 4). Every channel for an all-channel reader; one room
 * per group for a scoped one; none without channels:read.
 */
export function audienceRooms(grants: FoldedGrants): readonly string[] {
  const scope = grants.get(PERMISSIONS.CHANNELS_READ);
  if (scope === undefined) return [];
  if (scope === ALL_CHANNELS) return [ALL_CHANNELS_ROOM];
  return [...scope].map(groupRoom);
}

function isAudienceRoom(room: string): boolean {
  return room === ALL_CHANNELS_ROOM || room.startsWith('group:');
}



/** Permission required to join each server-pushed room. */
const ROOM_PERMISSIONS: Readonly<Record<'channel' | 'dashboard' | 'logs', Permission>> = {
  channel: PERMISSIONS.CHANNELS_READ,
  dashboard: PERMISSIONS.CHANNELS_READ,
  logs: PERMISSIONS.SYSTEM_INFO,
};

/** How often connected sockets are re-validated against the database. */
const REVALIDATE_INTERVAL_MS = 60_000;

let io: SocketIOServer | null = null;
let revalidateTimer: ReturnType<typeof setInterval> | null = null;

/** True when the authenticated socket holds the given `resource:action` permission. */
function socketHasPermission(socket: { data: Record<string, unknown> }, permission: Permission): boolean {
  const user = socket.data['user'] as SocketUserData | undefined;
  return holdsPermission(user?.permissions, permission);
}

/**
 * Load the user's current standing for a socket. Returns null when the token may
 * no longer be used: the user is gone or disabled, must change their password, or
 * the token's session was revoked (logout, password reset). Mirrors the REST
 * authenticate middleware so the websocket cannot outlive what REST would allow.
 */
export async function loadSocketUser(userId: string, sessionId: string | undefined, type: string): Promise<SocketUserData | null> {
  const user = await loadUserStanding(userId);
  if (!user || !user.enabled || user.mustChangePassword) return null;
  if (!(await isSessionLive(sessionId, userId))) return null;
  return { userId, sessionId, type, permissions: user.permissions, grants: user.grants };
}

/**
 * Socket.IO authentication middleware.
 * Validates the JWT from the `auth.token` handshake parameter and loads the user's
 * live standing (see loadSocketUser) so the room-join handlers can enforce RBAC
 * (the REST API's guards must not be bypassable over the websocket — e.g.
 * streaming logs requires system:info).
 */
export async function authMiddleware(
  socket: { data: Record<string, unknown>; handshake: { auth: Record<string, unknown> } },
  next: (err?: Error) => void,
): Promise<void> {
  const token = socket.handshake.auth['token'];
  if (typeof token !== 'string' || token.length === 0) {
    next(new Error('Authentication required'));
    return;
  }

  try {
    const decoded = verifyAccessToken(token);
    const userData = await loadSocketUser(decoded.userId, decoded.sessionId, decoded.type);
    if (!userData) {
      next(new Error('Authentication required'));
      return;
    }
    socket.data['user'] = userData;
    next();
  } catch {
    next(new Error('Authentication required'));
  }
}

/** Permission a joined room requires, or null for rooms this server does not manage. */
function roomPermission(room: string): Permission | null {
  if (room === 'dashboard') return ROOM_PERMISSIONS.dashboard;
  if (room === 'logs') return ROOM_PERMISSIONS.logs;
  if (room.startsWith('channel:')) return ROOM_PERMISSIONS.channel;
  return null;
}

interface RevalidatableSocket {
  readonly id: string;
  readonly data: Record<string, unknown>;
  readonly rooms: ReadonlySet<string>;
  leave(room: string): unknown;
  join(room: string): unknown;
  disconnect(close?: boolean): unknown;
}

/**
 * Re-check a connected socket against the database. Disconnects it when its
 * session was revoked or the user lost access, and leaves any room whose
 * permission the user no longer holds (e.g. after a role change).
 * Returns true when the socket remains connected.
 */
export async function revalidateSocket(socket: RevalidatableSocket): Promise<boolean> {
  const current = socket.data['user'] as SocketUserData | undefined;
  const fresh = current ? await loadSocketUser(current.userId, current.sessionId, current.type).catch(() => null) : null;
  if (!fresh) {
    logger.info({ socketId: socket.id }, 'Disconnecting socket: session revoked or access removed');
    socket.disconnect(true);
    return false;
  }
  socket.data['user'] = fresh;
  const audience = new Set(audienceRooms(fresh.grants));
  for (const room of [...socket.rooms]) {
    if (isAudienceRoom(room)) {
      if (!audience.has(room)) void socket.leave(room);
      continue;
    }
    const needed = roomPermission(room);
    if (needed === null) continue;
    if (!holdsPermission(fresh.permissions, needed)) {
      void socket.leave(room);
    } else if (room.startsWith('channel:') && !(await holdsOnChannel(fresh.grants, needed, room.slice('channel:'.length)).catch(() => false))) {
      // Scope narrowed, or the channel left the user's groups.
      void socket.leave(room);
    }
  }
  for (const room of audience) if (!socket.rooms.has(room)) void socket.join(room);
  return true;
}

/**
 * Registers connection event handlers for room join/leave.
 */
function registerConnectionHandlers(server: SocketIOServer): void {
  server.on('connection', (socket) => {
    logger.debug({ socketId: socket.id }, 'Socket connected');
    const user = socket.data['user'] as SocketUserData | undefined;
    if (user) for (const room of audienceRooms(user.grants)) void socket.join(room);

    socket.on('join:channel', async (channelId: unknown) => {
      if (typeof channelId !== 'string' || channelId.length === 0) {
        return;
      }
      if (!(await revalidateSocket(socket))) return;
      const joiner = socket.data['user'] as SocketUserData | undefined;
      const allowed = joiner !== undefined && await holdsOnChannel(joiner.grants, ROOM_PERMISSIONS.channel, channelId).catch(() => false);
      if (!allowed) {
        // The same answer for a channel outside the scope as for no permission: scope never shows which channels exist.
        socket.emit('error:forbidden', { room: `channel:${channelId}` });
        logger.warn({ socketId: socket.id, room: `channel:${channelId}` }, 'Denied room join (missing permission or outside scope)');
        return;
      }
      const room = `channel:${channelId}`;
      void socket.join(room);
      logger.debug({ socketId: socket.id, room }, 'Joined room');
    });

    socket.on('leave:channel', (channelId: unknown) => {
      if (typeof channelId !== 'string' || channelId.length === 0) {
        return;
      }
      const room = `channel:${channelId}`;
      void socket.leave(room);
      logger.debug({ socketId: socket.id, room }, 'Left room');
    });

    socket.on('join:dashboard', async () => {
      if (!(await revalidateSocket(socket))) return;
      if (!socketHasPermission(socket, ROOM_PERMISSIONS.dashboard)) {
        socket.emit('error:forbidden', { room: 'dashboard' });
        logger.warn({ socketId: socket.id, room: 'dashboard' }, 'Denied room join (missing permission)');
        return;
      }
      void socket.join('dashboard');
      logger.debug({ socketId: socket.id, room: 'dashboard' }, 'Joined room');
    });

    socket.on('leave:dashboard', () => {
      void socket.leave('dashboard');
      logger.debug({ socketId: socket.id, room: 'dashboard' }, 'Left room');
    });

    socket.on('join:logs', async () => {
      if (!(await revalidateSocket(socket))) return;
      // Live server logs can contain error payloads / PHI fragments — same bar as
      // the REST /logs endpoint (system:info), which only admin holds by default.
      if (!socketHasPermission(socket, ROOM_PERMISSIONS.logs)) {
        socket.emit('error:forbidden', { room: 'logs' });
        logger.warn({ socketId: socket.id, room: 'logs' }, 'Denied logs stream (missing permission)');
        return;
      }
      void socket.join('logs');
      logger.debug({ socketId: socket.id, room: 'logs' }, 'Joined room');
    });

    socket.on('leave:logs', () => {
      void socket.leave('logs');
      logger.debug({ socketId: socket.id, room: 'logs' }, 'Left room');
    });

    socket.on('disconnect', () => {
      logger.debug({ socketId: socket.id }, 'Socket disconnected');
    });
  });
}

export function initializeSocketIO(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.FRONTEND_URL,
      credentials: true,
    },
    pingTimeout: 20_000,
    pingInterval: 25_000,
    transports: ['websocket', 'polling'],
  });

  io.use(authMiddleware);
  registerConnectionHandlers(io);

  // Sockets stay open long after the handshake; re-check them periodically so a
  // logout, password reset, disable or role change also cuts off live streams.
  const server = io;
  revalidateTimer = setInterval(() => {
    for (const socket of server.of('/').sockets.values()) void revalidateSocket(socket);
  }, REVALIDATE_INTERVAL_MS);
  revalidateTimer.unref();

  logger.info({ component: 'socketio' }, 'Socket.IO initialized');
  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

/**
 * Emit an event to all sockets in a specific room.
 * No-ops if Socket.IO is not initialized.
 */
export function emitToRoom(room: string, event: string, data: unknown): void {
  if (!io) {
    return;
  }
  io.to(room).emit(event, data);
}

/** The window in which repeated live events for one room collapse into one emit (D-306). */
export const LIVE_EVENT_COALESCE_MS = 1_000;

interface CoalescedEmit {
  data: unknown;
  readonly throttle: Throttle;
}

/** One throttle per room and event. Bounded by the number of rooms (channels plus dashboard). */
const coalescedEmits = new Map<string, CoalescedEmit>();

/**
 * Emit an event to a room at most once per LIVE_EVENT_COALESCE_MS. The first
 * event goes out at once; the events after it in the same window go out as one
 * emit when the window ends, carrying the latest data. Used for the per-message
 * events (`stats:update`, `message:new`), whose listeners only refetch, so a
 * busy channel does not push one event per message to every open page (#231).
 * No-ops if Socket.IO is not initialized.
 */
export function emitToRoomCoalesced(room: string, event: string, data: unknown): void {
  if (!io) return;
  const key = `${room}\n${event}`;
  let entry = coalescedEmits.get(key);
  if (!entry) {
    const created: CoalescedEmit = {
      data,
      throttle: createThrottle(() => { emitQuietly(room, event, created.data); }, LIVE_EVENT_COALESCE_MS),
    };
    coalescedEmits.set(key, created);
    entry = created;
  }
  entry.data = data;
  entry.throttle.call();
}

/**
 * Emit and log a failure instead of throwing it. A trailing emit runs in a
 * timer, where a throw would reach uncaughtException and stop the server.
 */
function emitQuietly(room: string, event: string, data: unknown): void {
  try {
    emitToRoom(room, event, data);
  } catch (err) {
    logger.error(errorInfo(err), `Coalesced emit of ${event} to ${room} failed`);
  }
}

/** Drop every pending coalesced emit. */
function cancelCoalescedEmits(): void {
  for (const entry of coalescedEmits.values()) entry.throttle.cancel();
  coalescedEmits.clear();
}

/**
 * Emit an event about one channel to the sockets that may read it (D-310): the
 * all-channel readers and the readers of each group the channel is in. Best
 * effort: a failed group lookup is logged and the event is not sent, since a
 * live update must never reach a socket outside the channel's scope.
 */
export function emitToChannelAudience(channelId: string, event: string, data: unknown): void {
  const server = io;
  if (!server) return;
  // Each channel's events wait on the one before, so a STARTED then PAUSED pair
  // reaches the dashboard in that order whatever order the lookups finish in.
  const previous = audienceQueues.get(channelId) ?? Promise.resolve();
  const next = previous.then(() => channelGroupIds(channelId)).then((groups) => {
    server.to([ALL_CHANNELS_ROOM, ...groups.map(groupRoom)]).emit(event, data);
  }, (err: unknown) => {
    logger.warn({ ...errorInfo(err), channelId, event }, 'Could not read a channel\'s groups; live update not sent');
  });
  audienceQueues.set(channelId, next);
  void next.then(() => { if (audienceQueues.get(channelId) === next) audienceQueues.delete(channelId); });
}

/** The last pending audience emit per channel; cleared once a channel's queue is drained. */
const audienceQueues = new Map<string, Promise<void>>();

export async function shutdownSocketIO(): Promise<void> {
  if (revalidateTimer) {
    clearInterval(revalidateTimer);
    revalidateTimer = null;
  }
  cancelCoalescedEmits();
  if (io) {
    // Force-disconnect all clients first. Open websockets otherwise keep the
    // underlying HTTP server's `close()` from ever resolving, which would hang
    // graceful shutdown until the force-exit timer fires (SIGTERM => hard kill).
    io.disconnectSockets(true);
    await new Promise<void>((resolve) => {
      io!.close(() => resolve());
    });
    io = null;
    // Events kept arriving while close was pending and may have armed new windows.
    cancelCoalescedEmits();
    logger.info({ component: 'socketio' }, 'Socket.IO shut down');
  }
}

/**
 * Reset the io singleton (for testing only).
 * @internal
 */
export function _resetIO(server: SocketIOServer | null): void {
  cancelCoalescedEmits();
  io = server;
}
