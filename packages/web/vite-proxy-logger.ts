// ===========================================
// Vite logger without websocket-teardown noise
// ===========================================
// The dev server and `vite preview` proxy /socket.io to the API. When a browser
// tab or a Playwright context closes, the browser drops that websocket without a
// close handshake, and Vite logs the read reset (ECONNRESET) or the write to the
// closed socket (EPIPE, or ECONNABORTED on Windows) as a "ws proxy error" / "ws
// proxy socket error" pair (#167). Those pairs sat beside real failures in the e2e
// log and looked like them.
//
// Only those two heads with those codes are dropped, from either side of the
// upgraded socket: the browser's, and the API's when the server resets its end.
// A refused connection to the API (ECONNREFUSED), any other code, and every
// "http proxy error" still print.
//
// The filter wraps the resolved logger rather than replacing it through
// `customLogger`, which would make Vite ignore `logLevel`, `--logLevel` and
// `clearScreen`.

import { stripVTControlCharacters } from 'node:util';
import type { LogErrorOptions, Logger, Plugin } from 'vite';

const WS_PROXY_HEADS: ReadonlySet<string> = new Set(['ws proxy error:', 'ws proxy socket error:']);
// ECONNABORTED is how Windows reports the same write to a closed socket.
const PEER_GONE_CODES: ReadonlySet<string> = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED']);

function isWsPeerGone(msg: string, options: LogErrorOptions | undefined): boolean {
  const err: unknown = options?.error;
  const code = err instanceof Error && 'code' in err ? err.code : undefined;
  if (typeof code !== 'string' || !PEER_GONE_CODES.has(code)) return false;
  const head = stripVTControlCharacters(msg).split('\n', 1)[0] ?? '';
  return WS_PROXY_HEADS.has(head);
}

/**
 * Make a Vite logger drop websocket proxy errors whose peer went away (ECONNRESET, EPIPE, ECONNABORTED).
 * Changes and returns the logger it is given, so its level and other state keep working.
 */
export function quietWsProxyResets(logger: Logger): Logger {
  const error = logger.error.bind(logger);
  logger.error = (msg: string, options?: LogErrorOptions): void => {
    if (isWsPeerGone(msg, options)) return;
    error(msg, options);
  };
  return logger;
}

/**
 * A plugin that applies {@link quietWsProxyResets} to the logger Vite resolved for the
 * dev server, `vite preview` and build. The proxy reads `config.logger.error` when it
 * logs, so wrapping it here is enough.
 */
export function quietWsProxyResetsPlugin(): Plugin {
  return {
    name: 'galvanigraph:quiet-ws-proxy-resets',
    configResolved(config): void {
      quietWsProxyResets(config.logger);
    },
  };
}
