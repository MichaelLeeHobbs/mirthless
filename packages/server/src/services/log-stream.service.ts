// ===========================================
// Log Stream Service
// ===========================================
// In-memory ring buffer for server log entries.
// Captures Pino log output and emits to Socket.IO.

import { Writable } from 'node:stream';
import { SOCKET_EVENT } from '@mirthless/core-models';
import { emitToRoom } from '../lib/socket.js';

// ----- Constants -----

const MAX_ENTRIES = 10_000;

// ----- Types -----

export interface LogEntry {
  readonly timestamp: string;
  readonly level: number;
  readonly levelLabel: string;
  readonly logger: string;
  readonly message: string;
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

// ----- Pino Level Map -----

const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

// ----- Ring Buffer -----

const buffer: LogEntry[] = [];
let writeIndex = 0;
let totalWritten = 0;

function addEntry(entry: LogEntry): void {
  if (buffer.length < MAX_ENTRIES) {
    buffer.push(entry);
  } else {
    buffer[writeIndex] = entry;
  }
  writeIndex = (writeIndex + 1) % MAX_ENTRIES;
  totalWritten++;
}

function getEntries(): readonly LogEntry[] {
  if (totalWritten <= MAX_ENTRIES) {
    return buffer;
  }
  // Ring has wrapped: entries from writeIndex to end, then 0 to writeIndex
  return [...buffer.slice(writeIndex), ...buffer.slice(0, writeIndex)];
}

// ----- Service -----

export class LogStreamService {
  /** Query log entries with optional filtering and pagination. */
  static query(params: LogQueryParams = {}): LogQueryResult {
    const { level, search, offset = 0, limit = 100 } = params;

    let entries = [...getEntries()];

    // Filter by level (show entries >= specified level)
    if (level !== undefined) {
      entries = entries.filter((e) => e.level >= level);
    }

    // Filter by search text
    if (search) {
      const lower = search.toLowerCase();
      entries = entries.filter((e) => e.message.toLowerCase().includes(lower));
    }

    // Newest first
    entries.reverse();

    const total = entries.length;
    const paged = entries.slice(offset, offset + limit);

    return { entries: paged, total };
  }

  /**
   * Create a Writable stream that parses Pino JSON lines
   * and pushes entries into the ring buffer + Socket.IO.
   */
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
          };

          addEntry(entry);
          emitToRoom('logs', SOCKET_EVENT.SERVER_LOG, entry);
        } catch {
          // Not JSON — ignore non-JSON log lines
        }

        callback();
      },
    });
  }

  /** Get the current buffer size. */
  static getBufferSize(): number {
    return buffer.length;
  }

  /** Reset the buffer (for testing). */
  static _reset(): void {
    buffer.length = 0;
    writeIndex = 0;
    totalWritten = 0;
  }

  /** Add an entry directly (for testing or manual injection). */
  static _addEntry(entry: LogEntry): void {
    addEntry(entry);
  }
}
