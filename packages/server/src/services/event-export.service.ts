// ===========================================
// Event Export Service
// ===========================================
// Exports audit events as CSV or JSON for HIPAA compliance downloads.
// Uses the event list's filters but returns full result sets.

import { tryCatch, type Result } from 'stderr-lib';
import { desc } from 'drizzle-orm';
import type { EventExportQuery } from '@galvanigraph/core-models';
import { db } from '../lib/db.js';
import { escapeCsvField } from '../lib/csv.js';
import { events } from '../db/schema/index.js';
import { buildEventWhereConditions } from './event.service.js';
import { ALL_CHANNELS } from '@galvanigraph/core-models';
import type { ChannelScope } from '../lib/channel-scope.js';

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

async function fetchRows(query: EventExportQuery, scope: ChannelScope): Promise<readonly EventRow[]> {
  const where = buildEventWhereConditions(query, scope);

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
  static async exportAsCsv(query: EventExportQuery, scope: ChannelScope = ALL_CHANNELS): Promise<Result<string>> {
    return tryCatch(async () => {
      const rows = await fetchRows(query, scope);
      const header = CSV_COLUMNS.join(',');
      const lines = rows.map(rowToCsvFields);
      return `${header}\r\n${lines.join('\r\n')}${rows.length > 0 ? '\r\n' : ''}`;
    });
  }

  /** Export matching events as JSON array. */
  static async exportAsJson(query: EventExportQuery, scope: ChannelScope = ALL_CHANNELS): Promise<Result<string>> {
    return tryCatch(async () => {
      const rows = await fetchRows(query, scope);

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
