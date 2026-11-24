import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/socket.js', () => ({
  emitToRoom: vi.fn(),
}));

const { LogStreamService } = await import('../log-stream.service.js');
const { emitToRoom } = await import('../../lib/socket.js');

function makeEntry(overrides?: Partial<Record<string, unknown>>): {
  readonly timestamp: string;
  readonly level: number;
  readonly levelLabel: string;
  readonly logger: string;
  readonly message: string;
} {
  return {
    timestamp: '2026-03-02T12:00:00.000Z',
    level: 30,
    levelLabel: 'INFO',
    logger: 'server',
    message: 'test message',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  LogStreamService._reset();
});

describe('LogStreamService', () => {
  describe('query', () => {
    it('returns empty result when no entries', () => {
      const result = LogStreamService.query();
      expect(result.entries).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('returns entries in newest-first order', () => {
      LogStreamService._addEntry(makeEntry({ message: 'first' }));
      LogStreamService._addEntry(makeEntry({ message: 'second' }));

      const result = LogStreamService.query();

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]!.message).toBe('second');
      expect(result.entries[1]!.message).toBe('first');
    });

    it('filters by minimum level', () => {
      LogStreamService._addEntry(makeEntry({ level: 20, levelLabel: 'DEBUG', message: 'debug' }));
      LogStreamService._addEntry(makeEntry({ level: 30, levelLabel: 'INFO', message: 'info' }));
      LogStreamService._addEntry(makeEntry({ level: 50, levelLabel: 'ERROR', message: 'error' }));

      const result = LogStreamService.query({ level: 30 });

      expect(result.entries.map((e) => e.message)).toEqual(['error', 'info']);
    });

    it('filters by search text (case-insensitive)', () => {
      LogStreamService._addEntry(makeEntry({ message: 'Channel started' }));
      LogStreamService._addEntry(makeEntry({ message: 'Server booted' }));

      const result = LogStreamService.query({ search: 'CHANNEL' });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.message).toBe('Channel started');
    });

    it('paginates with offset and limit', () => {
      for (let i = 0; i < 10; i++) {
        LogStreamService._addEntry(makeEntry({ message: `msg-${String(i)}` }));
      }

      const result = LogStreamService.query({ offset: 2, limit: 3 });

      expect(result.entries).toHaveLength(3);
      expect(result.total).toBe(10);
      // Newest first, so offset 2 starts at msg-7.
      expect(result.entries[0]!.message).toBe('msg-7');
    });

    it('combines level and search filters', () => {
      LogStreamService._addEntry(makeEntry({ level: 30, message: 'Channel info' }));
      LogStreamService._addEntry(makeEntry({ level: 50, message: 'Channel error' }));
      LogStreamService._addEntry(makeEntry({ level: 50, message: 'Server error' }));

      const result = LogStreamService.query({ level: 50, search: 'channel' });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.message).toBe('Channel error');
    });
  });

  describe('ring buffer', () => {
    it('wraps around when exceeding max entries', () => {
      /** What docs/user/capabilities.md says the log viewer keeps. */
      const cap = 10_000;
      const extra = 25;
      for (let i = 0; i < cap + extra; i++) {
        LogStreamService._addEntry(makeEntry({ message: `msg-${String(i)}` }));
      }

      expect(LogStreamService.getBufferSize()).toBe(cap);
      const result = LogStreamService.query({ limit: cap + extra });
      expect(result.total).toBe(cap);
      const newestFirst = Array.from({ length: cap }, (_, i) => `msg-${String(cap + extra - 1 - i)}`);
      expect(result.entries.map((e) => e.message)).toEqual(newestFirst);
    });
  });

  describe('createWritableStream', () => {
    const write = (line: string): Promise<void> => new Promise((resolve) => {
      LogStreamService.createWritableStream().write(Buffer.from(`${line}\n`), 'utf-8', () => { resolve(); });
    });

    it('parses JSON log lines and adds entries', async () => {
      await write(JSON.stringify({ level: 30, msg: 'test log', time: Date.UTC(2026, 2, 2, 12), name: 'api' }));

      expect(LogStreamService.query().entries).toEqual([
        { timestamp: '2026-03-02T12:00:00.000Z', level: 30, levelLabel: 'INFO', logger: 'api', message: 'test log' },
      ]);
    });

    it('emits to Socket.IO logs room', async () => {
      await write(JSON.stringify({ level: 50, msg: 'error log', time: Date.now() }));

      expect(emitToRoom).toHaveBeenCalledWith('logs', 'server:log', expect.objectContaining({ message: 'error log', level: 50 }));
    });

    it('ignores non-JSON lines', async () => {
      await write('not json');

      expect(LogStreamService.query().entries).toHaveLength(0);
    });

    it('handles empty lines gracefully', async () => {
      await write('');

      expect(LogStreamService.query().entries).toHaveLength(0);
    });
  });
});
