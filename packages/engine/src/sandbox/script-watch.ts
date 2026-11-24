// What the main thread's sandbox is running, in memory another thread can read while the main
// thread is stuck in it: node:vm's time limit does not stop every script (D-340).

/** [0] sequence, [1] the running script's limit in ms (0: none), [2] 1 while a debugger is open, then the script's channel id. */
const HEADER_BYTES = 12;
const CHANNEL_ID_BYTES = 36;

const buffer = new SharedArrayBuffer(HEADER_BYTES + CHANNEL_ID_BYTES);
const header = new Int32Array(buffer, 0, 3);
const channelIdBytes = Buffer.from(buffer, HEADER_BYTES, CHANNEL_ID_BYTES);

export interface ScriptWatch {
  /** Changes at every sign of life. */
  readonly sequence: number;
  readonly limitMs: number;
  readonly channelId: string | null;
}

/** The main thread's event loop turns, so no script holds it. A script at a breakpoint is not stuck. */
export function beatScriptWatch(debugging: boolean): void {
  Atomics.store(header, 2, debugging ? 1 : 0);
  Atomics.add(header, 0, 1);
}

/** Run a script's synchronous call, showing it while it runs. */
export function watchScript<T>(limitMs: number, channelId: string | undefined, run: () => T): T {
  channelIdBytes.fill(0);
  channelIdBytes.write(channelId ?? '', 'latin1');
  Atomics.store(header, 1, limitMs);
  Atomics.add(header, 0, 1);
  try {
    return run();
  } finally {
    Atomics.store(header, 1, 0);
    Atomics.add(header, 0, 1);
  }
}

export function scriptWatchBuffer(): SharedArrayBuffer {
  return buffer;
}

export function readScriptWatch(shared: SharedArrayBuffer): ScriptWatch {
  const words = new Int32Array(shared, 0, 3);
  const sequence = Atomics.load(words, 0);
  const limitMs = Atomics.load(words, 2) === 1 ? 0 : Atomics.load(words, 1);
  if (limitMs === 0) return { sequence, limitMs, channelId: null };
  const id = Buffer.from(shared, HEADER_BYTES, CHANNEL_ID_BYTES).toString('latin1').replaceAll('\0', '');
  return { sequence, limitMs, channelId: id === '' ? null : id };
}

export interface StuckLimits {
  readonly graceMs: number;
  readonly tickMs: number;
}

/**
 * Says when one script has run past its limit and the grace with no sign of life. A tick counts for
 * at most two intervals, so a suspended machine or a paused container does not count as running.
 */
export class StuckDetector {
  private sequence: number | null = null;
  private ranMs = 0;

  constructor(private readonly limits: StuckLimits) {}

  tick(watch: ScriptWatch, elapsedMs: number): boolean {
    if (watch.limitMs === 0 || watch.sequence !== this.sequence) {
      this.sequence = watch.sequence;
      this.ranMs = 0;
      return false;
    }
    this.ranMs += Math.min(elapsedMs, 2 * this.limits.tickMs);
    return this.ranMs > watch.limitMs + this.limits.graceMs;
  }
}
