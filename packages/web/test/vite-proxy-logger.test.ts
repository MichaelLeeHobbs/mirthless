// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createLogger, type Logger } from 'vite';
import { quietWsProxyResets } from '../vite-proxy-logger.js';

/** A real Vite logger that writes to a fake console, wrapped by the filter. */
function capture(): { readonly logger: Logger; readonly printed: () => readonly string[] } {
  const error = vi.fn<(line: string) => void>();
  const fakeConsole = { ...console, error } as Console;
  const logger = quietWsProxyResets(createLogger('info', { allowClearScreen: false, console: fakeConsole }));
  return { logger, printed: () => error.mock.calls.map(([line]) => line) };
}

function socketError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

// Vite colours the head red when the terminal supports it: `${red('ws proxy error:')}\n${err.stack}`.
const RED = '\u001b[31m';
const RESET = '\u001b[39m';

describe('quietWsProxyResets', () => {
  it.each([
    ['ws proxy error:', 'ECONNRESET', 'read ECONNRESET'],
    ['ws proxy socket error:', 'ECONNRESET', 'read ECONNRESET'],
    ['ws proxy error:', 'EPIPE', 'write EPIPE'],
    ['ws proxy socket error:', 'EPIPE', 'write EPIPE'],
    // Windows reports the same teardown as an aborted write.
    ['ws proxy error:', 'ECONNABORTED', 'write ECONNABORTED'],
    ['ws proxy socket error:', 'ECONNABORTED', 'write ECONNABORTED'],
  ])('drops "%s" when the socket was dropped (%s)', (head, code, message) => {
    const { logger, printed } = capture();
    const err = socketError(code, message);
    logger.error(`${head}\n${err.stack ?? ''}`, { timestamp: true, error: err });
    logger.error(`${RED}${head}${RESET}\n${err.stack ?? ''}`, { timestamp: true, error: err });
    expect(printed()).toEqual([]);
  });

  it('keeps a websocket proxy error with any other code, such as a refused connection', () => {
    const { logger, printed } = capture();
    const err = socketError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:3000');
    logger.error(`ws proxy error:\n${err.stack ?? ''}`, { error: err });
    expect(printed()).toHaveLength(1);
    expect(printed()[0]).toContain('ECONNREFUSED');
  });

  it('keeps an HTTP proxy error even when the code is ECONNRESET', () => {
    const { logger, printed } = capture();
    const err = socketError('ECONNRESET', 'socket hang up');
    logger.error(`http proxy error: /api/v1/channels\n${err.stack ?? ''}`, { error: err });
    expect(printed()).toHaveLength(1);
    expect(printed()[0]).toContain('http proxy error: /api/v1/channels');
  });

  it('keeps a websocket proxy error logged without its error object', () => {
    const { logger, printed } = capture();
    logger.error('ws proxy error:\nError: read ECONNRESET');
    expect(printed()).toHaveLength(1);
  });

  it('keeps an unrelated error that only mentions the websocket proxy later in its text', () => {
    const { logger, printed } = capture();
    const err = socketError('ECONNRESET', 'read ECONNRESET');
    logger.error(`build failed\nws proxy error:`, { error: err });
    expect(printed()).toHaveLength(1);
  });

  it('marks the logger as having warned only for errors it prints', () => {
    const dropped = capture();
    const err = socketError('ECONNRESET', 'read ECONNRESET');
    dropped.logger.error('ws proxy error:', { error: err });
    expect(dropped.logger.hasWarned).toBe(false);

    const kept = capture();
    kept.logger.error('something real broke');
    expect(kept.logger.hasWarned).toBe(true);
  });
});
