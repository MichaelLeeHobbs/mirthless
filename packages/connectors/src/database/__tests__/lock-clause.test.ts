import { describe, it, expect } from 'vitest';
import { appendLockClause, unheldRowsReason, withSkippedRows } from '../lock-clause.js';

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
    ['WITH c AS (SELECT * FROM t FOR SHARE) SELECT * FROM c FOR SHARE', 'WITH c AS (SELECT * FROM t FOR UPDATE) SELECT * FROM c FOR UPDATE'],
    ['(SELECT * FROM t FOR SHARE)', '(SELECT * FROM t FOR UPDATE)'],
    ['UPDATE t SET a = 1 WHERE id IN (SELECT id FROM t FOR SHARE) RETURNING *', 'UPDATE t SET a = 1 WHERE id IN (SELECT id FROM t FOR UPDATE) RETURNING *'],
    ['SELECT * FROM a, b FOR SHARE OF a FOR SHARE OF b NOWAIT', 'SELECT * FROM a, b FOR UPDATE OF a FOR UPDATE OF b NOWAIT'],
  ])('claims the rows a share lock would let two sources read: %s', (query, claimed) => {
    expect(appendLockClause(query)).toBe(claimed);
  });

  it.each([
    ['WITH c AS (SELECT * FROM t FOR SHARE) SELECT * FROM c', 'WITH c AS (SELECT * FROM t FOR UPDATE) SELECT * FROM c'],
    ['WITH c AS MATERIALIZED (SELECT * FROM t WHERE (a) = 1 FOR SHARE) SELECT * FROM c', 'WITH c AS MATERIALIZED (SELECT * FROM t WHERE (a) = 1 FOR UPDATE) SELECT * FROM c'],
    ['SELECT * FROM (SELECT * FROM t FOR SHARE) s', 'SELECT * FROM (SELECT * FROM t FOR UPDATE) s'],
    ['SELECT * FROM q JOIN (SELECT * FROM r FOR SHARE) s USING (id)', 'SELECT * FROM q JOIN (SELECT * FROM r FOR UPDATE) s USING (id)'],
  ])('claims the rows of a CTE or derived table, and the outer ones too: %s', (query, claimed) => {
    expect(appendLockClause(query)).toBe(`${claimed}${LOCK}`);
  });

  it.each([
    'SELECT * FROM t WHERE id IN (SELECT id FROM r FOR SHARE)',
    'SELECT * FROM t WHERE EXISTS (SELECT 1 FROM (SELECT id FROM r FOR SHARE) s)',
    'SELECT id, (SELECT name FROM r FOR SHARE) FROM t',
    'SELECT * FROM t WHERE id > ALL (SELECT id FROM r FOR SHARE)',
    'SELECT * FROM t WHERE code IS DISTINCT FROM (SELECT code FROM r LIMIT 1 FOR SHARE)',
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
    ['SELECT * FROM a, b FOR UPDATE OF a FOR SHARE OF "b", c.d SKIP LOCKED', 'SELECT * FROM a, b  '],
    ['SELECT * FROM t WHERE id IN (SELECT id FROM r FOR SHARE) FOR UPDATE SKIP LOCKED', 'SELECT * FROM t WHERE id IN (SELECT id FROM r ) '],
    ['SELECT * FROM t FOR NO KEY UPDATE NOWAIT FOR KEY SHARE FOR UPDATE SKIP LOCKED', 'SELECT * FROM t   '],
    ["SELECT 'for share' FROM t FOR UPDATE SKIP LOCKED", "SELECT 'for share' FROM t "],
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

// #445: the issue's three cases were run against PostgreSQL 17 and MySQL 8.4 with two transactions; the rest follow the databases' locking rules.
describe('unheldRowsReason', () => {
  const BOTH = ['postgresql', 'mysql'] as const;

  it.each(BOTH)('names a WITH query whose rows the lock does not hold (%s)', (vendor) => {
    expect(unheldRowsReason('WITH c AS (SELECT id FROM t WHERE NOT done) SELECT * FROM c', vendor)).toMatch(/WITH query/);
    expect(unheldRowsReason('with recursive c(id) as materialized (select id from t) select * from c', vendor)).toMatch(/WITH query/);
    expect(unheldRowsReason('WITH a AS (SELECT id FROM t FOR UPDATE SKIP LOCKED), b AS (SELECT id FROM u) SELECT * FROM b', vendor)).toMatch(/WITH query/);
  });

  it('names a derived table on MySQL, whose rows the lock does not hold there', () => {
    expect(unheldRowsReason('SELECT * FROM (SELECT id FROM t WHERE done = 0) s', 'mysql')).toMatch(/subquery in FROM/);
    expect(unheldRowsReason('SELECT * FROM a JOIN (SELECT id FROM t) s USING (id)', 'mysql')).toMatch(/subquery in FROM/);
    expect(unheldRowsReason('SELECT * FROM a, ((SELECT id FROM t)) s', 'mysql')).toMatch(/subquery in FROM/);
  });

  it('takes a derived table on PostgreSQL, where the lock holds its rows', () => {
    expect(unheldRowsReason('SELECT * FROM (SELECT id FROM t WHERE NOT done) s', 'postgresql')).toBeNull();
  });

  it.each(BOTH)('names a query whose only lock is in a subquery of a condition, which counts as its own (%s)', (vendor) => {
    expect(unheldRowsReason('SELECT id FROM t WHERE EXISTS (SELECT 1 FROM other FOR UPDATE) OR id = 1', vendor)).toMatch(/only lock/);
    expect(unheldRowsReason('SELECT (SELECT max(id) FROM o FOR UPDATE) AS m, id FROM t', vendor)).toMatch(/only lock/);
    expect(unheldRowsReason('WITH c AS (SELECT id FROM t WHERE EXISTS (SELECT 1 FROM o FOR UPDATE)) SELECT * FROM c FOR UPDATE', vendor)).toMatch(/WITH query/);
  });

  it.each(BOTH)('does not take ALL or FROM inside a condition for a source (%s)', (vendor) => {
    expect(unheldRowsReason('SELECT id FROM t WHERE id > ALL (SELECT id FROM o FOR UPDATE) OR id = 1', vendor)).toMatch(/only lock/);
    expect(unheldRowsReason('SELECT ALL (SELECT max(id) FROM o FOR UPDATE) AS m, id FROM t', vendor)).toMatch(/only lock/);
    expect(unheldRowsReason('SELECT id FROM a UNION ALL (SELECT id FROM b FOR UPDATE)', vendor)).not.toMatch(/only lock/);
  });

  it('does not take IS DISTINCT FROM for a source', () => {
    expect(unheldRowsReason('SELECT id FROM t WHERE code IS DISTINCT FROM (SELECT code FROM o LIMIT 1 FOR UPDATE)', 'postgresql')).toMatch(/only lock/);
  });

  it('names a WITH query whose only lock is one that other lockers share', () => {
    expect(unheldRowsReason('WITH c AS (SELECT id FROM t WHERE NOT done FOR KEY SHARE SKIP LOCKED) SELECT * FROM c', 'postgresql')).toMatch(/WITH query/);
  });

  it.each(BOTH)('names a lock that holds only the tables OF names (%s)', (vendor) => {
    expect(unheldRowsReason('SELECT o.* FROM o JOIN i ON i.o_id = o.id FOR UPDATE OF i SKIP LOCKED LIMIT 1', vendor)).toMatch(/OF/);
  });

  it('reads a query of many subqueries', () => {
    expect(unheldRowsReason(`SELECT ${'(SELECT 1 FOR UPDATE), '.repeat(300)}1 FROM t`, 'mysql')).toMatch(/only lock/);
  });

  it.each(BOTH)('names a UNION, INTERSECT or EXCEPT (%s)', (vendor) => {
    expect(unheldRowsReason('SELECT id FROM a UNION ALL SELECT id FROM b', vendor)).toMatch(/UNION/);
    expect(unheldRowsReason('SELECT id FROM a EXCEPT SELECT id FROM b', vendor)).toMatch(/UNION/);
  });

  it.each(BOTH)('takes the queries whose lock holds their rows (%s)', (vendor) => {
    for (const query of [
      'SELECT * FROM t WHERE done = 0',
      'SELECT * FROM t WHERE done = 0 FOR UPDATE SKIP LOCKED',
      'SELECT * FROM t WHERE id IN (SELECT id FROM r) ORDER BY id LIMIT 5',
      'SELECT * FROM t FOR SHARE',
      'WITH c AS (SELECT id FROM t WHERE done = 0 FOR UPDATE SKIP LOCKED) SELECT * FROM c',
      'SELECT * FROM (SELECT id FROM t FOR UPDATE SKIP LOCKED) s',
      '(SELECT * FROM t WHERE done = 0)',
      "SELECT 'with c as (select 1) union' AS label, CAST(ts AS date) FROM t -- WITH c AS (SELECT 1)",
    ]) {
      expect(unheldRowsReason(query, vendor), query).toBeNull();
    }
  });

  it('takes the PostgreSQL queries whose lock holds their rows', () => {
    for (const query of [
      'SELECT * FROM t WHERE NOT done AND EXISTS (SELECT 1 FROM t AS any_row FOR KEY SHARE SKIP LOCKED) ORDER BY id',
      'WITH c AS NOT MATERIALIZED (SELECT id FROM t FOR NO KEY UPDATE SKIP LOCKED) SELECT * FROM c',
      'UPDATE t SET done = true WHERE NOT done RETURNING *',
    ]) {
      expect(unheldRowsReason(query, 'postgresql'), query).toBeNull();
    }
  });
});
