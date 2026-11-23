// Without these, Node prints to stderr and dies at once: the error never reaches
// the structured log and channels are not stopped in order.

import type { Logger } from 'pino';
import { errorInfo } from '@galvanigraph/core-util';
import { isHostValue, ownString } from '@galvanigraph/engine';

export interface FatalEventSource {
  on(event: 'unhandledRejection' | 'uncaughtException', listener: (reason: unknown) => void): unknown;
}

export interface FatalHandlerDeps {
  readonly proc: FatalEventSource;
  readonly logger: Pick<Logger, 'error' | 'fatal'>;
  readonly shutdown: (reason: string, exitCode: number) => void;
}

/** A value a script made is read without running its getters or Proxy traps: here, one that loops would stop the server. */
function safeErrorInfo(value: unknown): Readonly<Record<string, unknown>> {
  if (isHostValue(value)) return errorInfo(value);
  return { errMsg: ownString(value, 'message') ?? 'Unreadable error value' };
}

/**
 * A stray rejection must not stop every channel, so the server keeps running.
 * An uncaught exception leaves the process in an unknown state, so it shuts down
 * in order and exits non-zero for the supervisor to restart; unfinished messages
 * are recovered on start.
 */
export function installFatalHandlers(deps: FatalHandlerDeps): void {
  deps.proc.on('unhandledRejection', (reason) => {
    deps.logger.error(safeErrorInfo(reason), isHostValue(reason)
      ? 'Unhandled promise rejection. This is a bug: a promise failed with nothing handling it'
      : 'Unhandled promise rejection in a channel script: a promise the script did not await failed');
  });

  deps.proc.on('uncaughtException', (error) => {
    deps.logger.fatal(safeErrorInfo(error), 'Uncaught exception. Shutting down');
    deps.shutdown('uncaughtException', 1);
  });
}
