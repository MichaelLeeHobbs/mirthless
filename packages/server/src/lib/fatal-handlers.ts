// Without these, Node prints to stderr and dies at once: the error never reaches
// the structured log and channels are not stopped in order.

import type { Logger } from 'pino';
import { errorInfo } from '@galvanigraph/core-util';

export interface FatalEventSource {
  on(event: 'unhandledRejection' | 'uncaughtException', listener: (reason: unknown) => void): unknown;
}

export interface FatalHandlerDeps {
  readonly proc: FatalEventSource;
  readonly logger: Pick<Logger, 'error' | 'fatal'>;
  readonly shutdown: (reason: string, exitCode: number) => void;
}

/**
 * A stray rejection must not stop every channel, so the server keeps running.
 * An uncaught exception leaves the process in an unknown state, so it shuts down
 * in order and exits non-zero for the supervisor to restart; unfinished messages
 * are recovered on start.
 */
export function installFatalHandlers(deps: FatalHandlerDeps): void {
  deps.proc.on('unhandledRejection', (reason) => {
    deps.logger.error(errorInfo(reason),'Unhandled promise rejection. This is a bug: a promise failed with nothing handling it');
  });

  deps.proc.on('uncaughtException', (error) => {
    deps.logger.fatal(errorInfo(error),'Uncaught exception. Shutting down');
    deps.shutdown('uncaughtException', 1);
  });
}
