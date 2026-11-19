// Both steps run under a timeout so a hung server cannot wedge a poll loop.

import { errorInfo, type ConnectorLogger } from './logger.js';
import { withTimeout } from './timeout.js';

export interface ConnectableClient {
  connect(): Promise<void>;
}

/**
 * The caller stores the client only once this resolves. On failure `close` runs first:
 * a client library can finish a connect after our timeout, leaving a session nobody holds.
 */
export async function connectFresh<C extends ConnectableClient>(
  client: C,
  timeoutMs: number,
  label: string,
  close?: () => Promise<void>,
): Promise<C> {
  try {
    await withTimeout(client.connect(), timeoutMs, label);
  } catch (err) {
    if (close) {
      try {
        await withTimeout(close(), timeoutMs, `${label} cleanup`);
      } catch {
        // The connect error below is what the caller reports.
      }
    }
    throw err;
  }
  return client;
}

export interface CloseQuietlyOptions {
  readonly close: () => Promise<void>;
  readonly timeoutMs: number;
  /** Timeout label, as in `'<label> timed out after <ms>ms'`. */
  readonly label: string;
  readonly logger: ConnectorLogger;
  readonly message: string;
}

/** Never throws: the caller is discarding the client either way. */
export async function closeQuietly(options: CloseQuietlyOptions): Promise<void> {
  try {
    await withTimeout(options.close(), options.timeoutMs, options.label);
  } catch (err) {
    options.logger.warn(errorInfo(err), options.message);
  }
}
