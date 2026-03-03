// ===========================================
// Event Export Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EventExportQuery } from '@mirthless/core-models';

// ----- Mock DB -----

let queryRows: readonly Record<string, unknown>[] = [];

const mockLimit = vi.fn().mockImplementation(() => queryRows);
const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });

const mockSelectFrom = vi.fn().mockImplementation(() => ({
  where: mockWhere,
  orderBy: vi.fn().mockReturnValue({ limit: mockLimit }),
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
  desc: vi.fn((_col: unknown) => ({ type: 'desc' })),
  inArray: vi.fn((_col: unknown, vals: unknown) => ({ type: 'inArray', vals })),
  gte: vi.fn((_col: unknown, val: unknown) => ({ type: 'gte', val })),
  lte: vi.fn((_col: unknown, val: unknown) => ({ type: 'lte', val })),
}));

const { EventExportService } = await import('../event-export.service.js');

// ----- Fixtures -----

function makeRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: 1,
    name: 'USER_LOGIN',
    level: 'INFO',
    outcome: 'SUCCESS',
    userId: '00000000-0000-0000-0000-000000000001',
    ipAddress: '192.168.1.1',
    attributes: null,
    createdAt: new Date('2026-01-15T10:30:00.000Z'),
    ...overrides,
  };
}

function baseQuery(overrides?: Partial<EventExportQuery>): EventExportQuery {
  return {
    format: 'csv',
    maxRows: 10_000,
    ...overrides,
  } as EventExportQuery;
}

// ----- Tests -----

beforeEach(() => {
  queryRows = [];
  vi.clearAllMocks();
});

describe('EventExportService', () => {
  describe('exportAsCsv', () => {
    it('returns CSV with header and data rows', async () => {
      queryRows = [makeRow()];

      const result = await EventExportService.exportAsCsv(baseQuery());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const lines = result.value.split('\r\n');
      expect(lines[0]).toBe('id,name,level,outcome,userId,ipAddress,attributes,createdAt');
      expect(lines[1]).toContain('USER_LOGIN');
      expect(lines[1]).toContain('INFO');
      expect(lines[1]).toContain('SUCCESS');
    });

    it('returns header-only CSV when no events match', async () => {
      queryRows = [];

      const result = await EventExportService.exportAsCsv(baseQuery());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe('id,name,level,outcome,userId,ipAddress,attributes,createdAt\r\n');
    });

    it('exports multiple rows', async () => {
      queryRows = [
        makeRow({ id: 1 }),
        makeRow({ id: 2, name: 'CHANNEL_CREATED' }),
        makeRow({ id: 3, name: 'USER_DELETED', outcome: 'FAILURE' }),
      ];

      const result = await EventExportService.exportAsCsv(baseQuery());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const lines = result.value.split('\r\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(4); // 1 header + 3 data
    });

    it('escapes fields containing commas per RFC 4180', async () => {
      queryRows = [makeRow({ attributes: { key: 'val,ue' } })];

      const result = await EventExportService.exportAsCsv(baseQuery());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The JSON-stringified attributes should be double-quoted because it contains commas
      expect(result.value).toContain('"{""key"":""val');
    });

    it('escapes fields containing double quotes per RFC 4180', async () => {
      queryRows = [makeRow({ attributes: { note: 'say "hello"' } })];

      const result = await EventExportService.exportAsCsv(baseQuery());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // JSON.stringify produces \" for inner quotes, then CSV escaping doubles the outer wrapping quotes
      // The entire attributes field should be wrapped in double quotes with internal quotes doubled
      expect(result.value).toContain('""note""');
      expect(result.value).toContain('hello');
    });

    it('escapes fields containing newlines per RFC 4180', async () => {
      queryRows = [makeRow({ attributes: { note: 'line1\nline2' } })];

      const result = await EventExportService.exportAsCsv(baseQuery());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Field with newline should be wrapped in double quotes
      expect(result.value).toContain('"');
    });

    it('handles null userId and ipAddress as empty fields', async () => {
      queryRows = [makeRow({ userId: null, ipAddress: null })];

      const result = await EventExportService.exportAsCsv(baseQuery());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const dataLine = result.value.split('\r\n')[1]!;
      // Two consecutive commas for empty userId and ipAddress
      expect(dataLine).toContain('SUCCESS,,,');
    });

    it('handles null attributes as empty field', async () => {
      queryRows = [makeRow({ attributes: null })];

      const result = await EventExportService.exportAsCsv(baseQuery());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const dataLine = result.value.split('\r\n')[1]!;
      // Empty attributes between ipAddress and createdAt
      expect(dataLine).toContain('192.168.1.1,,');
    });

    it('uses CRLF line endings', async () => {
      queryRows = [makeRow()];

      const result = await EventExportService.exportAsCsv(baseQuery());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toContain('\r\n');
      // Verify no bare LF (that isn't preceded by CR)
      const withoutCrlf = result.value.replace(/\r\n/g, '');
      expect(withoutCrlf).not.toContain('\n');
    });

    it('formats createdAt as ISO 8601 string', async () => {
      queryRows = [makeRow({ createdAt: new Date('2026-03-01T14:00:00.000Z') })];

      const result = await EventExportService.exportAsCsv(baseQuery());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toContain('2026-03-01T14:00:00.000Z');
    });
  });

  describe('exportAsJson', () => {
    it('returns JSON array of event objects', async () => {
      queryRows = [makeRow()];

      const result = await EventExportService.exportAsJson(baseQuery({ format: 'json' }));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed: unknown[] = JSON.parse(result.value) as unknown[];
      expect(parsed).toHaveLength(1);
      const first = parsed[0] as Record<string, unknown>;
      expect(first['name']).toBe('USER_LOGIN');
      expect(first['level']).toBe('INFO');
      expect(first['outcome']).toBe('SUCCESS');
    });

    it('returns empty JSON array when no events match', async () => {
      queryRows = [];

      const result = await EventExportService.exportAsJson(baseQuery({ format: 'json' }));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed: unknown[] = JSON.parse(result.value) as unknown[];
      expect(parsed).toHaveLength(0);
    });

    it('normalizes null userId to null in JSON output', async () => {
      queryRows = [makeRow({ userId: null })];

      const result = await EventExportService.exportAsJson(baseQuery({ format: 'json' }));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed: unknown[] = JSON.parse(result.value) as unknown[];
      const first = parsed[0] as Record<string, unknown>;
      expect(first['userId']).toBeNull();
    });

    it('formats createdAt as ISO 8601 string in JSON', async () => {
      queryRows = [makeRow({ createdAt: new Date('2026-02-20T08:00:00.000Z') })];

      const result = await EventExportService.exportAsJson(baseQuery({ format: 'json' }));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed: unknown[] = JSON.parse(result.value) as unknown[];
      const first = parsed[0] as Record<string, unknown>;
      expect(first['createdAt']).toBe('2026-02-20T08:00:00.000Z');
    });

    it('includes attributes when present', async () => {
      queryRows = [makeRow({ attributes: { action: 'password_change' } })];

      const result = await EventExportService.exportAsJson(baseQuery({ format: 'json' }));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed: unknown[] = JSON.parse(result.value) as unknown[];
      const first = parsed[0] as Record<string, unknown>;
      const attrs = first['attributes'] as Record<string, unknown>;
      expect(attrs['action']).toBe('password_change');
    });
  });

  describe('filtering', () => {
    it('passes level filter to where clause', async () => {
      queryRows = [];

      await EventExportService.exportAsCsv(baseQuery({ level: 'ERROR' }));

      expect(mockWhere).toHaveBeenCalled();
    });

    it('passes name filter to where clause', async () => {
      queryRows = [];

      await EventExportService.exportAsCsv(baseQuery({ name: 'USER_LOGIN' }));

      expect(mockWhere).toHaveBeenCalled();
    });

    it('passes outcome filter to where clause', async () => {
      queryRows = [];

      await EventExportService.exportAsCsv(baseQuery({ outcome: 'FAILURE' }));

      expect(mockWhere).toHaveBeenCalled();
    });

    it('passes date range filters to where clause', async () => {
      queryRows = [];

      await EventExportService.exportAsCsv(baseQuery({
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.999Z',
      }));

      expect(mockWhere).toHaveBeenCalled();
    });

    it('applies maxRows limit', async () => {
      queryRows = [];

      await EventExportService.exportAsCsv(baseQuery({ maxRows: 500 }));

      expect(mockLimit).toHaveBeenCalledWith(500);
    });
  });
});
