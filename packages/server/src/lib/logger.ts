import type { Logger } from 'pino';
import { Writable } from 'node:stream';
import { config } from '../config/index.js';

import { default as pino } from 'pino';

let captureStream: Writable | null = null;

export function setLogCaptureStream(stream: Writable): void {
  captureStream = stream;
}

const logTee = new Writable({
  write(chunk: Buffer, encoding: BufferEncoding, callback: () => void): void {
    process.stdout.write(chunk);
    if (captureStream) {
      captureStream.write(chunk, encoding);
    }
    callback();
  },
});

// Covers both pino-http's request/response serialization and ad-hoc structured logs.
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
  // The capture stream gets no dev logs; accepted.
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
  logger = pino(pinoOptions, logTee);
}

export { logger };

logger.info({
  logLevel: config.LOG_LEVEL,
  environment: config.NODE_ENV,
}, `Logger initialized at level: ${config.LOG_LEVEL} in ${config.NODE_ENV} mode`);

export default logger;
