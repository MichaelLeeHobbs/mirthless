// ===========================================
// Message Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock DB -----

const mockInsertReturning = vi.fn();
const mockInsertValues = vi.fn().mockImplementation(() => ({
  returning: mockInsertReturning,
}));
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

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

const mockExecute = vi.fn();

const mockDb = {
  insert: mockInsert,
  update: mockUpdate,
  select: mockSelect,
  execute: mockExecute,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, type: 'sql' }),
    { raw: (s: string) => ({ raw: s }) },
  ),
}));

// Must import after mocks
const { MessageService } = await import('../message.service.js');

// ----- Fixtures -----

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const SERVER_ID = 'server-01';
const MESSAGE_ID = 42;

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
  resetSelectState();
  mockInsertValues.mockImplementation(() => ({
    returning: mockInsertReturning,
  }));
  mockInsertReturning.mockResolvedValue([{ messageId: MESSAGE_ID }]);
  mockSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockResolvedValue(undefined);
  mockExecute.mockResolvedValue([]);
});

// ----- Tests -----

describe('MessageService', () => {
  // ========== CREATE MESSAGE ==========
  describe('createMessage', () => {
    it('creates a message and returns the generated ID', async () => {
      mockInsertReturning.mockResolvedValue([{ messageId: 1 }]);

      const result = await MessageService.createMessage(CHANNEL_ID, SERVER_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.messageId).toBe(1);
      expect(mockInsert).toHaveBeenCalled();
    });

    it('returns error on DB failure', async () => {
      mockInsertReturning.mockRejectedValue(new Error('DB connection failed'));

      const result = await MessageService.createMessage(CHANNEL_ID, SERVER_ID);

      expect(result.ok).toBe(false);
    });
  });

  // ========== CREATE CONNECTOR MESSAGE ==========
  describe('createConnectorMessage', () => {
    it('creates source connector message (metaDataId=0)', async () => {
      mockInsertValues.mockResolvedValue(undefined);

      const result = await MessageService.createConnectorMessage(
        CHANNEL_ID, MESSAGE_ID, 0, 'Source', 'RECEIVED',
      );

      expect(result.ok).toBe(true);
      expect(mockInsert).toHaveBeenCalled();
    });

    it('creates destination connector message (metaDataId=1)', async () => {
      mockInsertValues.mockResolvedValue(undefined);

      const result = await MessageService.createConnectorMessage(
        CHANNEL_ID, MESSAGE_ID, 1, 'Dest 1', 'RECEIVED',
      );

      expect(result.ok).toBe(true);
    });

    it('returns error on DB failure', async () => {
      mockInsertValues.mockRejectedValue(new Error('Constraint violation'));

      const result = await MessageService.createConnectorMessage(
        CHANNEL_ID, MESSAGE_ID, 0, 'Source', 'RECEIVED',
      );

      expect(result.ok).toBe(false);
    });
  });

  // ========== UPDATE CONNECTOR MESSAGE STATUS ==========
  describe('updateConnectorMessageStatus', () => {
    it('updates status to TRANSFORMED', async () => {
      const result = await MessageService.updateConnectorMessageStatus(
        CHANNEL_ID, MESSAGE_ID, 0, 'TRANSFORMED',
      );

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('sets sendDate when status is SENT', async () => {
      const result = await MessageService.updateConnectorMessageStatus(
        CHANNEL_ID, MESSAGE_ID, 0, 'SENT',
      );

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SENT', sendDate: expect.any(Date) }),
      );
    });

    it('sets errorCode when provided', async () => {
      const result = await MessageService.updateConnectorMessageStatus(
        CHANNEL_ID, MESSAGE_ID, 0, 'ERROR', 500,
      );

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ERROR', errorCode: 500 }),
      );
    });

    it('returns error on DB failure', async () => {
      mockUpdateWhere.mockRejectedValue(new Error('DB timeout'));

      const result = await MessageService.updateConnectorMessageStatus(
        CHANNEL_ID, MESSAGE_ID, 0, 'ERROR',
      );

      expect(result.ok).toBe(false);
    });
  });

  // ========== STORE CONTENT ==========
  describe('storeContent', () => {
    it('stores RAW content', async () => {
      mockInsertValues.mockResolvedValue(undefined);

      const result = await MessageService.storeContent(
        CHANNEL_ID, MESSAGE_ID, 0, 1, 'MSH|^~\\&|...', 'HL7V2',
      );

      expect(result.ok).toBe(true);
      expect(mockInsert).toHaveBeenCalled();
    });

    it('stores content with encryption flag', async () => {
      mockInsertValues.mockResolvedValue(undefined);

      const result = await MessageService.storeContent(
        CHANNEL_ID, MESSAGE_ID, 0, 1, 'encrypted-data', 'HL7V2', true,
      );

      expect(result.ok).toBe(true);
    });

    it('stores RESPONSE content for destination', async () => {
      mockInsertValues.mockResolvedValue(undefined);

      const result = await MessageService.storeContent(
        CHANNEL_ID, MESSAGE_ID, 1, 6, 'MSA|AA|12345', 'HL7V2',
      );

      expect(result.ok).toBe(true);
    });

    it('returns error on DB failure', async () => {
      mockInsertValues.mockRejectedValue(new Error('Disk full'));

      const result = await MessageService.storeContent(
        CHANNEL_ID, MESSAGE_ID, 0, 1, 'data', 'HL7V2',
      );

      expect(result.ok).toBe(false);
    });
  });

  // ========== MARK PROCESSED ==========
  describe('markProcessed', () => {
    it('marks message as processed', async () => {
      const result = await MessageService.markProcessed(CHANNEL_ID, MESSAGE_ID);

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith({ processed: true });
    });

    it('returns error on DB failure', async () => {
      mockUpdateWhere.mockRejectedValue(new Error('DB error'));

      const result = await MessageService.markProcessed(CHANNEL_ID, MESSAGE_ID);

      expect(result.ok).toBe(false);
    });
  });

  // ========== ENQUEUE ==========
  describe('enqueue', () => {
    it('sets connector message status to QUEUED', async () => {
      const result = await MessageService.enqueue(CHANNEL_ID, MESSAGE_ID, 1);

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith({ status: 'QUEUED' });
    });

    it('returns error on DB failure', async () => {
      mockUpdateWhere.mockRejectedValue(new Error('DB error'));

      const result = await MessageService.enqueue(CHANNEL_ID, MESSAGE_ID, 1);

      expect(result.ok).toBe(false);
    });
  });

  // ========== DEQUEUE ==========
  describe('dequeue', () => {
    it('returns queued messages using FOR UPDATE SKIP LOCKED', async () => {
      const queuedRow = {
        channelId: CHANNEL_ID,
        messageId: 10,
        metaDataId: 1,
        status: 'QUEUED',
        connectorName: 'Dest 1',
        sendAttempts: 0,
        errorCode: 0,
      };
      mockExecute.mockResolvedValue({ rows: [queuedRow] });

      const result = await MessageService.dequeue(CHANNEL_ID, 1, 5);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toEqual(queuedRow);
      expect(mockExecute).toHaveBeenCalled();
    });

    it('returns empty array when no queued messages', async () => {
      mockExecute.mockResolvedValue({ rows: [] });

      const result = await MessageService.dequeue(CHANNEL_ID, 1, 5);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it('returns error on DB failure', async () => {
      mockExecute.mockRejectedValue(new Error('Lock timeout'));

      const result = await MessageService.dequeue(CHANNEL_ID, 1, 5);

      expect(result.ok).toBe(false);
    });
  });

  // ========== RELEASE ==========
  describe('release', () => {
    it('releases message with SENT status and sendDate', async () => {
      const result = await MessageService.release(CHANNEL_ID, MESSAGE_ID, 1, 'SENT');

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SENT', sendDate: expect.any(Date) }),
      );
    });

    it('releases message with ERROR status', async () => {
      const result = await MessageService.release(CHANNEL_ID, MESSAGE_ID, 1, 'ERROR');

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith({ status: 'ERROR' });
    });

    it('returns error on DB failure', async () => {
      mockUpdateWhere.mockRejectedValue(new Error('DB error'));

      const result = await MessageService.release(CHANNEL_ID, MESSAGE_ID, 1, 'SENT');

      expect(result.ok).toBe(false);
    });
  });

  // ========== INCREMENT STATS ==========
  describe('incrementStats', () => {
    it('increments received counter via upsert', async () => {
      const result = await MessageService.incrementStats(
        CHANNEL_ID, 0, SERVER_ID, 'received',
      );

      expect(result.ok).toBe(true);
      expect(mockExecute).toHaveBeenCalled();
    });

    it('increments sent counter', async () => {
      const result = await MessageService.incrementStats(
        CHANNEL_ID, 1, SERVER_ID, 'sent',
      );

      expect(result.ok).toBe(true);
    });

    it('increments errored counter', async () => {
      const result = await MessageService.incrementStats(
        CHANNEL_ID, 1, SERVER_ID, 'errored',
      );

      expect(result.ok).toBe(true);
    });

    it('returns error on DB failure', async () => {
      mockExecute.mockRejectedValue(new Error('DB error'));

      const result = await MessageService.incrementStats(
        CHANNEL_ID, 0, SERVER_ID, 'received',
      );

      expect(result.ok).toBe(false);
    });
  });

  // ========== GET STATS ==========
  describe('getStats', () => {
    it('returns statistics for channel', async () => {
      const statsRow = {
        channelId: CHANNEL_ID,
        metaDataId: 0,
        serverId: SERVER_ID,
        received: 10,
        filtered: 2,
        sent: 8,
        errored: 0,
        receivedLifetime: 100,
        filteredLifetime: 20,
        sentLifetime: 80,
        erroredLifetime: 0,
      };
      pushSelectResponse([statsRow]);

      const result = await MessageService.getStats(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.channelId).toBe(CHANNEL_ID);
      expect(result.value.entries).toHaveLength(1);
      expect(result.value.entries[0]).toEqual(statsRow);
    });

    it('returns empty entries when no stats exist', async () => {
      pushSelectResponse([]);

      const result = await MessageService.getStats(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.entries).toHaveLength(0);
    });

    it('returns error on DB failure', async () => {
      selectResponses.push(() => {
        throw new Error('DB error');
      });

      const result = await MessageService.getStats(CHANNEL_ID);

      expect(result.ok).toBe(false);
    });
  });

  // ========== GET UNPROCESSED MESSAGES ==========
  describe('getUnprocessedMessages', () => {
    it('returns unprocessed messages for recovery', async () => {
      const msgRow = {
        id: 1,
        channelId: CHANNEL_ID,
        serverId: SERVER_ID,
        receivedAt: new Date(),
        processed: false,
      };
      pushSelectResponse([msgRow]);

      const result = await MessageService.getUnprocessedMessages(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toEqual(msgRow);
    });

    it('returns empty array when all messages processed', async () => {
      pushSelectResponse([]);

      const result = await MessageService.getUnprocessedMessages(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it('returns error on DB failure', async () => {
      selectResponses.push(() => {
        throw new Error('DB error');
      });

      const result = await MessageService.getUnprocessedMessages(CHANNEL_ID);

      expect(result.ok).toBe(false);
    });
  });

  // ========== GET QUEUED MESSAGES ==========
  describe('getQueuedMessages', () => {
    it('returns queued connector messages for a destination', async () => {
      const queuedRow = {
        channelId: CHANNEL_ID,
        messageId: 5,
        metaDataId: 1,
        status: 'QUEUED',
        connectorName: 'Dest 1',
      };
      pushSelectResponse([queuedRow]);

      const result = await MessageService.getQueuedMessages(CHANNEL_ID, 1);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toEqual(queuedRow);
    });

    it('returns empty array when no queued messages', async () => {
      pushSelectResponse([]);

      const result = await MessageService.getQueuedMessages(CHANNEL_ID, 1);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it('returns error on DB failure', async () => {
      selectResponses.push(() => {
        throw new Error('DB error');
      });

      const result = await MessageService.getQueuedMessages(CHANNEL_ID, 1);

      expect(result.ok).toBe(false);
    });
  });
});
