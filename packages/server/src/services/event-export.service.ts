// ===========================================
// Event Export Service
// ===========================================
// Exports audit events as CSV or JSON for HIPAA compliance downloads.
// Reuses filtering logic from EventService but returns full result sets.

import { tryCatch, type Result } from 'stderr-lib';
import { desc, and, inArray, gte, lte, eq } from 'drizzle-orm';
import type { EventExportQuery } from '@mirthless/core-models';
import { db } from '../lib/db.js';
import { events } from '../db/schema/index.js';

// ----- Types -----

interface EventRow {
  readonly id: number;
  readonly name: string;
  readonly level: string;
  readonly outcome: string;
  readonly userId: string | null;
  readonly ipAddress: string | null;
  readonly attributes: Record<string, unknown> | null;
  readonly createdAt: Date;
}

// ----- Helpers -----

const CSV_COLUMNS = ['id', 'name', 'level', 'outcome', 'userId', 'ipAddress', 'attributes', 'createdAt'] as const;

function buildExportWhereConditions(query: EventExportQuery): ReturnType<typeof and> {
  const conditions = [];

  if (query.level !== undefined) {
    const levels = query.level.split(',').map((s) => s.trim());
    conditions.push(inArray(events.level, levels));
  }

  if (query.name !== undefined) {
    const names = query.name.split(',').map((s) => s.trim());
    conditions.push(inArray(events.name, names));
  }

  if (query.outcome !== undefined) {
    conditions.push(eq(events.outcome, query.outcome));
  }

  if (query.startDate !== undefined) {
    conditions.push(gte(events.createdAt, new Date(query.startDate)));
  }

  if (query.endDate !== undefined) {
    conditions.push(lte(events.createdAt, new Date(query.endDate)));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

async function fetchRows(query: EventExportQuery): Promise<readonly EventRow[]> {
  const where = buildExportWhereConditions(query);

  const dataQuery = db
    .select({
      id: events.id,
      name: events.name,
      level: events.level,
      outcome: events.outcome,
      userId: events.userId,
      ipAddress: events.ipAddress,
      attributes: events.attributes,
      createdAt: events.createdAt,
    })
    .from(events);

  const rows = where !== undefined
    ? await dataQuery.where(where).orderBy(desc(events.createdAt)).limit(query.maxRows)
    : await dataQuery.orderBy(desc(events.createdAt)).limit(query.maxRows);

  return rows;
}

/** Escape a single CSV field per RFC 4180. */
function escapeCsvField(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToCsvFields(row: EventRow): string {
  const fields = [
    String(row.id),
    row.name,
    row.level,
    row.outcome,
    row.userId ?? '',
    row.ipAddress ?? '',
    row.attributes !== null ? JSON.stringify(row.attributes) : '',
    row.createdAt.toISOString(),
  ];

  return fields.map(escapeCsvField).join(',');
}

// ----- Service -----

export class EventExportService {
  /** Export matching events as RFC 4180 CSV. */
  static async exportAsCsv(query: EventExportQuery): Promise<Result<string>> {
    return tryCatch(async () => {
      const rows = await fetchRows(query);
      const header = CSV_COLUMNS.join(',');
      const lines = rows.map(rowToCsvFields);
      return `${header}\r\n${lines.join('\r\n')}${rows.length > 0 ? '\r\n' : ''}`;
    });
  }

  /** Export matching events as JSON array. */
  static async exportAsJson(query: EventExportQuery): Promise<Result<string>> {
    return tryCatch(async () => {
      const rows = await fetchRows(query);

      const data = rows.map((row) => ({
        id: row.id,
        name: row.name,
        level: row.level,
        outcome: row.outcome,
        userId: row.userId ?? null,
        ipAddress: row.ipAddress ?? null,
        attributes: row.attributes ?? null,
        createdAt: row.createdAt.toISOString(),
      }));

      return JSON.stringify(data, null, 2);
    });
  }
}
