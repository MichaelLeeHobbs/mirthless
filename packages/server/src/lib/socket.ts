// ===========================================
// Socket.IO Server
// ===========================================
// Singleton Socket.IO server instance.

import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { config } from '../config/index.js';
import logger from './logger.js';

let io: SocketIOServer | null = null;

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

  logger.info('Socket.IO initialized');
  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
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
