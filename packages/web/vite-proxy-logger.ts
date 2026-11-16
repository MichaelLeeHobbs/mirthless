// ===========================================
// Vite logger without websocket-teardown noise
// ===========================================
// The dev server and `vite preview` proxy /socket.io to the API. When a browser
// tab or a Playwright context closes, the browser drops that websocket without a
// close handshake, and Vite logs the read reset (ECONNRESET) or the write to the
// closed socket (EPIPE) as a "ws proxy error" / "ws proxy socket error" pair
// (#167). Those pairs sat beside real failures in the e2e log and looked like
// them. Only those two heads with those two codes are dropped: a refused or
// failed connection to the API, and every HTTP proxy error, still print.

import { stripVTControlCharacters } from 'node:util';
import type { LogErrorOptions, Logger } from 'vite';

const WS_PROXY_HEADS: ReadonlySet<string> = new Set(['ws proxy error:', 'ws proxy socket error:']);
const PEER_GONE_CODES: ReadonlySet<string> = new Set(['ECONNRESET', 'EPIPE']);

function isWsPeerGone(msg: string, options: LogErrorOptions | undefined): boolean {
  const err: unknown = options?.error;
  const code = err instanceof Error && 'code' in err ? err.code : undefined;
  if (typeof code !== 'string' || !PEER_GONE_CODES.has(code)) return false;
  const head = stripVTControlCharacters(msg).split('\n', 1)[0] ?? '';
  return WS_PROXY_HEADS.has(head);
}

/**
 * Make a Vite logger drop websocket proxy errors whose peer went away (ECONNRESET, EPIPE).
 * Changes and returns the logger it is given, so its other state keeps working.
 */
export function quietWsProxyResets(logger: Logger): Logger {
  const error = logger.error.bind(logger);
  logger.error = (msg: string, options?: LogErrorOptions): void => {
    if (isWsPeerGone(msg, options)) return;
    error(msg, options);
  };
  return logger;
}
