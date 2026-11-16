// ===========================================
// buildExportQuery Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { buildExportQuery } from '../use-message-export.js';

describe('buildExportQuery', () => {
  it('always includes the format', () => {
    expect(buildExportQuery('csv', {}, 'r')).toBe('format=csv&reason=r');
    expect(buildExportQuery('json', {}, 'r')).toBe('format=json&reason=r');
  });

  it('appends one status param per selected status', () => {
    const q = buildExportQuery('csv', { status: ['ERROR', 'SENT'] }, 'r');
    expect(q).toBe('format=csv&status=ERROR&status=SENT&reason=r');
  });

  it('includes date range, connector, message id, and content search', () => {
    const q = buildExportQuery('json', {
      receivedFrom: '2026-01-01T00:00:00.000Z',
      receivedTo: '2026-01-02T00:00:00.000Z',
      metaDataId: 1,
      messageId: 42,
      contentSearch: 'MSH|foo',
    }, 'r');
    expect(q).toContain('format=json');
    expect(q).toContain('receivedFrom=2026-01-01T00%3A00%3A00.000Z');
    expect(q).toContain('receivedTo=2026-01-02T00%3A00%3A00.000Z');
    expect(q).toContain('metaDataId=1');
    expect(q).toContain('messageId=42');
    expect(q).toContain('contentSearch=MSH%7Cfoo');
  });

  it('omits absent filters', () => {
    const q = buildExportQuery('csv', { messageId: 7 }, 'Line 1 & 2');
    expect(q).toBe('format=csv&messageId=7&reason=Line%201%20%26%202');
  });
});
