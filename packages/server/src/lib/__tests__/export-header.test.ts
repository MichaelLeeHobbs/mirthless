import { describe, it, expect } from 'vitest';
import os from 'node:os';
import type { Request } from 'express';
import { csvHeaderLines, exportHeader, wrapJsonExport } from '../export-header.js';

const req = { user: { id: 'u1', username: 'kpatel' } } as unknown as Request;
const NOW = new Date('2026-11-16T12:00:00.000Z');

describe('exportHeader', () => {
  it('names the server, the exporter, the time, the audit record and the reason', () => {
    expect(exportHeader(req, 41, 'Quarterly review', NOW)).toEqual({
      product: 'GalvaniGraph', server: os.hostname(), exportedBy: 'kpatel',
      exportedAt: '2026-11-16T12:00:00.000Z', auditRecordId: 41, reason: 'Quarterly review',
    });
  });

  it('falls back to the user id, then to unknown', () => {
    expect(exportHeader({ user: { id: 'u1' } } as unknown as Request, 1, 'x', NOW).exportedBy).toBe('u1');
    expect(exportHeader({} as Request, 1, 'x', NOW).exportedBy).toBe('unknown');
  });
});

describe('wrapJsonExport', () => {
  it('puts the header beside the rows in one JSON document', () => {
    const header = exportHeader(req, 41, 'Review', NOW);
    const parsed = JSON.parse(wrapJsonExport(header, 'messages', JSON.stringify([{ messageId: 1 }], null, 2))) as unknown;
    expect(parsed).toEqual({ export: header, messages: [{ messageId: 1 }] });
  });
});

describe('csvHeaderLines', () => {
  it('writes each field as a "# " line, ending lines as the CSV rows do', () => {
    const lines = csvHeaderLines(exportHeader(req, 41, 'Quarterly review', NOW)).split('\r\n');
    expect(lines.slice(0, 6)).toEqual([
      '# GalvaniGraph export', `# server: ${os.hostname()}`, '# exported by: kpatel',
      '# exported at: 2026-11-16T12:00:00.000Z', '# audit record: 41', '# reason: Quarterly review',
    ]);
    expect(lines[6]).toBe('');
  });

  it('keeps a value on one line whatever it holds', () => {
    const text = csvHeaderLines({ ...exportHeader(req, 1, 'x', NOW), exportedBy: 'a\nb' });
    expect(text).toContain('# exported by: a b\r\n');
  });

  it('keeps each line one CSV field, so a reason cannot add a column, open a quote or start a formula', () => {
    const lines = csvHeaderLines(exportHeader(req, 1, 'Audit, =HYPERLINK("http://x","click")', NOW)).split('\r\n');
    // One quoted field: the comma stays inside it and the quotes are doubled.
    expect(lines[5]).toBe('"# reason: Audit, =HYPERLINK(""http://x"",""click"")"');
    const openQuote = csvHeaderLines(exportHeader(req, 1, 'a, "b', NOW)).split('\r\n')[5];
    expect(openQuote).toBe('"# reason: a, ""b"');
  });
});
