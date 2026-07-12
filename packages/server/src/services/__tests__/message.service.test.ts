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

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

const mockDb = {
  insert: mockInsert,
  update: mockUpdate,
  select: mockSelect,
  execute: mockExecute,
  delete: mockDelete,
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
    {
      raw: (s: string) => ({ raw: s, type: 'sql_raw' }),
      join: (arr: unknown[], sep: unknown) => ({ type: 'sql_join', arr, sep }),
    },
  ),
}));

/** Flatten a mocked drizzle sql node tree back to approximate SQL text for assertions. */
function renderSql(node: unknown): string {
  if (node == null) return '';
  if (typeof node !== 'object') return String(node);
  const n = node as Record<string, unknown>;
  if (n['type'] === 'sql') {
    const strings = n['strings'] as readonly string[];
    const values = n['values'] as readonly unknown[];
    let out = '';
    for (let i = 0; i < strings.length; i++) {
      out += strings[i];
      if (i < values.length) out += renderSql(values[i]);
    }
    return out;
  }
  if (n['type'] === 'sql_join') {
    const arr = n['arr'] as readonly unknown[];
    return arr.map(renderSql).join(renderSql(n['sep']));
  }
  if (n['type'] === 'sql_raw') return String(n['raw']);
  return '?';
}

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
  mockDelete.mockReturnValue({ where: mockDeleteWhere });
  mockDeleteWhere.mockResolvedValue(undefined);
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
      expect(mockSet).toHaveBeenCalledWith({ processed: true, processedAt: expect.any(Date) });
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

  // ========== DELETE CONTENT ==========
  describe('deleteContent', () => {
    it('deletes all content for a message', async () => {
      const result = await MessageService.deleteContent(CHANNEL_ID, MESSAGE_ID);

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns error on DB failure', async () => {
      mockDeleteWhere.mockRejectedValue(new Error('DB error'));

      const result = await MessageService.deleteContent(CHANNEL_ID, MESSAGE_ID);

      expect(result.ok).toBe(false);
    });
  });

  // ========== DELETE ATTACHMENTS ==========
  describe('deleteAttachments', () => {
    it('deletes all attachments for a message', async () => {
      const result = await MessageService.deleteAttachments(CHANNEL_ID, MESSAGE_ID);

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns error on DB failure', async () => {
      mockDeleteWhere.mockRejectedValue(new Error('DB error'));

      const result = await MessageService.deleteAttachments(CHANNEL_ID, MESSAGE_ID);

      expect(result.ok).toBe(false);
    });
  });

  // ========== INITIALIZE MESSAGE (storage-mode loss + currval bug) ==========
  describe('initializeMessage', () => {
    it('persists the message even when no content rows are provided (PRODUCTION/METADATA/DISABLED)', async () => {
      mockExecute.mockResolvedValue({ rows: [{ message_id: 7, correlation_id: 'corr-7' }] });

      const result = await MessageService.initializeMessage(CHANNEL_ID, SERVER_ID, 'Source', []);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.messageId).toBe(7);
      expect(mockExecute).toHaveBeenCalledOnce();
      // No content CTE emitted when there are no content rows.
      const sqlText = renderSql(mockExecute.mock.calls[0]![0]);
      expect(sqlText).toContain('INSERT INTO messages');
      expect(sqlText).toContain('INSERT INTO connector_messages');
      expect(sqlText).not.toContain('INSERT INTO message_content');
    });

    it('inserts content rows bound to the new message id (never currval)', async () => {
      mockExecute.mockResolvedValue({ rows: [{ message_id: 8, correlation_id: 'corr-8' }] });

      const result = await MessageService.initializeMessage(CHANNEL_ID, SERVER_ID, 'Source', [
        { metaDataId: 0, contentType: 1, content: 'RAW', dataType: 'HL7V2' },
        { metaDataId: 0, contentType: 9, content: '{}', dataType: 'JSON' },
      ]);

      expect(result.ok).toBe(true);
      const sqlText = renderSql(mockExecute.mock.calls[0]![0]);
      expect(sqlText).toContain('INSERT INTO message_content');
      // Content message_id is bound to this message via new_msg — NOT currval.
      expect(sqlText).toContain('new_msg.id');
      expect(sqlText).toContain('CROSS JOIN');
      expect(sqlText).not.toContain('currval');
    });

    it('returns error on DB failure', async () => {
      mockExecute.mockRejectedValue(new Error('constraint violation'));

      const result = await MessageService.initializeMessage(CHANNEL_ID, SERVER_ID, 'Source', []);

      expect(result.ok).toBe(false);
    });
  });

  // ========== DEQUEUE atomic claim (double-dispatch) ==========
  describe('dequeue claim semantics', () => {
    it('atomically transitions claimed rows to PENDING via SKIP LOCKED', async () => {
      mockExecute.mockResolvedValue({ rows: [] });

      await MessageService.dequeue(CHANNEL_ID, 1, 5);

      const sqlText = renderSql(mockExecute.mock.calls[0]![0]);
      expect(sqlText).toContain("SET status = 'PENDING'");
      expect(sqlText).toContain('FOR UPDATE SKIP LOCKED');
      // Columns aliased to camelCase so the consumer's QueuedMessage shape matches.
      expect(sqlText).toContain('"messageId"');
      expect(sqlText).toContain('"sendAttempts"');
    });
  });

  // ========== RESET PENDING (crash recovery) ==========
  describe('resetPending', () => {
    it('resets PENDING rows back to QUEUED', async () => {
      const result = await MessageService.resetPending(CHANNEL_ID, 1);

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith({ status: 'QUEUED' });
    });

    it('returns error on DB failure', async () => {
      mockUpdateWhere.mockRejectedValue(new Error('DB error'));

      const result = await MessageService.resetPending(CHANNEL_ID, 1);

      expect(result.ok).toBe(false);
    });
  });

  // ========== QUEUED requeue increments send_attempts (poison-message cap) ==========
  describe('updateConnectorMessageStatus QUEUED increment', () => {
    it('increments send_attempts when transitioning back to QUEUED', async () => {
      const result = await MessageService.updateConnectorMessageStatus(CHANNEL_ID, MESSAGE_ID, 1, 'QUEUED');

      expect(result.ok).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'QUEUED', sendAttempts: expect.anything() }),
      );
    });

    it('does NOT increment send_attempts for non-QUEUED transitions', async () => {
      await MessageService.updateConnectorMessageStatus(CHANNEL_ID, MESSAGE_ID, 1, 'SENT');

      const arg = mockSet.mock.calls[0]![0] as Record<string, unknown>;
      expect(arg).not.toHaveProperty('sendAttempts');
    });
  });
});
