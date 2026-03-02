// ===========================================
// Socket.IO Server
// ===========================================
// Singleton Socket.IO server instance with JWT auth
// and channel-based room management.

import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { config } from '../config/index.js';
import logger from './logger.js';
import { verifyAccessToken } from './jwt.js';

/** User data stored on authenticated sockets. */
export interface SocketUserData {
  readonly userId: string;
  readonly sessionId?: string | undefined;
  readonly type: string;
}

let io: SocketIOServer | null = null;

/**
 * Socket.IO authentication middleware.
 * Validates JWT from the `auth.token` handshake parameter.
 */
export function authMiddleware(
  socket: { data: Record<string, unknown>; handshake: { auth: Record<string, unknown> } },
  next: (err?: Error) => void,
): void {
  const token = socket.handshake.auth['token'];
  if (typeof token !== 'string' || token.length === 0) {
    next(new Error('Authentication required'));
    return;
  }

  try {
    const decoded = verifyAccessToken(token);
    const userData: SocketUserData = {
      userId: decoded.userId,
      sessionId: decoded.sessionId,
      type: decoded.type,
    };
    socket.data['user'] = userData;
    next();
  } catch {
    next(new Error('Authentication required'));
  }
}

/**
 * Registers connection event handlers for room join/leave.
 */
function registerConnectionHandlers(server: SocketIOServer): void {
  server.on('connection', (socket) => {
    logger.debug({ socketId: socket.id }, 'Socket connected');

    socket.on('join:channel', (channelId: unknown) => {
      if (typeof channelId !== 'string' || channelId.length === 0) {
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

    socket.on('join:dashboard', () => {
      void socket.join('dashboard');
      logger.debug({ socketId: socket.id, room: 'dashboard' }, 'Joined room');
    });

    socket.on('leave:dashboard', () => {
      void socket.leave('dashboard');
      logger.debug({ socketId: socket.id, room: 'dashboard' }, 'Left room');
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

  logger.info('Socket.IO initialized');
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

/**
 * Emit an event to all connected sockets.
 * No-ops if Socket.IO is not initialized.
 */
export function emitToAll(event: string, data: unknown): void {
  if (!io) {
    return;
  }
  io.emit(event, data);
}

export async function shutdownSocketIO(): Promise<void> {
  if (io) {
    await new Promise<void>((resolve) => {
      io!.close(() => resolve());
    });
    io = null;
    logger.info('Socket.IO shut down');
  }
}

/**
 * Reset the io singleton (for testing only).
 * @internal
 */
export function _resetIO(server: SocketIOServer | null): void {
  io = server;
}
