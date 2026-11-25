import { describe, it, expect } from 'vitest';
import { appendLockClause, withSkippedRows } from '../lock-clause.js';

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
    ['WITH c AS (SELECT * FROM t FOR SHARE) SELECT * FROM c', 'WITH c AS (SELECT * FROM t FOR UPDATE) SELECT * FROM c'],
    ['WITH c AS MATERIALIZED (SELECT * FROM t WHERE (a) = 1 FOR SHARE) SELECT * FROM c', 'WITH c AS MATERIALIZED (SELECT * FROM t WHERE (a) = 1 FOR UPDATE) SELECT * FROM c'],
    ['SELECT * FROM (SELECT * FROM t FOR SHARE) s', 'SELECT * FROM (SELECT * FROM t FOR UPDATE) s'],
    ['SELECT * FROM r JOIN (SELECT * FROM t FOR SHARE) s USING (id)', 'SELECT * FROM r JOIN (SELECT * FROM t FOR UPDATE) s USING (id)'],
    ['(SELECT * FROM t FOR SHARE)', '(SELECT * FROM t FOR UPDATE)'],
    ['UPDATE t SET a = 1 WHERE id IN (SELECT id FROM t FOR SHARE) RETURNING *', 'UPDATE t SET a = 1 WHERE id IN (SELECT id FROM t FOR UPDATE) RETURNING *'],
    ['SELECT * FROM a, b FOR SHARE OF a FOR SHARE OF b NOWAIT', 'SELECT * FROM a, b FOR UPDATE OF a FOR UPDATE OF b NOWAIT'],
  ])('claims the rows a share lock would let two sources read: %s', (query, claimed) => {
    expect(appendLockClause(query)).toBe(claimed);
  });

  it.each([
    'SELECT * FROM t WHERE id IN (SELECT id FROM r FOR SHARE)',
    'SELECT * FROM t WHERE EXISTS (SELECT 1 FROM (SELECT id FROM r FOR SHARE) s)',
    'SELECT id, (SELECT name FROM r FOR SHARE) FROM t',
  ])('claims the outer rows when only a subquery of a condition or a column takes a share lock: %s', (query) => {
    expect(appendLockClause(query)).toBe(`${query}${LOCK}`);
  });

  it('is quick on a long comment', () => {
    const query = `SELECT * /*${' '.repeat(200_000)}*/ FROM t`;
    const started = performance.now();
    expect(appendLockClause(query)).toBe(`${query}${LOCK}`);
    expect(performance.now() - started).toBeLessThan(1_000);
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

describe('withSkippedRows', () => {
  it.each([
    ['SELECT * FROM t FOR UPDATE SKIP LOCKED', 'SELECT * FROM t '],
    ['SELECT * FROM t for update OF t, u skip locked LIMIT 5', 'SELECT * FROM t  LIMIT 5'],
    ['WITH c AS (SELECT * FROM t FOR UPDATE SKIP LOCKED) SELECT * FROM c', 'WITH c AS (SELECT * FROM t ) SELECT * FROM c'],
    ['SELECT * FROM a, b FOR UPDATE OF a FOR SHARE OF b SKIP LOCKED', 'SELECT * FROM a, b '],
  ])('reads what the lock skips: %s', (query, all) => {
    expect(withSkippedRows(query, 'postgresql')).toBe(all);
  });

  it.each([
    'SELECT * FROM t FOR UPDATE',
    'SELECT * FROM t FOR UPDATE NOWAIT',
    "SELECT 'for update skip locked' FROM t FOR UPDATE",
  ])('leaves a query that skips none as it is: %s', (query) => {
    expect(withSkippedRows(query, 'postgresql')).toBe(query);
  });
});
