// ===========================================
// Message Export Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MessageExportData } from '../message-export.service.js';

// ----- Mocks -----

const mockExecute = vi.fn();
const mockDb = { execute: mockExecute };

vi.mock('../../lib/db.js', () => ({ db: mockDb, default: mockDb }));

vi.mock('../../lib/content-crypto.js', () => ({
  // Pass-through decryption: returns the stored value unchanged.
  decryptIfEncrypted: (v: string | null) => ({ ok: true, value: v, error: null }),
}));

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, type: 'sql' }),
    { join: (items: unknown[], sep: unknown) => ({ items, sep, type: 'sql_join' }) },
  ),
}));

const { MessageExportService } = await import('../message-export.service.js');

// ----- Fixtures -----

function baseQuery(overrides?: Record<string, unknown>): never {
  return { format: 'csv', limit: 10_000, includeContent: false, ...overrides } as never;
}

const CHANNEL = '00000000-0000-0000-0000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rows: [] });
});

// ----- collect -----

describe('MessageExportService.collect', () => {
  it('flattens per-connector status and reports not-truncated', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // count
      .mockResolvedValueOnce({ rows: [ // data
        { id: 1, correlation_id: 'corr-1', received_at: '2026-01-01T00:00:00.000Z', processed: true },
        { id: 2, correlation_id: 'corr-2', received_at: '2026-01-02T00:00:00.000Z', processed: false },
      ] })
      .mockResolvedValueOnce({ rows: [ // statuses
        { message_id: 1, meta_data_id: 0, connector_name: 'Source', status: 'RECEIVED' },
        { message_id: 1, meta_data_id: 1, connector_name: 'Dest', status: 'SENT' },
        { message_id: 2, meta_data_id: 1, connector_name: 'Dest', status: 'ERROR' },
      ] });

    const result = await MessageExportService.collect(CHANNEL, baseQuery());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(2);
    expect(result.value.truncated).toBe(false);
    expect(result.value.rows).toHaveLength(2);
    expect(result.value.rows[0]!.statuses).toBe('Source(0)=RECEIVED; Dest(1)=SENT');
    expect(result.value.rows[1]!.statuses).toBe('Dest(1)=ERROR');
    expect(result.value.rows[0]!.content).toBeUndefined();
  });

  it('marks truncated when total exceeds returned rows', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ count: '50' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, correlation_id: 'c', received_at: '2026-01-01T00:00:00.000Z', processed: true }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await MessageExportService.collect(CHANNEL, baseQuery({ limit: 1 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.truncated).toBe(true);
    expect(result.value.total).toBe(50);
  });

  it('includes decrypted raw content when includeContent is set', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, correlation_id: 'c7', received_at: '2026-01-01T00:00:00.000Z', processed: true }] })
      .mockResolvedValueOnce({ rows: [{ message_id: 7, meta_data_id: 0, connector_name: 'Source', status: 'SENT' }] })
      .mockResolvedValueOnce({ rows: [{ message_id: 7, content: 'MSH|^~\\&|RAW' }] });

    const result = await MessageExportService.collect(CHANNEL, baseQuery({ includeContent: true }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows[0]!.content).toBe('MSH|^~\\&|RAW');
  });

  it('returns an empty result set when no messages match', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await MessageExportService.collect(CHANNEL, baseQuery());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toHaveLength(0);
    expect(result.value.truncated).toBe(false);
  });

  it('returns error on a DB failure', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection lost'));

    const result = await MessageExportService.collect(CHANNEL, baseQuery());

    expect(result.ok).toBe(false);
  });
});

// ----- toCsv -----

function data(rows: MessageExportData['rows']): MessageExportData {
  return { rows, total: rows.length, truncated: false };
}

describe('MessageExportService.toCsv', () => {
  it('emits a header and one CRLF-terminated row per message', () => {
    const csv = MessageExportService.toCsv(data([
      { messageId: 1, correlationId: 'c1', receivedAt: '2026-01-01T00:00:00.000Z', processed: true, statuses: 'Dest(1)=SENT' },
    ]), false);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('messageId,correlationId,receivedAt,processed,statuses');
    expect(lines[1]).toBe('1,c1,2026-01-01T00:00:00.000Z,true,Dest(1)=SENT');
  });

  it('guards against spreadsheet formula injection by prefixing a quote', () => {
    const csv = MessageExportService.toCsv(data([
      { messageId: 1, correlationId: 'c1', receivedAt: '2026-01-01T00:00:00.000Z', processed: true, statuses: '=cmd|1' },
    ]), false);
    // A field starting with = is neutralized to '=cmd|1 (leading quote), then
    // wrapped in quotes only if it contains CSV-special chars.
    expect(csv).toContain("'=cmd|1");
  });

  it('RFC4180-escapes a field containing a comma', () => {
    const csv = MessageExportService.toCsv(data([
      { messageId: 1, correlationId: 'c1', receivedAt: '2026-01-01T00:00:00.000Z', processed: true, statuses: 'A(1)=SENT, B(2)=ERROR' },
    ]), false);
    expect(csv).toContain('"A(1)=SENT, B(2)=ERROR"');
  });

  it('RFC4180-escapes a field containing a double quote', () => {
    const csv = MessageExportService.toCsv(data([
      { messageId: 1, correlationId: 'c1', receivedAt: '2026-01-01T00:00:00.000Z', processed: true, statuses: 'say "hi"' },
    ]), false);
    expect(csv).toContain('"say ""hi"""');
  });

  it('adds a content column when includeContent is true', () => {
    const csv = MessageExportService.toCsv(data([
      { messageId: 1, correlationId: 'c1', receivedAt: '2026-01-01T00:00:00.000Z', processed: true, statuses: 'x', content: 'MSH|raw' },
    ]), true);
    expect(csv.split('\r\n')[0]).toBe('messageId,correlationId,receivedAt,processed,statuses,content');
    expect(csv).toContain('MSH|raw');
  });

  it('returns header-only CSV when there are no rows', () => {
    const csv = MessageExportService.toCsv(data([]), false);
    expect(csv).toBe('messageId,correlationId,receivedAt,processed,statuses\r\n');
  });
});

// ----- toJson -----

describe('MessageExportService.toJson', () => {
  it('serializes rows as a JSON array with metadata fields', () => {
    const json = MessageExportService.toJson(data([
      { messageId: 3, correlationId: 'c3', receivedAt: '2026-01-01T00:00:00.000Z', processed: false, statuses: 'Dest(1)=QUEUED' },
    ]), false);
    const parsed = JSON.parse(json) as Record<string, unknown>[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!['messageId']).toBe(3);
    expect(parsed[0]!['statuses']).toBe('Dest(1)=QUEUED');
    expect(parsed[0]!['content']).toBeUndefined();
  });

  it('includes content only when requested', () => {
    const json = MessageExportService.toJson(data([
      { messageId: 3, correlationId: 'c3', receivedAt: '2026-01-01T00:00:00.000Z', processed: false, statuses: 'x', content: 'raw' },
    ]), true);
    const parsed = JSON.parse(json) as Record<string, unknown>[];
    expect(parsed[0]!['content']).toBe('raw');
  });
});
