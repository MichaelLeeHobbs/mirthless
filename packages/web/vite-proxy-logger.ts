// When a tab or a Playwright context closes, the browser drops the proxied
// /socket.io websocket without a close handshake, and Vite logs the reset as a
// "ws proxy error" pair that looked like a real failure in the e2e log (#167).
//
// Wraps the resolved logger rather than replacing it through `customLogger`,
// which would make Vite ignore `logLevel`, `--logLevel` and `clearScreen`.

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

/** Changes and returns the logger it is given, so its level and other state keep working. */
export function quietWsProxyResets(logger: Logger): Logger {
  const error = logger.error.bind(logger);
  logger.error = (msg: string, options?: LogErrorOptions): void => {
    if (isWsPeerGone(msg, options)) return;
    error(msg, options);
  };
  return logger;
}

/** Vite's proxy reads `config.logger.error` when it logs, so wrapping it here is enough. */
export function quietWsProxyResetsPlugin(): Plugin {
  return {
    name: 'galvanigraph:quiet-ws-proxy-resets',
    configResolved(config): void {
      quietWsProxyResets(config.logger);
    },
  };
}
