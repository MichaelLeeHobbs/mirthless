// ===========================================
// Channel Revision Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB
vi.mock('../../lib/db.js', () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
  },
}));

import { ChannelRevisionService } from '../channel-revision.service.js';
import { db } from '../../lib/db.js';

const mockInsert = vi.mocked(db.insert);
const mockSelect = vi.mocked(db.select);

// ----- Helpers -----

function makeRevisionRow(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'rev-001',
    channelId: 'ch-001',
    revision: 1,
    userId: 'user-001',
    snapshot: { name: 'Test Channel' },
    comment: 'Initial version',
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ----- Setup -----

beforeEach(() => {
  mockInsert.mockReset();
  mockSelect.mockReset();
});

// ----- saveRevision -----

describe('ChannelRevisionService.saveRevision', () => {
  it('saves a revision and returns summary', async () => {
    const row = makeRevisionRow();
    const mockReturning = vi.fn().mockResolvedValue([row]);
    const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues } as never);

    const result = await ChannelRevisionService.saveRevision(
      'ch-001', 1, { name: 'Test Channel' }, 'user-001', 'Initial version',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.channelId).toBe('ch-001');
      expect(result.value.revision).toBe(1);
      expect(result.value.userId).toBe('user-001');
      expect(result.value.comment).toBe('Initial version');
    }
  });

  it('saves revision with null userId and comment', async () => {
    const row = makeRevisionRow({ userId: null, comment: null });
    const mockReturning = vi.fn().mockResolvedValue([row]);
    const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues } as never);

    const result = await ChannelRevisionService.saveRevision(
      'ch-001', 2, { name: 'Channel' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userId).toBeNull();
      expect(result.value.comment).toBeNull();
    }
  });

  it('returns error when insert fails', async () => {
    const mockValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockRejectedValue(new Error('DB error')),
    });
    mockInsert.mockReturnValue({ values: mockValues } as never);

    const result = await ChannelRevisionService.saveRevision(
      'ch-001', 1, { name: 'Test' },
    );

    expect(result.ok).toBe(false);
  });
});

// ----- listRevisions -----

describe('ChannelRevisionService.listRevisions', () => {
  it('returns revisions newest first', async () => {
    const rows = [
      makeRevisionRow({ revision: 3 }),
      makeRevisionRow({ revision: 2 }),
      makeRevisionRow({ revision: 1 }),
    ];
    const mockOrderBy = vi.fn().mockResolvedValue(rows);
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await ChannelRevisionService.listRevisions('ch-001');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
    }
  });

  it('returns empty array when no revisions exist', async () => {
    const mockOrderBy = vi.fn().mockResolvedValue([]);
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await ChannelRevisionService.listRevisions('ch-001');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it('returns error on DB failure', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockRejectedValue(new Error('Connection lost')),
      }),
    });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await ChannelRevisionService.listRevisions('ch-001');

    expect(result.ok).toBe(false);
  });
});

// ----- getRevision -----

describe('ChannelRevisionService.getRevision', () => {
  it('returns revision detail for valid channel and revision', async () => {
    const row = makeRevisionRow();
    const mockWhere = vi.fn().mockResolvedValue([row]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await ChannelRevisionService.getRevision('ch-001', 1);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.revision).toBe(1);
      expect(result.value.snapshot).toEqual({ name: 'Test Channel' });
    }
  });

  it('returns NOT_FOUND when revision does not exist', async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await ChannelRevisionService.getRevision('ch-001', 999);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    }
  });

  it('returns error on DB failure', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockRejectedValue(new Error('Timeout')),
    });
    mockSelect.mockReturnValue({ from: mockFrom } as never);

    const result = await ChannelRevisionService.getRevision('ch-001', 1);

    expect(result.ok).toBe(false);
  });
});
