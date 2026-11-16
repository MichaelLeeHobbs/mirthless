# Audit log

The `audit_log` table is GalvaniGraph's protected record of who read PHI and who changed access (D-312). This page is for the person who runs the database: how the table is protected, how its partitions are kept, and how old months are dropped.

## How it is protected

- The server's database role (D-307, [upgrade](upgrade.md#database-roles)) holds `SELECT` and `INSERT` on `audit_log` and on every one of its partitions, nothing more. It cannot change, delete, empty or drop audit rows. The server image's entrypoint takes `UPDATE` and `DELETE` back on every start, partitions included.
- Triggers refuse `UPDATE`, `DELETE` and `TRUNCATE` on the table and on each partition, even for the table's owner. They guard against the owner's own mistakes. An owner can still disable them or drop a partition, which is why the docs say a database owner can alter the log.
- Rows have no foreign keys, so deleting a user or a channel never rewrites them.

## Partitions

Rows are partitioned by month of `occurred_at`, in UTC: `audit_log_y2026m11` holds November 2026. The migration that made the table created the current month and the eleven after it, plus `audit_log_default`.

The server keeps the current month through three months ahead. It calls `ensure_audit_partitions()` when it starts and every 24 hours after. The function takes no argument, so the server cannot make partitions for dates it chooses. A failure shows as the `audit-partitions` step in `/health/ready` and as a `SERVER_STARTUP_STEP_FAILED` event, the same as a failed startup step.

**Rows in DEFAULT.** A row whose month has no partition lands in `audit_log_default`, and the System Info page warns about it ("audit rows outside a monthly partition"). That only happens when the server has not run `ensure_audit_partitions()` for months. While those rows sit there, the month's partition cannot be created. As the owner:

```sql
BEGIN;
ALTER TABLE audit_log DETACH PARTITION audit_log_default;
-- for each month the stray rows belong to, e.g. 2027-03:
SELECT audit_log_month_partition('2027-03-01');
-- copy the rows into their months, then empty the detached table:
INSERT INTO audit_log SELECT * FROM audit_log_default;
DELETE FROM audit_log_default;
ALTER TABLE audit_log ATTACH PARTITION audit_log_default DEFAULT;
COMMIT;
```

A detached table loses the row trigger it took from `audit_log`, which is why the `DELETE` works there, and attaching it again restores the trigger. This is the same power that lets an owner alter the log, so do it in one transaction and keep the session's record.

Then restart the server, or wait a day, so it makes the months ahead.

## Tracing an exported file

Every message export, event export and backup carries a header naming the audit record that recorded it: `# audit record: N` in a CSV, `"export": { "auditRecordId": N }` in JSON, `"exportInfo": { "auditRecordId": N }` in a backup. Look the record up under Events, Access records, or with `GET /api/v1/audit/N`. It names who exported, from which address, why, and the message ids exported.

A backup's record also holds the SHA-256 of the file as the Backup page saved it, without its `exportInfo` block (the block names the record, so it cannot be inside the hash). To check a backup file: remove the `exportInfo` key, write the rest as JSON with two-space indents, and hash that.

## Retention

The `audit.retention_years` setting (Settings, Audit log) says how many years are kept. It is never less than 6: a lower value, or a missing or unreadable one, counts as 6.

Nothing drops months on its own. When months are past retention, the owner drops them with a reason:

```sql
SELECT drop_expired_audit_partitions('Annual retention review, ticket OPS-123');
```

The function drops only month partitions that ended more than the retention ago, never `audit_log_default`. Before it drops anything it writes an `AUDIT_PARTITIONS_DROPPED` row naming the partitions, the retention it applied, the reason and the database user. It returns how many it dropped. The server's role cannot call it.
