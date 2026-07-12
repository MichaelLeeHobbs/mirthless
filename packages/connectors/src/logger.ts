// ===========================================
// Connector Logging
// ===========================================
// Structured logging for connectors via pino. Failures in poll cycles,
// connection handling, and dispatch must be VISIBLE — never swallowed.
// Connectors accept an optional injected logger for testability; when
// none is provided they use a child of the package root logger.

import { pino, type Logger } from 'pino';

/**
 * Minimal logging surface used across connectors.
 * Structurally satisfied by a pino {@link Logger}, but narrow enough
 * to mock in tests without pulling in pino.
 */
export interface ConnectorLogger {
  error(obj: Readonly<Record<string, unknown>>, msg: string): void;
  warn(obj: Readonly<Record<string, unknown>>, msg: string): void;
  info(obj: Readonly<Record<string, unknown>>, msg: string): void;
  debug(obj: Readonly<Record<string, unknown>>, msg: string): void;
}

// ----- Root logger -----

const rootLogger: Logger = pino({
  name: '@mirthless/connectors',
  level: process.env['LOG_LEVEL'] ?? 'info',
});

/**
 * Create a child logger bound to a connector name/type.
 * @param connector - Connector identifier (e.g. 'FILE', 'TCP_MLLP').
 */
export function createConnectorLogger(connector: string): ConnectorLogger {
  return rootLogger.child({ connector });
}

/**
 * Normalize an unknown thrown value into a structured, loggable shape.
 * Never throws; safe for any caught value.
 */
export function errorInfo(err: unknown): Readonly<Record<string, unknown>> {
  if (err instanceof Error) {
    return { message: err.message, name: err.name, stack: err.stack };
  }
  return { message: String(err) };
}
