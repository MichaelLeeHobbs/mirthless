import type { ScriptLogLine, ScriptLogRun } from '@galvanigraph/core-models';

/** Where a run's lines go as the script writes them, as many as are kept (#164). Must not throw. */
export interface ScriptLogSink {
  line(line: ScriptLogLine): void;
  /** At the end of a run that wrote more. */
  leftOut(count: number): void;
}

/** What ran, for the server log. Without a message for a script that runs for none. */
export interface ScriptRunAt {
  readonly channelId: string;
  readonly messageId?: number | undefined;
  readonly metaDataId?: number | undefined;
  readonly script: string;
}

/** Keeps one run's lines, and passes them on. */
export class ScriptRunLog implements ScriptLogSink {
  private readonly lines: ScriptLogLine[] = [];
  private omitted = 0;

  constructor(private readonly script: string, private readonly next?: ScriptLogSink) {}

  line(line: ScriptLogLine): void {
    this.lines.push(line);
    this.next?.line(line);
  }

  leftOut(count: number): void {
    this.omitted = count;
    this.next?.leftOut(count);
  }

  /** Null when the script wrote nothing. */
  run(): ScriptLogRun | null {
    return this.lines.length === 0 ? null : { script: this.script, lines: this.lines, leftOut: this.omitted };
  }
}
