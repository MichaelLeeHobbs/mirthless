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
 */
export async function connectFresh<C extends ConnectableClient>(
  client: C,
  timeoutMs: number,
  label: string,
): Promise<C> {
  await withTimeout(client.connect(), timeoutMs, label);
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
