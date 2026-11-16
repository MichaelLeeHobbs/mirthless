// ===========================================
// Export Header
// ===========================================
// Every exported file (messages, events, a backup) names where it came from,
// who took it, when, why, and the audit row that records it (D-312), so a
// file found later can be traced to its record.

import os from 'node:os';
import type { Request } from 'express';

export interface ExportHeader {
  readonly product: 'GalvaniGraph';
  readonly server: string;
  readonly exportedBy: string;
  readonly exportedAt: string;
  readonly auditRecordId: number;
  readonly reason: string;
}

/** The header for an export the signed-in caller just took, recorded as `auditRecordId`. */
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

/**
 * A JSON export: `{ "export": header, "<key>": <rows> }`, where `rowsJson` is
 * the rows already serialized as a JSON array (so a large export is not
 * parsed and written twice).
 */
export function wrapJsonExport(header: ExportHeader, key: string, rowsJson: string): string {
  return `{\n  "export": ${JSON.stringify(header)},\n  ${JSON.stringify(key)}: ${rowsJson}\n}\n`;
}

/** The header as CSV comment lines, each starting `# `, ending in a newline. */
export function csvHeaderLines(header: ExportHeader): string {
  const lines = [
    `${header.product} export`,
    `server: ${header.server}`,
    `exported by: ${header.exportedBy}`,
    `exported at: ${header.exportedAt}`,
    `audit record: ${String(header.auditRecordId)}`,
    `reason: ${header.reason}`,
  ];
  // The reason is one line by schema; a username or host name never has a newline either.
  return lines.map((l) => `# ${l.replace(/[\r\n]+/g, ' ')}\n`).join('');
}
