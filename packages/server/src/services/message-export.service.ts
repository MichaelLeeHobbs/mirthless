// ===========================================
// Message Export Service
// ===========================================
// Exports channel message metadata as CSV or JSON for operational review.
// Metadata only by default (no PHI content); the caller may opt into the raw
// source column with includeContent (audited at the controller). Reuses the
// message-browser filter shape (status + received date range).

import { tryCatch, type Result } from 'stderr-lib';
import { sql } from 'drizzle-orm';
import type { MessageExportQuery } from '@mirthless/core-models';
import { db } from '../lib/db.js';
import { decryptIfEncrypted } from '../lib/content-crypto.js';
import { CONTENT_TYPE } from '../db/schema/message-content.js';

// ----- Types -----

export interface MessageExportRow {
  readonly messageId: number;
  readonly correlationId: string;
  readonly receivedAt: string;
  readonly processed: boolean;
  /** Flattened per-connector status, e.g. "Dest A(1)=SENT; Dest B(2)=ERROR". */
  readonly statuses: string;
  /** Decrypted raw source content — only present when includeContent is set. */
  readonly content?: string;
}

export interface MessageExportData {
  readonly rows: readonly MessageExportRow[];
  readonly total: number;
  /** True when total matching rows exceeded the limit and the export was capped. */
  readonly truncated: boolean;
}

const CSV_COLUMNS = ['messageId', 'correlationId', 'receivedAt', 'processed', 'statuses'] as const;

// ----- CSV Helpers -----

/**
 * Escape one CSV field per RFC 4180 and neutralize spreadsheet formula
 * injection: a field starting with =, +, -, @, tab, or CR is prefixed with a
 * single quote so Excel/Sheets treat it as text, not a formula.
 */
function escapeCsvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

function toIso(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

// ----- Query -----

function buildWhere(channelId: string, query: MessageExportQuery): ReturnType<typeof sql> {
  const conditions = [sql`m.channel_id = ${channelId}`];
  if (query.startDate !== undefined) {
    conditions.push(sql`m.received_at >= ${query.startDate.toISOString()}`);
  }
  if (query.endDate !== undefined) {
    conditions.push(sql`m.received_at <= ${query.endDate.toISOString()}`);
  }
  if (query.status !== undefined && query.status.length > 0) {
    const statusList = sql.join(query.status.map((s) => sql`${s}`), sql`, `);
    conditions.push(sql`m.id IN (SELECT DISTINCT cm.message_id FROM connector_messages cm WHERE cm.channel_id = ${channelId} AND cm.status IN (${statusList}))`);
  }
  return sql.join(conditions, sql` AND `);
}

async function loadStatuses(channelId: string, ids: readonly number[]): Promise<Map<number, string>> {
  const idParams = ids.map((id) => sql`${id}`);
  const rows = await db.execute<{ message_id: number; meta_data_id: number; connector_name: string | null; status: string }>(sql`
    SELECT message_id, meta_data_id, connector_name, status
    FROM connector_messages
    WHERE channel_id = ${channelId} AND message_id IN (${sql.join(idParams, sql`, `)})
    ORDER BY meta_data_id ASC
  `);
  const map = new Map<number, string>();
  for (const row of rows.rows) {
    const id = Number(row.message_id);
    const label = `${row.connector_name ?? 'connector'}(${String(row.meta_data_id)})=${row.status}`;
    const existing = map.get(id);
    map.set(id, existing ? `${existing}; ${label}` : label);
  }
  return map;
}

async function loadRawContent(channelId: string, ids: readonly number[]): Promise<Map<number, string>> {
  const idParams = ids.map((id) => sql`${id}`);
  const rows = await db.execute<{ message_id: number; content: string | null }>(sql`
    SELECT message_id, content
    FROM message_content
    WHERE channel_id = ${channelId} AND meta_data_id = 0 AND content_type = ${CONTENT_TYPE.RAW}
      AND message_id IN (${sql.join(idParams, sql`, `)})
  `);
  const map = new Map<number, string>();
  for (const row of rows.rows) {
    const decrypted = decryptIfEncrypted(row.content ?? null);
    if (!decrypted.ok) throw decrypted.error;
    map.set(Number(row.message_id), decrypted.value ?? '');
  }
  return map;
}

// ----- Service -----

export class MessageExportService {
  /** Collect matching messages (capped at query.limit) as structured export rows. */
  static async collect(channelId: string, query: MessageExportQuery): Promise<Result<MessageExportData>> {
    return tryCatch(async () => {
      const where = buildWhere(channelId, query);

      const countRes = await db.execute<{ count: string }>(sql`SELECT COUNT(*) as count FROM messages m WHERE ${where}`);
      const total = Number(countRes.rows[0]?.count ?? 0);

      const dataRes = await db.execute<{ id: number; correlation_id: string; received_at: string; processed: boolean }>(sql`
        SELECT id, correlation_id, received_at, processed
        FROM messages m
        WHERE ${where}
        ORDER BY received_at DESC
        LIMIT ${query.limit}
      `);

      const ids = dataRes.rows.map((r) => Number(r.id));
      const statuses = ids.length > 0 ? await loadStatuses(channelId, ids) : new Map<number, string>();
      const contents = query.includeContent && ids.length > 0 ? await loadRawContent(channelId, ids) : new Map<number, string>();

      const rows: MessageExportRow[] = dataRes.rows.map((r) => {
        const id = Number(r.id);
        const base: MessageExportRow = {
          messageId: id,
          correlationId: r.correlation_id,
          receivedAt: toIso(r.received_at),
          processed: r.processed,
          statuses: statuses.get(id) ?? '',
        };
        return query.includeContent ? { ...base, content: contents.get(id) ?? '' } : base;
      });

      return { rows, total, truncated: total > rows.length };
    });
  }

  /** Render export rows as RFC 4180 CSV with formula-injection guarding. */
  static toCsv(data: MessageExportData, includeContent: boolean): string {
    const columns = includeContent ? [...CSV_COLUMNS, 'content'] : [...CSV_COLUMNS];
    const header = columns.join(',');
    const lines = data.rows.map((row) => {
      const fields = [
        String(row.messageId),
        row.correlationId,
        row.receivedAt,
        String(row.processed),
        row.statuses,
      ];
      if (includeContent) fields.push(row.content ?? '');
      return fields.map(escapeCsvField).join(',');
    });
    return `${header}\r\n${lines.join('\r\n')}${data.rows.length > 0 ? '\r\n' : ''}`;
  }

  /** Render export rows as a pretty-printed JSON array. */
  static toJson(data: MessageExportData, includeContent: boolean): string {
    const out = data.rows.map((row) => {
      const base: Record<string, unknown> = {
        messageId: row.messageId,
        correlationId: row.correlationId,
        receivedAt: row.receivedAt,
        processed: row.processed,
        statuses: row.statuses,
      };
      if (includeContent) base['content'] = row.content ?? '';
      return base;
    });
    return JSON.stringify(out, null, 2);
  }
}
