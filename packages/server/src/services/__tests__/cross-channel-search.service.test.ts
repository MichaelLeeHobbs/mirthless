// ===========================================
// Cross-Channel Search Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB
vi.mock('../../lib/db.js', () => ({
  db: {
    select: vi.fn(),
  },
}));

import { CrossChannelSearchService } from '../cross-channel-search.service.js';
import { db } from '../../lib/db.js';

const mockSelect = vi.mocked(db.select);

// ----- Helpers -----

/**
 * Build a complete mock chain for the two db.select() calls in search():
 * 1. Count query: select().from().leftJoin().where/then → [{total: N}]
 * 2. Data query: select().from().leftJoin().leftJoin().orderBy().limit().offset().where/then → rows
 */
function setupMocks(countResult: unknown[], dataResult: unknown[]): void {
  let callIndex = 0;

  mockSelect.mockImplementation(() => {
    const current = callIndex++;

    if (current === 0) {
      // Count query chain
      const terminal = Object.assign(Promise.resolve(countResult), {
        where: vi.fn().mockResolvedValue(countResult),
      });
      const leftJoin1 = vi.fn().mockReturnValue(terminal);
      const from = vi.fn().mockReturnValue({ leftJoin: leftJoin1 });
      return { from } as never;
    }

    // Data query chain
    const offsetFn = vi.fn().mockImplementation(function(this: unknown) {
      return Object.assign(Promise.resolve(dataResult), {
        where: vi.fn().mockResolvedValue(dataResult),
      });
    });
    const limitFn = vi.fn().mockReturnValue({ offset: offsetFn });
    const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
    const terminal2 = Object.assign(Promise.resolve(dataResult), {
      where: vi.fn().mockReturnValue({ orderBy: orderByFn }),
      orderBy: orderByFn,
    });
    const leftJoin2 = vi.fn().mockReturnValue(terminal2);
    const leftJoin1 = vi.fn().mockReturnValue({ leftJoin: leftJoin2 });
    const from = vi.fn().mockReturnValue({ leftJoin: leftJoin1 });
    return { from } as never;
  });
}

// ----- Setup -----

beforeEach(() => {
  mockSelect.mockReset();
});

// ----- search -----

describe('CrossChannelSearchService.search', () => {
  it('returns search results with default filters', async () => {
    setupMocks(
      [{ total: 2 }],
      [
        {
          messageId: 1, channelId: 'ch-001', channelName: 'Test Channel',
          receivedAt: new Date('2026-01-01'), processed: true,
          status: 'SENT', connectorName: 'Source',
        },
        {
          messageId: 2, channelId: 'ch-002', channelName: 'Other Channel',
          receivedAt: new Date('2026-01-02'), processed: false,
          status: 'RECEIVED', connectorName: 'Source',
        },
      ],
    );

    const result = await CrossChannelSearchService.search({ limit: 25, offset: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(2);
      expect(result.value.total).toBe(2);
      expect(result.value.limit).toBe(25);
      expect(result.value.offset).toBe(0);
    }
  });

  it('returns empty results when no messages found', async () => {
    setupMocks([{ total: 0 }], []);

    const result = await CrossChannelSearchService.search({ limit: 25, offset: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(0);
      expect(result.value.total).toBe(0);
    }
  });

  it('passes limit and offset correctly', async () => {
    setupMocks([{ total: 100 }], []);

    const result = await CrossChannelSearchService.search({ limit: 10, offset: 20 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.limit).toBe(10);
      expect(result.value.offset).toBe(20);
    }
  });

  it('handles null status and connectorName', async () => {
    setupMocks(
      [{ total: 1 }],
      [{
        messageId: 1, channelId: 'ch-001', channelName: 'Test',
        receivedAt: new Date(), processed: false,
        status: null, connectorName: null,
      }],
    );

    const result = await CrossChannelSearchService.search({ limit: 25, offset: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items[0]?.status).toBeNull();
      expect(result.value.items[0]?.connectorName).toBeNull();
    }
  });

  it('returns error on DB failure', async () => {
    mockSelect.mockImplementation(() => {
      return {
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue(
            Object.assign(Promise.reject(new Error('Connection lost')), {
              where: vi.fn().mockRejectedValue(new Error('Connection lost')),
            }),
          ),
        }),
      } as never;
    });

    const result = await CrossChannelSearchService.search({ limit: 25, offset: 0 });

    expect(result.ok).toBe(false);
  });
});
