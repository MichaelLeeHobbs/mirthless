// What scripts wrote with their logger, as it is stored with the message they ran for (#164, D-387).

import { z } from 'zod/v4';

/** A run keeps its first lines and says how many came after them. */
export const MAX_SCRIPT_LOG_LINES = 200;

/** A line keeps its first characters: a script may log whole messages. */
export const MAX_SCRIPT_LOG_LINE_CHARS = 10_000;

/** A connector keeps its last runs: a queue can run a destination's script without end. */
export const MAX_SCRIPT_LOG_RUNS = 20;

export const SCRIPT_LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
export type ScriptLogLevel = (typeof SCRIPT_LOG_LEVELS)[number];

const scriptLogRunSchema = z.object({
  /** In words for a reader, such as `Source filter`. */
  script: z.string(),
  lines: z.array(z.object({ level: z.enum(SCRIPT_LOG_LEVELS), time: z.string(), text: z.string() })),
  leftOut: z.number().int().min(0),
});

const scriptLogSchema = z.object({
  runs: z.array(scriptLogRunSchema),
  /** Runs that are not kept any more. */
  earlierRuns: z.number().int().min(0),
});

export type ScriptLogRun = z.infer<typeof scriptLogRunSchema>;
export type ScriptLogLine = ScriptLogRun['lines'][number];
export type ScriptLog = z.infer<typeof scriptLogSchema>;

/** Null when the stored text is not a script log. */
export function readScriptLog(stored: string): ScriptLog | null {
  try {
    return scriptLogSchema.parse(JSON.parse(stored));
  } catch {
    return null;
  }
}

/** The text to store for a connector after another run. `stored` is what is there now. */
export function withScriptLogRun(stored: string | null, run: ScriptLogRun): string {
  const log = (stored === null ? null : readScriptLog(stored)) ?? { runs: [], earlierRuns: 0 };
  const runs = [...log.runs, run];
  const kept = runs.slice(-MAX_SCRIPT_LOG_RUNS);
  return JSON.stringify({ runs: kept, earlierRuns: log.earlierRuns + runs.length - kept.length } satisfies ScriptLog);
}
