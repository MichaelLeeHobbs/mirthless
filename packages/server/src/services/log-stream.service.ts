import { Writable } from 'node:stream';
import { SOCKET_EVENT } from '@galvanigraph/core-models';
import { SCRIPT_LOG_COMPONENT, scriptsAreLogged } from '../lib/script-log.js';
import { emitToRoom } from '../lib/socket.js';

const MAX_ENTRIES = 10_000;

export interface LogEntry {
  readonly timestamp: string;
  readonly level: number;
  readonly levelLabel: string;
  readonly logger: string;
  readonly message: string;
  /** Counts the lines since the server started. */
  readonly seq: number;
}

interface KeptEntry extends LogEntry {
  readonly ofScript: boolean;
}

export interface LogQueryParams {
  readonly level?: number;
  readonly search?: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface LogQueryResult {
  readonly entries: readonly LogEntry[];
  readonly total: number;
}

const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

const buffer: KeptEntry[] = [];
let writeIndex = 0;
let totalWritten = 0;
let holdsScripts = false;

/** What scripts wrote can hold PHI, and is kept no longer than it is logged (D-387). */
function forgetScripts(): void {
  if (!holdsScripts || scriptsAreLogged()) return;
  const kept = getEntries().filter((e) => !e.ofScript);
  buffer.splice(0, buffer.length, ...kept);
  writeIndex = kept.length % MAX_ENTRIES;
  holdsScripts = false;
}

function addEntry(entry: KeptEntry): void {
  forgetScripts();
  holdsScripts ||= entry.ofScript;
  if (buffer.length < MAX_ENTRIES) {
    buffer.push(entry);
  } else {
    buffer[writeIndex] = entry;
  }
  writeIndex = (writeIndex + 1) % MAX_ENTRIES;
  totalWritten++;
}

function getEntries(): readonly KeptEntry[] {
  return [...buffer.slice(writeIndex), ...buffer.slice(0, writeIndex)];
}

export class LogStreamService {
  static query(params: LogQueryParams = {}): LogQueryResult {
    const { level, search, offset = 0, limit = 100 } = params;

    forgetScripts();
    let entries = [...getEntries()];

    if (level !== undefined) {
      entries = entries.filter((e) => e.level >= level);
    }

    if (search) {
      const lower = search.toLowerCase();
      entries = entries.filter((e) => e.message.toLowerCase().includes(lower));
    }

    entries.reverse();

    const total = entries.length;
    const paged = entries.slice(offset, offset + limit).map(({ ofScript: _ofScript, ...entry }) => entry);

    return { entries: paged, total };
  }

  static createWritableStream(): Writable {
    return new Writable({
      write(chunk: Buffer, _encoding: string, callback: () => void): void {
        const line = chunk.toString().trim();
        if (!line) {
          callback();
          return;
        }

        try {
          const parsed: unknown = JSON.parse(line);
          if (typeof parsed !== 'object' || parsed === null) {
            callback();
            return;
          }

          const obj = parsed as Record<string, unknown>;
          const level = typeof obj['level'] === 'number' ? obj['level'] : 30;
          const msg = typeof obj['msg'] === 'string' ? obj['msg'] : '';
          const time = typeof obj['time'] === 'number' ? new Date(obj['time']).toISOString() : new Date().toISOString();
          const loggerName = typeof obj['name'] === 'string' ? obj['name'] : 'server';

          const entry: LogEntry = {
            timestamp: time,
            level,
            levelLabel: LEVEL_LABELS[level] ?? 'UNKNOWN',
            logger: loggerName,
            message: msg,
            seq: totalWritten,
          };

          addEntry({ ...entry, ofScript: obj['component'] === SCRIPT_LOG_COMPONENT });
          emitToRoom('logs', SOCKET_EVENT.SERVER_LOG, entry);
        } catch {
          // Not JSON — ignore non-JSON log lines
        }

        callback();
      },
    });
  }

  static getBufferSize(): number {
    return buffer.length;
  }

  /** Tests only. */
  static _reset(): void {
    buffer.length = 0;
    writeIndex = 0;
    totalWritten = 0;
    holdsScripts = false;
  }

  /** Tests only. */
  static _addEntry(entry: Omit<LogEntry, 'seq'>): void {
    addEntry({ ...entry, seq: totalWritten, ofScript: false });
  }
}
