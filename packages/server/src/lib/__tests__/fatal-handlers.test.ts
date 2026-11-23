import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as vm from 'node:vm';
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

  it('logs the message of a rejection with a plain { message } object, not "[object Object]"', () => {
    const { proc, logger } = setup();

    proc.emit('unhandledRejection', { message: 'socket hang up', code: 'ECONNRESET' });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ errMsg: 'socket hang up' }),
      expect.any(String),
    );
  });

  // The handler runs on the main thread with no time limit, so a getter or Proxy trap the script
  // put on the value would stop the server if it looped (GHSA-wcf2-qg2x-jmff).
  describe("a value from a script's realm", () => {
    const ACCESSORS = "for (const k of ['message', 'name', 'stack', 'toString', 'toJSON']) Object.defineProperty(target, k, { get() { touched += 1; return 'x'; } });";
    const PROXY = "new Proxy({}, new Proxy({}, { get() { touched += 1; return undefined; } }))";

    it.each([
      ['an error with getters', `var target = new Error('own message'); ${ACCESSORS} target`],
      ['an error whose prototype has getters', `var target = Error.prototype; ${ACCESSORS} var e = new Error('own message'); delete e.stack; e`],
      ['an error read through Error.prepareStackTrace', "Error.prepareStackTrace = function () { touched += 1; return 'x'; }; new Error('own message')"],
      ['a Proxy', PROXY],
      ['an object whose prototype is a Proxy', `Object.create(${PROXY})`],
      ['an object with getters', `var target = {}; ${ACCESSORS} target`],
      ['a function with getters', `var target = function () {}; ${ACCESSORS} target`],
    ])('is logged without running its code: %s', (_name, source) => {
      const { proc, logger, shutdown } = setup();
      const context = vm.createContext(Object.create(null) as object);
      vm.runInContext('var touched = 0;', context);

      proc.emit('unhandledRejection', vm.runInContext(source, context));

      expect(vm.runInContext('touched', context)).toBe(0);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(shutdown).not.toHaveBeenCalled();
    });

    it('keeps the message of an ordinary script error, so its author can find it', () => {
      const { proc, logger } = setup();

      proc.emit('unhandledRejection', vm.runInNewContext("new TypeError('no such patient')"));

      expect(logger.error).toHaveBeenCalledWith({ errMsg: 'no such patient' }, expect.stringContaining('Unhandled promise rejection'));
    });
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
