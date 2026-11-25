// What channel scripts log, in the server log, while an administrator has that on (#164, D-387). Off
// without it: the text is the script's and can hold PHI.

import type { ScriptLogLevel } from '@galvanigraph/core-models';
import type { ScriptLogSink, ScriptRunAt } from '@galvanigraph/engine';
import logger from './logger.js';

export const SCRIPT_LOG_SETTING = 'logging.script_output';

let on = false;

export function setScriptLogging(enabled: boolean): void {
  on = enabled;
}

const PINO_LEVEL = { DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' } as const satisfies Record<ScriptLogLevel, string>;

/** Asked at each line, so a change holds for a script that is running. */
export function serverScriptLog(at: ScriptRunAt): ScriptLogSink {
  const fields = { component: 'channel-script', ...at };
  return {
    line: ({ level, text }) => { if (on) logger[PINO_LEVEL[level]](fields, text); },
    leftOut: (count) => { if (on) logger.warn(fields, `${String(count)} more lines of this script run are left out`); },
  };
}
