// Every exported file names its audit row (D-312), so a file found later can be
// traced to its record.

import os from 'node:os';
import type { Request } from 'express';
import { escapeCsvField } from './csv.js';

export interface ExportHeader {
  readonly product: 'GalvaniGraph';
  readonly server: string;
  readonly exportedBy: string;
  readonly exportedAt: string;
  readonly auditRecordId: number;
  readonly reason: string;
}

export function exportHeader(req: Request, auditRecordId: number, reason: string, now: Date = new Date()): ExportHeader {
  return {
    product: 'GalvaniGraph',
    server: os.hostname(),
    exportedBy: req.user?.username ?? req.user?.id ?? 'unknown',
    exportedAt: now.toISOString(),
    auditRecordId,
    reason,
  };
}

/** `rowsJson` is already a serialized JSON array, so a large export is not parsed and written twice. */
export function wrapJsonExport(header: ExportHeader, key: string, rowsJson: string): string {
  return `{\n  "export": ${JSON.stringify(header)},\n  ${JSON.stringify(key)}: ${rowsJson}\n}\n`;
}

/**
 * Each line is one escaped CSV field, so a spreadsheet that does not skip `#`
 * lines shows it as one cell: a value cannot add a column, swallow the rows
 * below or start a formula. CRLF, as the data rows.
 */
export function csvHeaderLines(header: ExportHeader): string {
  const lines = [
    `${header.product} export`,
    `server: ${header.server}`,
    `exported by: ${header.exportedBy}`,
    `exported at: ${header.exportedAt}`,
    `audit record: ${String(header.auditRecordId)}`,
    `reason: ${header.reason}`,
  ];
  return lines.map((l) => `${escapeCsvField(`# ${l.replace(/[\r\n]+/g, ' ')}`)}\r\n`).join('');
}
