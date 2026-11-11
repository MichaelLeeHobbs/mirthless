// ===========================================
// Fatal Error Handlers
// ===========================================
// Last line of defence for errors nothing else caught. Without these Node
// prints to stderr and dies at once: the error never reaches the structured
// log and channels are not stopped in order.

import type { Logger } from 'pino';

/** The part of `process` the handlers need. */
export interface FatalEventSource {
  on(event: 'unhandledRejection' | 'uncaughtException', listener: (reason: unknown) => void): unknown;
}

export interface FatalHandlerDeps {
  readonly proc: FatalEventSource;
  readonly logger: Pick<Logger, 'error' | 'fatal'>;
  /** Starts the ordered shutdown and exits with the given code. */
  readonly shutdown: (reason: string, exitCode: number) => void;
}

function describe(reason: unknown): { errMsg: string; stack: string | undefined } {
  return reason instanceof Error
    ? { errMsg: reason.message, stack: reason.stack }
    : { errMsg: String(reason), stack: undefined };
}

/**
 * Registers the process-level error handlers.
 *
 * - An unhandled promise rejection is logged as an error and the server keeps
 *   running: one stray rejection must not stop every channel.
 * - An uncaught exception leaves the process in an unknown state, so it is
 *   logged as fatal and the server shuts down in order and exits non-zero for
 *   the supervisor to restart it. Unfinished messages are recovered on start.
 */
export function installFatalHandlers(deps: FatalHandlerDeps): void {
  deps.proc.on('unhandledRejection', (reason) => {
    deps.logger.error(describe(reason), 'Unhandled promise rejection. This is a bug: a promise failed with nothing handling it');
  });

  deps.proc.on('uncaughtException', (error) => {
    deps.logger.fatal(describe(error), 'Uncaught exception. Shutting down');
    deps.shutdown('uncaughtException', 1);
  });
}
