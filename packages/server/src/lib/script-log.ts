// What channel scripts log, in the server log, while an administrator has that on (#164, D-387). Off
// without it: the text is the script's and can hold PHI.

import type { ScriptLogLevel } from '@galvanigraph/core-models';
import type { ScriptLogSink, ScriptRunAt } from '@galvanigraph/engine';
import logger from './logger.js';

export const SCRIPT_LOG_SETTING = 'logging.script_output';

/** `component` of these lines. */
export const SCRIPT_LOG_COMPONENT = 'channel-script';

/** The log page keeps the last 10,000 lines in memory. The message has the rest. */
export const MAX_SERVER_LOG_CHARS = 1_000;

let on = false;

export function setScriptLogging(enabled: boolean): void {
  on = enabled;
}

export function scriptsAreLogged(): boolean {
  return on;
}

/** Where it is from, in words: it is not the server's own. On one line, so that it cannot pass for two. */
function textOf({ channelId, messageId, script }: ScriptRunAt, text: string): string {
  const of = messageId === undefined ? `channel ${channelId}` : `channel ${channelId}, message ${String(messageId)}`;
  const cut = text.length - MAX_SERVER_LOG_CHARS;
  const kept = cut > 0 ? `${text.slice(0, MAX_SERVER_LOG_CHARS)}... (${String(cut)} more characters)` : text;
  return `[${script}, ${of}] ${kept.replaceAll('\r', '\\r').replaceAll('\n', '\\n')}`;
}

const PINO_LEVEL = { DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' } as const satisfies Record<ScriptLogLevel, string>;

/** Asked at each line, so a change holds for a script that is running. */
export function serverScriptLog(at: ScriptRunAt): ScriptLogSink {
  const fields = { component: SCRIPT_LOG_COMPONENT, ...at };
  return {
    line: ({ level, text }) => { if (on) logger[PINO_LEVEL[level]](fields, textOf(at, text)); },
    leftOut: (count) => { if (on) logger.warn(fields, textOf(at, `${String(count)} more lines of this script run are left out`)); },
  };
}
