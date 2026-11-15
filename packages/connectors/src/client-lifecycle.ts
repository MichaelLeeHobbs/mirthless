// ===========================================
// Client Lifecycle Helpers
// ===========================================
// Connect and close for polling receivers (SFTP, IMAP) that hold one remote
// client and replace it after a failure. Both steps run under a timeout so a
// hung server cannot wedge the poll loop.

import { errorInfo, type ConnectorLogger } from './logger.js';
import { withTimeout } from './timeout.js';

/** A client that opens its connection with `connect()`. */
export interface ConnectableClient {
  connect(): Promise<void>;
}

/**
 * Connect a newly built client under a timeout and return it. Rejects when the
 * connect fails or exceeds `timeoutMs`, so the caller stores the client only
 * once it is connected.
 *
 * On failure `close`, when given, runs (under the same timeout) before the
 * rejection: a client library can finish a connect after our timeout, and
 * nobody would hold that session to close it. A failed close is ignored, since
 * the connect error is the one the caller reports.
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

/** Options for {@link closeQuietly}. */
export interface CloseQuietlyOptions {
  /** Closes the client (for example `() => client.end()`). */
  readonly close: () => Promise<void>;
  readonly timeoutMs: number;
  /** Timeout label, as in `'<label> timed out after <ms>ms'`. */
  readonly label: string;
  readonly logger: ConnectorLogger;
  /** Warning logged when the close fails or times out. */
  readonly message: string;
}

/**
 * Close a client under a timeout. A failure or timeout is logged as a warning
 * and never thrown: the caller is discarding the client either way.
 */
export async function closeQuietly(options: CloseQuietlyOptions): Promise<void> {
  try {
    await withTimeout(options.close(), options.timeoutMs, options.label);
  } catch (err) {
    options.logger.warn(errorInfo(err), options.message);
  }
}
