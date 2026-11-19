// ===========================================
// Runtime database role — real Postgres integration
// ===========================================
// The production server connects as a role that owns no application tables (#232, D-307).
// This suite builds that setup in a throwaway database: it applies the real
// migrations as the owner (DATABASE_URL's user), provisions a runtime role with
// the same code the server image's entrypoint runs, then connects as that role
// and shows it can do the server's work (including creating a channel's message
// partitions and running the seed) but cannot change, empty or drop a table.
//
// Needs a DATABASE_URL user that may CREATE DATABASE and CREATE ROLE (the CI and
// docker dev Postgres superuser can). The database and role are dropped after.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeIntegration } from './_setup.js';
import { PgBoss } from 'pg-boss';
import { checkRuntimeRole, PG_BOSS_SCHEMA, provisionRuntimeRole } from '../../src/db/runtime-role.js';

const SERVER_DIR = fileURLToPath(new URL('../../', import.meta.url));
const MIGRATIONS = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const SUFFIX = randomUUID().replace(/-/g, '').slice(0, 12);
const DB_NAME = `gf_roles_${SUFFIX}_test`;
const FRESH_DB_NAME = `gf_roles_${SUFFIX}_fresh_test`;
const ROLE = `gf_app_${SUFFIX}`;
const ROLE_PASSWORD = `pw_${randomUUID()}`;
// A name that needs quoting (upper case, a hyphen), as POSTGRES_APP_USER may be.
const MIXED_ROLE = `GF_Mixed-${SUFFIX}`;
const SUPER_ROLE = `gf_super_${SUFFIX}`;
const INSUFFICIENT_PRIVILEGE = '42501';
const OLD_QUEUE = 'itest-before-split';

function urlFor(database: string, user?: string, password?: string): string {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${database}`;
  if (user !== undefined) url.username = user;
  if (password !== undefined) url.password = password;
  return url.toString();
}

/** Run a statement as `client` and return the Postgres error code it fails with. */
async function failureCode(client: pg.Client, text: string): Promise<string | undefined> {
  try {
    await client.query(text);
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

/**
 * Start pg-boss on `connectionString`, run `work`, stop it; fail on any pg-boss
 * error event. `createSchema: false` is how lib/queue.ts starts it now; the
 * server before the split started it with pg-boss's default, true.
 */
async function withBoss(
  connectionString: string,
  work: (boss: PgBoss) => Promise<void>,
  createSchema = false,
): Promise<void> {
  const boss = new PgBoss({ connectionString, schema: PG_BOSS_SCHEMA, createSchema, supervise: false, schedule: false });
  const errors: Error[] = [];
  boss.on('error', (err: Error) => { errors.push(err); });
  await boss.start();
  try {
    await work(boss);
  } finally {
    await boss.stop({ graceful: false });
  }
  expect(errors.map((e) => e.message)).toEqual([]);
}

function runSeedAs(databaseUrl: string): Promise<{ readonly code: number | null; readonly output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/db/seeds/run-seed.ts'], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        SEED_DEMO_DATA: 'true',
        JWT_SECRET: process.env.JWT_SECRET ?? 'runtime-role-itest-secret-at-least-32-chars',
      },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

describeIntegration('Runtime database role (real Postgres)', () => {
  let admin: pg.Client;
  let owner: pg.Client;
  let runtime: pg.Client;

  /** Create `database`, apply the migrations as the owner, and return an owner client on it. */
  async function migratedDatabase(database: string): Promise<pg.Client> {
    await admin.query(`CREATE DATABASE "${database}"`);
    const ownerPool = new pg.Pool({ connectionString: urlFor(database) });
    try {
      await migrate(drizzle(ownerPool), { migrationsFolder: MIGRATIONS });
    } finally {
      await ownerPool.end();
    }
    const client = new pg.Client({ connectionString: urlFor(database) });
    await client.connect();
    return client;
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    owner = await migratedDatabase(DB_NAME);

    // An install from before the split: the server ran as the owner, so pg-boss
    // created its tables and queued a job as the owner.
    await withBoss(urlFor(DB_NAME), async (boss) => {
      await boss.createQueue(OLD_QUEUE);
      await boss.send(OLD_QUEUE, { from: 'owner' });
    }, true);

    const provisioned = await provisionRuntimeRole(owner, { user: ROLE, password: ROLE_PASSWORD });
    expect(provisioned.ok, provisioned.ok ? '' : provisioned.error.message).toBe(true);

    runtime = new pg.Client({ connectionString: urlFor(DB_NAME, ROLE, ROLE_PASSWORD) });
    await runtime.connect();
  }, 120_000);

  // Every pg-boss instance and pool this file opens is stopped where it is used, and
  // WITH (FORCE) ends any session left over, so nothing here waits on a client. Dropping
  // two migrated databases is server work that a loaded machine slows down, so the
  // teardown gets the setup's budget, not the 30 s default (#294).
  afterAll(async () => {
    await runtime?.end();
    await owner?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
      await admin.query(`DROP DATABASE IF EXISTS "${FRESH_DB_NAME}" WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS "${ROLE}"`);
      await admin.query(`DROP ROLE IF EXISTS "${MIXED_ROLE}"`);
      await admin.query(`DROP ROLE IF EXISTS "${SUPER_ROLE}"`);
      await admin.end();
    }
  }, 120_000);

  /** Insert a channel row as `client` and return its id; the partition function wants one. */
  async function newChannel(client: pg.Client): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO channels (id, name, inbound_data_type, outbound_data_type, source_connector_type, source_connector_properties)
       VALUES ($1, $2, 'RAW', 'RAW', 'CHANNEL', '{}'::jsonb)`,
      [id, `role-itest-${id}`],
    );
    return id;
  }

  /** Make the runtime role a member of `role` (as `grant` says), run `check`, and take the membership back. */
  async function asMemberOf(role: string, grant: string, check: () => Promise<void>): Promise<void> {
    await admin.query(`GRANT "${role}" TO "${ROLE}" ${grant}`);
    try {
      await check();
    } finally {
      await admin.query(`REVOKE "${role}" FROM "${ROLE}"`);
    }
  }

  it('on a new install, pg-boss creates its tables as a runtime role whose name needs quoting', async () => {
    const fresh = await migratedDatabase(FRESH_DB_NAME);
    try {
      const provisioned = await provisionRuntimeRole(fresh, { user: MIXED_ROLE, password: ROLE_PASSWORD });
      expect(provisioned.ok, provisioned.ok ? '' : provisioned.error.message).toBe(true);
      // Again, now that the schema is the role's: the ownership checks compare its oid.
      const again = await provisionRuntimeRole(fresh, { user: MIXED_ROLE, password: ROLE_PASSWORD });
      expect(again.ok, again.ok ? '' : again.error.message).toBe(true);
    } finally {
      await fresh.end();
    }

    await withBoss(urlFor(FRESH_DB_NAME, MIXED_ROLE, ROLE_PASSWORD), async (boss) => {
      await boss.createQueue('itest-fresh');
      await boss.send('itest-fresh', { from: 'runtime' });
      const [job] = await boss.fetch('itest-fresh');
      expect(job?.data).toEqual({ from: 'runtime' });
    });
  }, 120_000);

  it('passes the startup check: not a superuser and without the table owner rights', async () => {
    const check = await checkRuntimeRole(runtime);
    expect(check.ok, check.ok ? '' : check.error.message).toBe(true);
  });

  it('the startup check refuses the owner connection', async () => {
    const check = await checkRuntimeRole(owner);
    expect(check.ok).toBe(false);
  });

  it('refuses a runtime role that can SET ROLE to the owner without inheriting its rights', async () => {
    const ownerName = (await owner.query<{ name: string }>('SELECT current_user AS name')).rows[0]?.name ?? '';
    await asMemberOf(ownerName, 'WITH INHERIT FALSE, SET TRUE', async () => {
      expect((await checkRuntimeRole(runtime)).ok).toBe(false);
      expect((await provisionRuntimeRole(owner, { user: ROLE, password: ROLE_PASSWORD })).ok).toBe(false);
    });
  });

  it('refuses a runtime role that is a member of a superuser role', async () => {
    await admin.query(`CREATE ROLE "${SUPER_ROLE}" SUPERUSER NOLOGIN`);
    await asMemberOf(SUPER_ROLE, '', async () => {
      expect((await checkRuntimeRole(runtime)).ok).toBe(false);
      expect((await provisionRuntimeRole(owner, { user: ROLE, password: ROLE_PASSWORD })).ok).toBe(false);
    });
  });

  it('refuses a runtime role that is a member of the server file and program roles', async () => {
    for (const role of ['pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program']) {
      await asMemberOf(role, '', async () => {
        expect((await checkRuntimeRole(runtime)).ok, role).toBe(false);
        expect((await provisionRuntimeRole(owner, { user: ROLE, password: ROLE_PASSWORD })).ok, role).toBe(false);
      });
    }
    // With the memberships gone, both pass again.
    expect((await checkRuntimeRole(runtime)).ok).toBe(true);
  });

  it('refuses to provision the owner itself as the runtime role', async () => {
    const ownerName = (await owner.query<{ name: string }>('SELECT current_user AS name')).rows[0]?.name ?? '';
    const result = await provisionRuntimeRole(owner, { user: ownerName, password: 'x' });
    expect(result.ok).toBe(false);
  });

  it('provisioning again is idempotent and the role still connects', async () => {
    const again = await provisionRuntimeRole(owner, { user: ROLE, password: ROLE_PASSWORD });
    expect(again.ok, again.ok ? '' : again.error.message).toBe(true);
    const probe = new pg.Client({ connectionString: urlFor(DB_NAME, ROLE, ROLE_PASSWORD) });
    await probe.connect();
    await probe.end();
  });

  it('creates a channel\'s message partitions and stores, reads and deletes a message', async () => {
    const channelId = await newChannel(runtime);
    await runtime.query('SELECT create_channel_partitions($1::uuid)', [channelId]);
    // Idempotent, as channel import may ask for the partitions of an existing channel.
    await runtime.query('SELECT create_channel_partitions($1::uuid)', [channelId]);

    const inserted = await runtime.query<{ id: string; part: string }>(
      'INSERT INTO messages (channel_id) VALUES ($1) RETURNING id, tableoid::regclass::text AS part',
      [channelId],
    );
    expect(inserted.rows[0]?.part).toBe(`messages_p_${channelId.replace(/-/g, '_')}`);

    const id = inserted.rows[0]?.id;
    await runtime.query('UPDATE messages SET processed = true WHERE channel_id = $1 AND id = $2', [channelId, id]);
    const deleted = await runtime.query('DELETE FROM messages WHERE channel_id = $1 AND id = $2', [channelId, id]);
    expect(deleted.rowCount).toBe(1);
  });

  it('refuses to create partitions for a channel id with no channel', async () => {
    expect(await failureCode(runtime, `SELECT create_channel_partitions('${randomUUID()}'::uuid)`)).toBe('23503');
  });

  it('appends and reads audit events but cannot rewrite or delete one', async () => {
    const name = `ROLE_ITEST_${SUFFIX}`;
    await runtime.query(`INSERT INTO events (level, name, outcome) VALUES ('INFO', $1, 'SUCCESS')`, [name]);
    const read = await runtime.query('SELECT 1 FROM events WHERE name = $1', [name]);
    expect(read.rowCount).toBe(1);

    expect(await failureCode(runtime, `UPDATE events SET outcome = 'FAILURE' WHERE name = '${name}'`)).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode(runtime, `DELETE FROM events WHERE name = '${name}'`)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('purges events through purge_events, which keeps anything younger than the minimum age', async () => {
    const old = `ROLE_ITEST_OLD_${SUFFIX}`;
    const recent = `ROLE_ITEST_RECENT_${SUFFIX}`;
    await runtime.query(
      `INSERT INTO events (level, name, outcome, created_at)
       VALUES ('INFO', $1, 'SUCCESS', now() - interval '3 days'), ('INFO', $2, 'SUCCESS', now() - interval '12 hours')`,
      [old, recent],
    );

    expect(await failureCode(runtime, 'SELECT purge_events(0)')).toBe('22023');
    const purged = await runtime.query<{ deleted: string }>('SELECT purge_events(1) AS deleted');
    expect(Number(purged.rows[0]?.deleted)).toBeGreaterThanOrEqual(1);

    const left = await runtime.query<{ name: string }>('SELECT name FROM events WHERE name IN ($1, $2)', [old, recent]);
    expect(left.rows.map((r) => r.name)).toEqual([recent]);
  });

  /** This month's audit partition, as the migration names it (UTC). */
  function auditPartition(monthsFromNow = 0): string {
    const now = new Date();
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsFromNow, 1));
    return `audit_log_y${String(month.getUTCFullYear())}m${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  it('appends and reads the audit log but is refused, by privilege, every change to it or a partition', async () => {
    const action = `ROLE_ITEST_${SUFFIX}`;
    await runtime.query(`INSERT INTO audit_log (action, outcome) VALUES ($1, 'SUCCESS')`, [action]);
    expect((await runtime.query('SELECT 1 FROM audit_log WHERE action = $1', [action])).rowCount).toBe(1);

    // A permission error, not the trigger's: the role never holds these rights.
    for (const table of ['audit_log', auditPartition(), 'audit_log_default']) {
      expect(await failureCode(runtime, `UPDATE ${table} SET outcome = 'FAILURE' WHERE action = '${action}'`), `UPDATE ${table}`).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await failureCode(runtime, `DELETE FROM ${table} WHERE action = '${action}'`), `DELETE ${table}`).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await failureCode(runtime, `TRUNCATE ${table}`), `TRUNCATE ${table}`).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await failureCode(runtime, `DROP TABLE ${table}`), `DROP ${table}`).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await failureCode(runtime, `ALTER TABLE ${table} DISABLE TRIGGER ALL`), `ALTER ${table}`).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect(await failureCode(runtime, `SELECT drop_expired_audit_partitions('itest')`)).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode(runtime, `SELECT audit_log_month_partition('2001-01-01')`)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('refuses the owner too: the triggers stop UPDATE, DELETE and TRUNCATE on the log and each partition', async () => {
    const RAISED = 'P0001';
    // A row trigger fires only on a row, so give this test its own.
    await owner.query(`INSERT INTO audit_log (action, outcome) VALUES ('ROLE_ITEST_OWNER_${SUFFIX}', 'SUCCESS')`);
    expect(await failureCode(owner, `UPDATE audit_log SET outcome = 'X'`)).toBe(RAISED);
    expect(await failureCode(owner, `DELETE FROM audit_log`)).toBe(RAISED);
    for (const table of ['audit_log', auditPartition(), auditPartition(11), 'audit_log_default']) {
      expect(await failureCode(owner, `TRUNCATE ${table}`), `TRUNCATE ${table}`).toBe(RAISED);
    }
    expect(await failureCode(owner, `DELETE FROM ${auditPartition()}`)).toBe(RAISED);
  });

  it('keeps partitions to three months ahead through ensure_audit_partitions, and they refuse UPDATE and DELETE to the role', async () => {
    const ahead = auditPartition(3);
    await owner.query(`DROP TABLE ${ahead}`);

    // A caller's own time zone and date style must not move the bounds.
    await runtime.query(`SET TimeZone = 'America/New_York'`);
    await runtime.query(`SET DateStyle = 'SQL, DMY'`);
    const ensure = 'SELECT made, failed FROM ensure_audit_partitions()';
    expect((await runtime.query<{ made: number; failed: string[] }>(ensure)).rows[0]).toEqual({ made: 1, failed: [] });
    expect((await runtime.query<{ made: number; failed: string[] }>(ensure)).rows[0]).toEqual({ made: 0, failed: [] });
    await runtime.query('RESET TimeZone');
    await runtime.query('RESET DateStyle');
    const bounds = await owner.query<{ bound: string }>(
      `SELECT pg_get_expr(c.relpartbound, c.oid) AS bound FROM pg_class c WHERE c.relname = $1`, [ahead]);
    const first = new Date();
    const start = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 3, 1));
    expect(bounds.rows[0]?.bound).toContain(`'${start.toISOString().slice(0, 10)} 00:00:00+00'`);

    expect(await failureCode(runtime, `UPDATE ${ahead} SET outcome = 'X'`)).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode(runtime, `DELETE FROM ${ahead}`)).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode(owner, `TRUNCATE ${ahead}`)).toBe('P0001');
  });

  it('still makes the other months when one cannot be made, and names it', async () => {
    const blocked = auditPartition(2);
    const later = auditPartition(3);
    const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 2, 15));
    await owner.query(`DROP TABLE ${blocked}`);
    await owner.query(`DROP TABLE ${later}`);
    // A row in DEFAULT for the blocked month stops its partition from being made.
    await runtime.query(`INSERT INTO audit_log (action, outcome, occurred_at) VALUES ('ROLE_ITEST_STRAY', 'SUCCESS', $1)`, [month]);

    const result = await runtime.query<{ made: number; failed: string[] }>('SELECT made, failed FROM ensure_audit_partitions()');

    expect(result.rows[0]?.made).toBe(1);
    expect(result.rows[0]?.failed).toHaveLength(1);
    expect(result.rows[0]?.failed[0]).toMatch(new RegExp(`^${month.toISOString().slice(0, 7)}: `));
    expect((await owner.query('SELECT 1 FROM pg_class WHERE relname = $1', [later])).rowCount).toBe(1);
    // Put it right the way docs/ops/audit-log.md says, so later tests see a clean log.
    await owner.query('BEGIN');
    await owner.query('ALTER TABLE audit_log DETACH PARTITION audit_log_default');
    await owner.query(`SELECT audit_log_month_partition($1::date)`, [month.toISOString().slice(0, 10)]);
    await owner.query('INSERT INTO audit_log SELECT * FROM audit_log_default');
    await owner.query('DELETE FROM audit_log_default');
    await owner.query('ALTER TABLE audit_log ATTACH PARTITION audit_log_default DEFAULT');
    await owner.query('COMMIT');
    expect((await owner.query(`SELECT 1 FROM ${blocked} WHERE action = 'ROLE_ITEST_STRAY'`)).rowCount).toBe(1);
  });

  it('drops only months past six years, even when the setting asks for less, and records the drop first', async () => {
    await owner.query(`INSERT INTO system_settings (key, value, type, category) VALUES ('audit.retention_years', '1', 'number', 'audit')
                       ON CONFLICT (key) DO UPDATE SET value = '1'`);
    const sevenYearsAgo = auditPartition(-7 * 12);
    const fiveYearsAgo = auditPartition(-5 * 12);
    await owner.query(`SELECT audit_log_month_partition(((now() AT TIME ZONE 'UTC') - interval '7 years')::date)`);
    await owner.query(`SELECT audit_log_month_partition(((now() AT TIME ZONE 'UTC') - interval '5 years')::date)`);

    expect(await failureCode(owner, `SELECT drop_expired_audit_partitions('  ')`)).toBe('22023');
    const dropped = await owner.query<{ n: number }>(`SELECT drop_expired_audit_partitions('itest retention') AS n`);
    expect(dropped.rows[0]?.n).toBe(1);

    const left = await owner.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'audit_log'::regclass AND c.relname = ANY($1)`, [[sevenYearsAgo, fiveYearsAgo]]);
    expect(left.rows.map((r) => r.name)).toEqual([fiveYearsAgo]);
    const record = await owner.query<{ attributes: { partitions: string[]; retentionYears: number; reason: string } }>(
      `SELECT attributes FROM audit_log WHERE action = 'AUDIT_PARTITIONS_DROPPED' ORDER BY occurred_at DESC LIMIT 1`);
    expect(record.rows[0]?.attributes).toMatchObject({ partitions: [sevenYearsAgo], retentionYears: 6, reason: 'itest retention' });
  });

  it('cannot alter, truncate or drop an application table, or create one', async () => {
    expect(await failureCode(runtime, 'ALTER TABLE messages ADD COLUMN itest_col integer')).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode(runtime, 'ALTER TABLE events DISABLE TRIGGER ALL')).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode(runtime, 'TRUNCATE events')).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode(runtime, 'TRUNCATE messages')).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode(runtime, 'DROP TABLE channels')).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode(runtime, 'DROP TABLE messages_default')).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode(runtime, 'CREATE TABLE itest_scratch (id integer)')).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode(runtime, 'DROP FUNCTION create_channel_partitions(uuid)')).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode(runtime, 'DROP FUNCTION purge_events(integer)')).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('cannot alter or drop a partition the server created for a channel', async () => {
    const channelId = await newChannel(runtime);
    await runtime.query('SELECT create_channel_partitions($1::uuid)', [channelId]);
    const partition = `messages_p_${channelId.replace(/-/g, '_')}`;

    expect(await failureCode(runtime, `ALTER TABLE "${partition}" ADD COLUMN itest_col integer`)).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await failureCode(runtime, `DROP TABLE "${partition}"`)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('takes over the pg-boss schema the owner created, and pg-boss runs as the runtime role', async () => {
    const foreign = await owner.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c WHERE c.relnamespace = $1::regnamespace AND c.relowner <> $2::regrole
       UNION ALL SELECT p.proname FROM pg_proc p WHERE p.pronamespace = $1::regnamespace AND p.proowner <> $2::regrole
       UNION ALL SELECT t.typname FROM pg_type t WHERE t.typnamespace = $1::regnamespace AND t.typowner <> $2::regrole
       UNION ALL SELECT n.nspname FROM pg_namespace n WHERE n.oid = $1::regnamespace AND n.nspowner <> $2::regrole`,
      [PG_BOSS_SCHEMA, ROLE],
    );
    expect(foreign.rows.map((r) => r.name)).toEqual([]);

    await withBoss(urlFor(DB_NAME, ROLE, ROLE_PASSWORD), async (boss) => {
      // The job the owner queued before the split is still there.
      const [old] = await boss.fetch(OLD_QUEUE);
      expect(old?.data).toEqual({ from: 'owner' });
      await boss.complete(OLD_QUEUE, old?.id ?? '');

      // What the pruner scheduler does at startup, and a maintenance pass (REINDEX included).
      await boss.createQueue('itest-after-split');
      await boss.schedule('itest-after-split', '0 3 * * *', {});
      await boss.send('itest-after-split', { from: 'runtime' });
      await boss.supervise();
    });
  });

  it('runs the seed (admin user, roles, settings, demo channels and messages) as the runtime role', async () => {
    const run = await runSeedAs(urlFor(DB_NAME, ROLE, ROLE_PASSWORD));
    expect(run.code, run.output).toBe(0);

    const counts = await owner.query<{ users: string; messages: string }>(
      'SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM messages) AS messages',
    );
    expect(Number(counts.rows[0]?.users)).toBeGreaterThan(0);
    expect(Number(counts.rows[0]?.messages)).toBeGreaterThan(0);

    // The first admin holds the admin role the migration created (D-310).
    const admin = await owner.query<{ name: string }>(
      `SELECT r.name FROM users u JOIN assignments a ON a.user_id = u.id JOIN roles r ON r.id = a.role_id
       WHERE u.username = 'admin' AND r.admin`,
    );
    expect(admin.rows.map((r) => r.name)).toEqual(['admin']);

    // The seed wrote that assignment directly, so it recorded a grant baseline holding it
    // (migration 0022): the access replay starts from there.
    const baseline = await owner.query<{ held: boolean }>(
      `SELECT l.attributes->'assignments' @> jsonb_build_array(jsonb_build_object('userId', u.id)) AS held
       FROM audit_log l, users u WHERE l.action = 'GRANT_BASELINE' AND u.username = 'admin' ORDER BY l.occurred_at DESC, l.id DESC LIMIT 1`,
    );
    expect(baseline.rows[0]?.held).toBe(true);
  }, 120_000);

  it('PartitionManagerService creates a channel\'s partitions as the runtime role', async () => {
    // lib/db.ts reads DATABASE_URL when first imported, and each test file has
    // its own module registry, so this file's server modules use the runtime role.
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = urlFor(DB_NAME, ROLE, ROLE_PASSWORD);
    const [{ PartitionManagerService }, { pool }] = await Promise.all([
      import('../../src/services/partition-manager.service.js'),
      import('../../src/lib/db.js'),
    ]);
    process.env.DATABASE_URL = saved;
    try {
      const user = await pool.query<{ name: string }>('SELECT current_user AS name');
      expect(user.rows[0]?.name).toBe(ROLE);

      const channelId = await newChannel(runtime);
      const created = await PartitionManagerService.createPartitions(channelId);
      expect(created.ok, created.ok ? '' : created.error.message).toBe(true);
      const exists = await PartitionManagerService.partitionExists(channelId);
      expect(exists.ok && exists.value).toBe(true);
    } finally {
      await pool.end();
    }
  });
});
