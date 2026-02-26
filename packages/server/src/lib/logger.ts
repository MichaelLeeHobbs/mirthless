// ===========================================
// Pino Logger Configuration
// ===========================================
// Pretty printing in development, JSON in production.

import type { Logger, TransportSingleOptions } from 'pino';
import { config } from '../config/index.js';

import { default as pino } from 'pino';

const devTransport: TransportSingleOptions = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:standard',
    ignore: 'pid,hostname',
  },
};

const pinoOptions: pino.LoggerOptions = { level: config.LOG_LEVEL };
if (config.NODE_ENV === 'development') {
  pinoOptions.transport = devTransport;
}

export const logger: Logger = pino(pinoOptions);

logger.info({
  logLevel: config.LOG_LEVEL,
  environment: config.NODE_ENV,
}, `Logger initialized at level: ${config.LOG_LEVEL} in ${config.NODE_ENV} mode`);

export default logger;
