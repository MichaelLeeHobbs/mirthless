// ===========================================
// Message search and export query strings
// ===========================================
// Pins the exact strings both builders send, parameter order included, so the
// shared filter serialisation cannot drift from what the server receives today.

import { describe, it, expect } from 'vitest';
import { buildSearchQuery, type MessageSearchParams } from '../use-messages.js';
import { buildExportQuery } from '../use-message-export.js';

const PAGING = { limit: 50, offset: 100, sort: 'receivedAt', sortDir: 'desc' } as const;

const ALL_FILTERS = {
  status: ['ERROR', 'SENT'],
  receivedFrom: '2026-01-01T00:00:00.000Z',
  receivedTo: '2026-01-02T00:00:00.000Z',
  metaDataId: 0,
  messageId: 42,
  contentSearch: 'PID|Doe John',
} as const;

const ALL_FILTERS_QUERY =
  'status=ERROR&status=SENT'
  + '&receivedFrom=2026-01-01T00%3A00%3A00.000Z'
  + '&receivedTo=2026-01-02T00%3A00%3A00.000Z'
  + '&metaDataId=0&messageId=42&contentSearch=PID%7CDoe%20John';

const BLANK_FILTERS = { status: [], receivedFrom: '', receivedTo: '', contentSearch: '' } as const;

const PARTIAL_FILTERS = { status: ['QUEUED'], receivedTo: '', messageId: 7 } as const;

function search(filters: Partial<MessageSearchParams>): string {
  return buildSearchQuery({ channelId: 'ch-1', ...PAGING, ...filters });
}

describe('buildSearchQuery', () => {
  it('serialises every filter before the paging and sort params', () => {
    expect(search(ALL_FILTERS)).toBe(`${ALL_FILTERS_QUERY}&limit=50&offset=100&sort=receivedAt&sortDir=desc`);
  });

  it('sends only paging and sort when no filter is set', () => {
    expect(search({})).toBe('limit=50&offset=100&sort=receivedAt&sortDir=desc');
  });

  it('omits empty strings and an empty status list', () => {
    expect(search(BLANK_FILTERS)).toBe('limit=50&offset=100&sort=receivedAt&sortDir=desc');
  });

  it('sends only the filters that are set', () => {
    expect(search(PARTIAL_FILTERS)).toBe('status=QUEUED&messageId=7&limit=50&offset=100&sort=receivedAt&sortDir=desc');
  });
});

describe('buildExportQuery exact output', () => {
  it('serialises every filter after the format', () => {
    expect(buildExportQuery('json', ALL_FILTERS, 'Audit request')).toBe(`format=json&${ALL_FILTERS_QUERY}&reason=Audit%20request`);
  });

  it('sends only the format when no filter is set', () => {
    expect(buildExportQuery('csv', BLANK_FILTERS, 'x')).toBe('format=csv&reason=x');
  });

  it('sends only the filters that are set', () => {
    expect(buildExportQuery('csv', PARTIAL_FILTERS, 'x')).toBe('format=csv&status=QUEUED&messageId=7&reason=x');
  });
});
