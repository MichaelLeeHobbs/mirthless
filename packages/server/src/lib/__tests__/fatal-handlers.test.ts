// ===========================================
// Fatal Error Handler Tests
// ===========================================

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';
import { installFatalHandlers } from '../fatal-handlers.js';

function setup(): { proc: EventEmitter; logger: { error: ReturnType<typeof vi.fn>; fatal: ReturnType<typeof vi.fn> }; shutdown: ReturnType<typeof vi.fn> } {
  const proc = new EventEmitter();
  const logger = { error: vi.fn(), fatal: vi.fn() };
  const shutdown = vi.fn();
  installFatalHandlers({ proc, logger: logger as unknown as Logger, shutdown });
  return { proc, logger, shutdown };
}

describe('installFatalHandlers', () => {
  it('logs an unhandled rejection with its stack and keeps the server running', () => {
    const { proc, logger, shutdown } = setup();
    const reason = new Error('lost promise');

    proc.emit('unhandledRejection', reason);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ errMsg: 'lost promise', stack: reason.stack }),
      expect.stringContaining('Unhandled promise rejection'),
    );
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('logs a rejection whose reason is not an Error', () => {
    const { proc, logger } = setup();

    proc.emit('unhandledRejection', 'plain text reason');

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ errMsg: 'plain text reason' }),
      expect.any(String),
    );
  });

  it('logs an uncaught exception as fatal and starts an orderly shutdown that exits non-zero', () => {
    const { proc, logger, shutdown } = setup();
    const error = new Error('boom');

    proc.emit('uncaughtException', error);

    expect(logger.fatal).toHaveBeenCalledWith(
      expect.objectContaining({ errMsg: 'boom', stack: error.stack }),
      expect.stringContaining('Uncaught exception'),
    );
    expect(shutdown).toHaveBeenCalledWith('uncaughtException', 1);
  });
});
