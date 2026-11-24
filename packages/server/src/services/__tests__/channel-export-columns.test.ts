// A column the export file has no field for is lost by every export and import, and by a backup restore (#334).
// That a field is written and read back is checked against Postgres (channel-export-import.itest.ts).

import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { EXPORTED_TABLES, type ExportedTable } from '../../../test/exported-tables.js';

describe('the channel export file', () => {
  it.each(Object.entries<ExportedTable>(EXPORTED_TABLES))('has a field for every %s column, or a reason not to', (_name, { table, fields, notExported }) => {
    const columns = Object.keys(getTableColumns(table));
    const exported = Object.keys(fields).filter((field) => columns.includes(field));
    expect([...exported, ...Object.keys(notExported)].sort()).toEqual([...columns].sort());
  });
});
