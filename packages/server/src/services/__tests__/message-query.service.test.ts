// ===========================================
// Message Query Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock DB -----

let selectCallIndex = 0;
let selectResponses: (() => unknown)[] = [];

function resetSelectState(): void {
  selectCallIndex = 0;
  selectResponses = [];
}

function pushSelectResponse(value: unknown): void {
  selectResponses.push(() => value);
}

const mockSelectWhere = vi.fn().mockImplementation(() => {
  const fn = selectResponses[selectCallIndex];
  selectCallIndex++;
  if (fn) return fn();
  return [];
});

const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

const mockExecute = vi.fn();

const mockDb = {
  select: mockSelect,
  delete: mockDelete,
  execute: mockExecute,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  inArray: vi.fn((_col: unknown, vals: unknown[]) => ({ type: 'inArray', vals })),
  desc: vi.fn((_col: unknown) => ({ type: 'desc' })),
  asc: vi.fn((_col: unknown) => ({ type: 'asc' })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, type: 'sql' }),
    {
      raw: (s: string) => ({ raw: s }),
      join: (items: unknown[], sep: unknown) => ({ items, sep, type: 'sql_join' }),
    },
  ),
}));

// Must import after mocks
const { MessageQueryService } = await import('../message-query.service.js');

// ----- Fixtures -----

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const MESSAGE_ID = 42;
const NOW = new Date('2026-02-28T12:00:00Z');

function makeMessageRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: MESSAGE_ID,
    received_at: NOW.toISOString(),
    processed: true,
    ...overrides,
  };
}

function makeConnectorRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    messageId: MESSAGE_ID,
    metaDataId: 0,
    connectorName: 'Source',
    status: 'SENT',
    sendAttempts: 0,
    ...overrides,
  };
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
  resetSelectState();
  mockExecute.mockResolvedValue({ rows: [] });
  mockDeleteWhere.mockResolvedValue(undefined);
});

// ----- Tests -----

describe('MessageQueryService', () => {
  // ========== SEARCH MESSAGES ==========
  describe('searchMessages', () => {
    it('returns paginated results with default filters', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ count: '3' }] }) // count query
        .mockResolvedValueOnce({ rows: [makeMessageRow({ id: 1 }), makeMessageRow({ id: 2 })] }); // message rows

      // Connector messages for returned message IDs
      pushSelectResponse([
        makeConnectorRow({ messageId: 1 }),
        makeConnectorRow({ messageId: 2 }),
      ]);

      const result = await MessageQueryService.searchMessages(CHANNEL_ID, {
        limit: 25,
        offset: 0,
        sort: 'receivedAt',
        sortDir: 'desc',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.total).toBe(3);
      expect(result.value.items).toHaveLength(2);
      expect(result.value.limit).toBe(25);
      expect(result.value.offset).toBe(0);
    });

    it('returns empty results when no messages match', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await MessageQueryService.searchMessages(CHANNEL_ID, {
        limit: 25,
        offset: 0,
        sort: 'receivedAt',
        sortDir: 'desc',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.total).toBe(0);
      expect(result.value.items).toHaveLength(0);
    });

    it('applies status filter', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [makeMessageRow()] });
      pushSelectResponse([makeConnectorRow()]);

      const result = await MessageQueryService.searchMessages(CHANNEL_ID, {
        status: ['SENT', 'ERROR'],
        limit: 25,
        offset: 0,
        sort: 'receivedAt',
        sortDir: 'desc',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(1);
    });

    it('applies date range filter', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [makeMessageRow()] });
      pushSelectResponse([makeConnectorRow()]);

      const result = await MessageQueryService.searchMessages(CHANNEL_ID, {
        receivedFrom: new Date('2026-02-28T00:00:00Z'),
        receivedTo: new Date('2026-02-28T23:59:59Z'),
        limit: 25,
        offset: 0,
        sort: 'receivedAt',
        sortDir: 'desc',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(1);
    });

    it('applies metaDataId filter', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [makeMessageRow()] });
      pushSelectResponse([makeConnectorRow({ metaDataId: 1 })]);

      const result = await MessageQueryService.searchMessages(CHANNEL_ID, {
        metaDataId: 1,
        limit: 25,
        offset: 0,
        sort: 'receivedAt',
        sortDir: 'desc',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(1);
    });

    it('applies content search filter', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [makeMessageRow()] });
      pushSelectResponse([makeConnectorRow()]);

      const result = await MessageQueryService.searchMessages(CHANNEL_ID, {
        contentSearch: 'ADT',
        limit: 25,
        offset: 0,
        sort: 'receivedAt',
        sortDir: 'desc',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(1);
    });

    it('handles pagination offset', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ count: '50' }] })
        .mockResolvedValueOnce({ rows: [makeMessageRow({ id: 26 })] });
      pushSelectResponse([makeConnectorRow({ messageId: 26 })]);

      const result = await MessageQueryService.searchMessages(CHANNEL_ID, {
        limit: 25,
        offset: 25,
        sort: 'receivedAt',
        sortDir: 'desc',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.offset).toBe(25);
      expect(result.value.total).toBe(50);
    });

    it('sorts ascending by messageId', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({ rows: [makeMessageRow({ id: 1 }), makeMessageRow({ id: 2 })] });
      pushSelectResponse([
        makeConnectorRow({ messageId: 1 }),
        makeConnectorRow({ messageId: 2 }),
      ]);

      const result = await MessageQueryService.searchMessages(CHANNEL_ID, {
        limit: 25,
        offset: 0,
        sort: 'messageId',
        sortDir: 'asc',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items[0]!.messageId).toBe(1);
    });

    it('returns error on DB failure', async () => {
      mockExecute.mockRejectedValue(new Error('DB error'));

      const result = await MessageQueryService.searchMessages(CHANNEL_ID, {
        limit: 25,
        offset: 0,
        sort: 'receivedAt',
        sortDir: 'desc',
      });

      expect(result.ok).toBe(false);
    });
  });

  // ========== GET MESSAGE DETAIL ==========
  describe('getMessageDetail', () => {
    it('returns message with all content grouped by connector', async () => {
      // 1: message row, 2: connector rows, 3: content rows
      pushSelectResponse([{
        id: MESSAGE_ID,
        channelId: CHANNEL_ID,
        receivedAt: NOW,
        processed: true,
        serverId: 'server-01',
      }]);
      pushSelectResponse([
        { metaDataId: 0, connectorName: 'Source', status: 'SENT', sendAttempts: 0 },
        { metaDataId: 1, connectorName: 'Lab Dest', status: 'SENT', sendAttempts: 1 },
      ]);
      pushSelectResponse([
        { metaDataId: 0, contentType: 1, content: 'MSH|raw' },
        { metaDataId: 0, contentType: 3, content: 'MSH|transformed' },
        { metaDataId: 1, contentType: 5, content: 'MSH|sent' },
        { metaDataId: 1, contentType: 6, content: 'MSA|AA' },
      ]);

      const result = await MessageQueryService.getMessageDetail(CHANNEL_ID, MESSAGE_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.messageId).toBe(MESSAGE_ID);
      expect(result.value.processed).toBe(true);
      expect(result.value.serverId).toBe('server-01');
      expect(result.value.connectors).toHaveLength(2);
      expect(result.value.connectors[0]!.content).toHaveProperty('raw', 'MSH|raw');
      expect(result.value.connectors[0]!.content).toHaveProperty('transformed', 'MSH|transformed');
      expect(result.value.connectors[1]!.content).toHaveProperty('sent', 'MSH|sent');
      expect(result.value.connectors[1]!.content).toHaveProperty('response', 'MSA|AA');
    });

    it('returns NOT_FOUND when message does not exist', async () => {
      pushSelectResponse([]);

      const result = await MessageQueryService.getMessageDetail(CHANNEL_ID, 99999);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('returns message with empty content when no content stored', async () => {
      pushSelectResponse([{
        id: MESSAGE_ID,
        channelId: CHANNEL_ID,
        receivedAt: NOW,
        processed: false,
        serverId: 'server-01',
      }]);
      pushSelectResponse([
        { metaDataId: 0, connectorName: 'Source', status: 'RECEIVED', sendAttempts: 0 },
      ]);
      pushSelectResponse([]); // no content

      const result = await MessageQueryService.getMessageDetail(CHANNEL_ID, MESSAGE_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.connectors[0]!.content).toEqual({});
    });

    it('returns error on DB failure', async () => {
      selectResponses.push(() => {
        throw new Error('DB error');
      });

      const result = await MessageQueryService.getMessageDetail(CHANNEL_ID, MESSAGE_ID);

      expect(result.ok).toBe(false);
    });
  });

  // ========== DELETE MESSAGE ==========
  describe('deleteMessage', () => {
    it('deletes message and all related data', async () => {
      pushSelectResponse([{ id: MESSAGE_ID }]);

      const result = await MessageQueryService.deleteMessage(CHANNEL_ID, MESSAGE_ID);

      expect(result.ok).toBe(true);
      // Verify delete was called 3 times (content, connector_messages, messages)
      expect(mockDelete).toHaveBeenCalledTimes(3);
    });

    it('returns NOT_FOUND when message does not exist', async () => {
      pushSelectResponse([]);

      const result = await MessageQueryService.deleteMessage(CHANNEL_ID, 99999);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('returns error on DB failure', async () => {
      pushSelectResponse([{ id: MESSAGE_ID }]);
      mockDeleteWhere.mockRejectedValueOnce(new Error('DB error'));

      const result = await MessageQueryService.deleteMessage(CHANNEL_ID, MESSAGE_ID);

      expect(result.ok).toBe(false);
    });
  });

  // ========== GET MESSAGE COUNTS ==========
  describe('getMessageCounts', () => {
    it('returns counts for channel', async () => {
      mockExecute.mockResolvedValue({
        rows: [{ total: '100', processed: '95', errored: '3' }],
      });

      const result = await MessageQueryService.getMessageCounts(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.total).toBe(100);
      expect(result.value.processed).toBe(95);
      expect(result.value.errored).toBe(3);
    });

    it('returns zeros when no messages exist', async () => {
      mockExecute.mockResolvedValue({
        rows: [{ total: '0', processed: '0', errored: '0' }],
      });

      const result = await MessageQueryService.getMessageCounts(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.total).toBe(0);
      expect(result.value.processed).toBe(0);
      expect(result.value.errored).toBe(0);
    });

    it('returns error on DB failure', async () => {
      mockExecute.mockRejectedValue(new Error('DB error'));

      const result = await MessageQueryService.getMessageCounts(CHANNEL_ID);

      expect(result.ok).toBe(false);
    });
  });
});
