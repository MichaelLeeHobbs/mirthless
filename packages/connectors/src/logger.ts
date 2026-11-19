import { pino, type Logger } from 'pino';

/** Narrow so tests can fake it without pino; a pino {@link Logger} satisfies it. */
export interface ConnectorLogger {
  error(obj: Readonly<Record<string, unknown>>, msg: string): void;
  warn(obj: Readonly<Record<string, unknown>>, msg: string): void;
  info(obj: Readonly<Record<string, unknown>>, msg: string): void;
  debug(obj: Readonly<Record<string, unknown>>, msg: string): void;
}

const rootLogger: Logger = pino({
  name: '@galvanigraph/connectors',
  level: process.env['LOG_LEVEL'] ?? 'info',
});

export function createConnectorLogger(connector: string): ConnectorLogger {
  return rootLogger.child({ connector });
}

export { errorInfo } from '@galvanigraph/core-util';
