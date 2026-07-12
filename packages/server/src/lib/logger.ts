// ===========================================
// Pino Logger Configuration
// ===========================================
// Pretty printing in development, JSON in production.
// Log capture stream for in-memory ring buffer (server logs feature).

import type { Logger } from 'pino';
import { Writable } from 'node:stream';
import { config } from '../config/index.js';

import { default as pino } from 'pino';

// ----- Log Capture Stream -----

// A pluggable writable stream that captures JSON log lines.
// Initialized lazily by LogStreamService.initCapture().
let captureStream: Writable | null = null;

/** Set the capture stream for log entries. Call once during server init. */
export function setLogCaptureStream(stream: Writable): void {
  captureStream = stream;
}

// Internal writable that forwards to captureStream if set
const logTee = new Writable({
  write(chunk: Buffer, encoding: BufferEncoding, callback: () => void): void {
    // Always write to stdout
    process.stdout.write(chunk);
    // Forward to capture stream if set
    if (captureStream) {
      captureStream.write(chunk, encoding);
    }
    callback();
  },
});

// ----- Logger Setup -----

// Redact credentials and PHI-adjacent fields from all log output. Covers both
// pino-http request/response serialization and ad-hoc structured logs.
const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'authorization',
  'cookie',
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
];

const pinoOptions: pino.LoggerOptions = {
  level: config.LOG_LEVEL,
  redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
};

let logger: Logger;

if (config.NODE_ENV === 'development') {
  // In development, use pino-pretty transport (worker thread).
  // Log capture stream won't receive dev logs — that's acceptable.
  pinoOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  };
  logger = pino(pinoOptions);
} else {
  // In production, use our tee stream so logs go to both stdout and capture.
  logger = pino(pinoOptions, logTee);
}

export { logger };

logger.info({
  logLevel: config.LOG_LEVEL,
  environment: config.NODE_ENV,
}, `Logger initialized at level: ${config.LOG_LEVEL} in ${config.NODE_ENV} mode`);

export default logger;
