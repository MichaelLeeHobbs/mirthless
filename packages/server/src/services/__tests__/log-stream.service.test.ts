// ===========================================
// Log Stream Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock Dependencies -----

vi.mock('../../lib/socket.js', () => ({
  emitToRoom: vi.fn(),
}));

const { LogStreamService } = await import('../log-stream.service.js');
const { emitToRoom } = await import('../../lib/socket.js');

// ----- Helpers -----

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

// ----- Tests -----

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

      const result = LogStreamService.query({ level: 40 });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.message).toBe('error');
    });

    it('filters by search text (case-insensitive)', () => {
      LogStreamService._addEntry(makeEntry({ message: 'Channel started' }));
      LogStreamService._addEntry(makeEntry({ message: 'Server booted' }));

      const result = LogStreamService.query({ search: 'channel' });

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
      // Newest first: msg-9, msg-8, msg-7, msg-6, msg-5...
      // offset=2: msg-7, msg-6, msg-5
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
      // Add more than MAX_ENTRIES (10,000 by default)
      // We'll test with a smaller number using direct _addEntry
      for (let i = 0; i < 50; i++) {
        LogStreamService._addEntry(makeEntry({ message: `msg-${String(i)}` }));
      }

      expect(LogStreamService.getBufferSize()).toBe(50);
      const result = LogStreamService.query({ limit: 50 });
      expect(result.total).toBe(50);
    });
  });

  describe('createWritableStream', () => {
    it('parses JSON log lines and adds entries', () => {
      return new Promise<void>((resolve) => {
        const stream = LogStreamService.createWritableStream();
        const json = JSON.stringify({ level: 30, msg: 'test log', time: Date.now() });

        stream.write(Buffer.from(json + '\n'), 'utf-8', () => {
          const result = LogStreamService.query();
          expect(result.entries).toHaveLength(1);
          expect(result.entries[0]!.message).toBe('test log');
          expect(result.entries[0]!.level).toBe(30);
          expect(result.entries[0]!.levelLabel).toBe('INFO');
          resolve();
        });
      });
    });

    it('emits to Socket.IO logs room', () => {
      return new Promise<void>((resolve) => {
        const stream = LogStreamService.createWritableStream();
        const json = JSON.stringify({ level: 50, msg: 'error log', time: Date.now() });

        stream.write(Buffer.from(json + '\n'), 'utf-8', () => {
          expect(emitToRoom).toHaveBeenCalledWith('logs', 'server:log', expect.objectContaining({
            message: 'error log',
            level: 50,
          }));
          resolve();
        });
      });
    });

    it('ignores non-JSON lines', () => {
      return new Promise<void>((resolve) => {
        const stream = LogStreamService.createWritableStream();

        stream.write(Buffer.from('not json\n'), 'utf-8', () => {
          const result = LogStreamService.query();
          expect(result.entries).toHaveLength(0);
          resolve();
        });
      });
    });

    it('handles empty lines gracefully', () => {
      return new Promise<void>((resolve) => {
        const stream = LogStreamService.createWritableStream();

        stream.write(Buffer.from('\n'), 'utf-8', () => {
          const result = LogStreamService.query();
          expect(result.entries).toHaveLength(0);
          resolve();
        });
      });
    });
  });
});
