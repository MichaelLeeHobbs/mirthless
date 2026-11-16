// ===========================================
// Migration journal
// ===========================================
// drizzle-orm's migrator applies a migration only when its `when` is later than
// the newest one the database has applied. A `when` in the future, or one out
// of order, silently skips every migration generated before it on a database
// that already applied it.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

interface JournalEntry { readonly idx: number; readonly when: number; readonly tag: string }

const journal = JSON.parse(readFileSync(`${MIGRATIONS}meta/_journal.json`, 'utf8')) as { entries: JournalEntry[] };

describe('migration journal', () => {
  it('numbers the entries 0, 1, 2 ... with a .sql file for each', () => {
    journal.entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      expect(existsSync(`${MIGRATIONS}${entry.tag}.sql`), entry.tag).toBe(true);
    });
  });

  it('has `when` values that strictly increase', () => {
    const late = journal.entries.filter((entry, i) => i > 0 && entry.when <= (journal.entries[i - 1]?.when ?? 0));
    expect(late.map((e) => e.tag)).toEqual([]);
  });

  it('has no `when` in the future', () => {
    const now = Date.now();
    expect(journal.entries.filter((e) => e.when > now).map((e) => e.tag)).toEqual([]);
  });
});
