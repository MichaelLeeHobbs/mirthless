import { describe, it, expect } from 'vitest';
import { appendLockClause } from '../lock-clause.js';

const LOCK = ' FOR UPDATE SKIP LOCKED';

describe('appendLockClause', () => {
  it('appends FOR UPDATE SKIP LOCKED and strips a trailing semicolon', () => {
    expect(appendLockClause('SELECT * FROM t WHERE p = false')).toBe(`SELECT * FROM t WHERE p = false${LOCK}`);
    expect(appendLockClause(' SELECT * FROM t ; ')).toBe(`SELECT * FROM t${LOCK}`);
  });

  it.each([
    'SELECT * FROM t FOR UPDATE',
    'SELECT * FROM t FOR  update OF t NOWAIT',
    'SELECT * FROM t FOR UPDATE LIMIT 5',
    'SELECT * FROM q JOIN r USING (id) FOR UPDATE OF q FOR SHARE OF r',
    'WITH c AS (SELECT * FROM t FOR UPDATE SKIP LOCKED) SELECT count(*) FROM c',
  ])('leaves a query that claims its rows as it is: %s', (query) => {
    expect(appendLockClause(query)).toBe(query);
  });

  it.each([
    ['SELECT * FROM t FOR SHARE', 'SELECT * FROM t FOR UPDATE'],
    ['SELECT * FROM t for\n share OF t SKIP LOCKED;', 'SELECT * FROM t FOR UPDATE OF t SKIP LOCKED'],
    ['SELECT * FROM t FOR SHARE LIMIT 5', 'SELECT * FROM t FOR UPDATE LIMIT 5'],
    ['SELECT * FROM a, b FOR SHARE OF a FOR SHARE OF b NOWAIT', 'SELECT * FROM a, b FOR UPDATE OF a FOR UPDATE OF b NOWAIT'],
  ])('claims the rows a share lock would let two sources read: %s', (query, claimed) => {
    expect(appendLockClause(query)).toBe(claimed);
  });

  it('claims the outer rows when only a subquery takes a share lock', () => {
    const query = 'SELECT * FROM t WHERE id IN (SELECT id FROM r FOR SHARE)';
    expect(appendLockClause(query)).toBe(`${query}${LOCK}`);
  });

  it.each([
    ["SELECT * FROM t WHERE note = 'for update'", 'postgresql'],
    ["SELECT * FROM t WHERE note = 'for share'", 'postgresql'],
    ["SELECT * FROM t WHERE note = 'it''s for update'", 'postgresql'],
    ["SELECT * FROM t WHERE note = E'it\\'s for update'", 'postgresql'],
    ["SELECT * FROM t WHERE path = 'C:\\' AND note <> 'for update'", 'postgresql'],
    ['SELECT * FROM t WHERE note = $q$for update$q$', 'postgresql'],
    ['SELECT "for update" FROM t', 'postgresql'],
    ['SELECT a /* for update */ FROM t', 'postgresql'],
    ['SELECT a -- for share\nFROM t', 'postgresql'],
    ["SELECT * FROM t WHERE note = 'it\\'s for update'", 'mysql'],
    ['SELECT * FROM t WHERE note = "for share"', 'mysql'],
    ['SELECT `for update` FROM t', 'mysql'],
    ['SELECT a # for update\nFROM t', 'mysql'],
    ['SELECT for_update FROM t', 'mysql'],
  ] as const)('does not take text or a comment for a lock: %s (%s)', (query, vendor) => {
    expect(appendLockClause(query, vendor)).toBe(`${query}${LOCK}`);
  });

  it.each([
    ['SELECT * FROM t -- the new ones', 'postgresql'],
    ['SELECT * FROM t; -- the new ones', 'postgresql'],
    ['SELECT * FROM t /* the new ones */', 'postgresql'],
    ['SELECT * FROM t # the new ones', 'mysql'],
    ['SELECT * FROM t -- the new ones', 'mysql'],
  ] as const)('is not hidden by a comment at the end: %s (%s)', (query, vendor) => {
    expect(appendLockClause(query, vendor)).toBe(`SELECT * FROM t${LOCK}`);
  });

  it('keeps text at the end of the query', () => {
    expect(appendLockClause("SELECT * FROM t WHERE status = 'NEW;'")).toBe(`SELECT * FROM t WHERE status = 'NEW;'${LOCK}`);
    expect(appendLockClause("SELECT * FROM t WHERE status = '--'", 'mysql')).toBe(`SELECT * FROM t WHERE status = '--'${LOCK}`);
  });

  it('changes a share lock and not the text beside it', () => {
    expect(appendLockClause("SELECT 'for share' FROM t FOR SHARE")).toBe("SELECT 'for share' FROM t FOR UPDATE");
  });
});
