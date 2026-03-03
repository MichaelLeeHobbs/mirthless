// ===========================================
// Attachment Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock DB -----

let selectCallIndex = 0;
let selectResponses: (() => unknown)[] = [];

function resetSelectState(): void {
  selectCallIndex = 0;
  selectResponses = [];
}

function pushResponse(value: unknown): void {
  selectResponses.push(() => value);
}

const mockSelectWhere = vi.fn().mockImplementation(() => {
  const fn = selectResponses[selectCallIndex];
  selectCallIndex++;
  if (fn) return fn();
  return [];
});

const mockSelectFrom = vi.fn().mockImplementation(() => ({
  where: mockSelectWhere,
}));

const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockDb = {
  select: mockSelect,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
}));

const { AttachmentService } = await import('../attachment.service.js');

// ----- Fixtures -----

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const MESSAGE_ID = 1;

function makeSummary(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: 'att-1',
    segmentId: 0,
    mimeType: 'text/plain',
    attachmentSize: 1024,
    isEncrypted: false,
    ...overrides,
  };
}

function makeDetail(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    ...makeSummary(),
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    content: 'attachment content',
    ...overrides,
  };
}

// ----- Tests -----

beforeEach(() => {
  resetSelectState();
  vi.clearAllMocks();
});

describe('AttachmentService', () => {
  describe('listByMessage', () => {
    it('returns attachment summaries for a message', async () => {
      const attachments = [
        makeSummary({ id: 'att-1' }),
        makeSummary({ id: 'att-2' }),
      ];
      pushResponse(attachments);

      const result = await AttachmentService.listByMessage(CHANNEL_ID, MESSAGE_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
    });

    it('returns empty array when no attachments', async () => {
      pushResponse([]);

      const result = await AttachmentService.listByMessage(CHANNEL_ID, MESSAGE_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it('filters by channelId and messageId', async () => {
      pushResponse([]);

      await AttachmentService.listByMessage(CHANNEL_ID, MESSAGE_ID);

      expect(mockSelectWhere).toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('returns attachment detail when found', async () => {
      pushResponse([makeDetail()]);

      const result = await AttachmentService.getById(CHANNEL_ID, MESSAGE_ID, 'att-1');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe('att-1');
      expect(result.value.content).toBe('attachment content');
    });

    it('returns NOT_FOUND for missing attachment', async () => {
      pushResponse([]);

      const result = await AttachmentService.getById(CHANNEL_ID, MESSAGE_ID, 'missing');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });

    it('includes mimeType in response', async () => {
      pushResponse([makeDetail({ mimeType: 'application/pdf' })]);

      const result = await AttachmentService.getById(CHANNEL_ID, MESSAGE_ID, 'att-1');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.mimeType).toBe('application/pdf');
    });

    it('includes encrypted flag in response', async () => {
      pushResponse([makeDetail({ isEncrypted: true })]);

      const result = await AttachmentService.getById(CHANNEL_ID, MESSAGE_ID, 'att-1');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.isEncrypted).toBe(true);
    });
  });
});
