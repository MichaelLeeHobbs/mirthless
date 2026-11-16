// ===========================================
// Runtime Database Role
// ===========================================
// The server connects to Postgres as a role that owns no application tables (D-307). The
// owner (the role that runs migrations) creates that role and grants it what the
// server needs; the server image's entrypoint (docker/migrate.mjs) calls this
// module after migrating. It imports nothing from the app, so the entrypoint can
// load it without the server's configuration.

import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import type { ClientBase } from 'pg';
import { stderr, tryCatch, type Result } from 'stderr-lib';

/** A connection to run statements on. A pg Client; a transaction needs one connection. */
export type SqlClient = Pick<ClientBase, 'query'>;

/** The role the server logs in as, taken from its DATABASE_URL. */
export interface RuntimeRole {
  readonly user: string;
  /** Set as the role's password on every start. Empty leaves the password alone. */
  readonly password: string;
}

/** Where the upgrade steps for this live, for the error texts. */
const DOC = 'docs/ops/upgrade.md#database-roles';

/** The owner functions the runtime role may call (migration 0016). */
const OWNER_FUNCTIONS = ['public.create_channel_partitions(uuid)', 'public.purge_events(integer)'] as const;

/**
 * The runtime role's grants, after its quoted name. Each line is what the
 * server needs, and nothing grants TRUNCATE, REFERENCES, TRIGGER or CREATE.
 */
function grantStatements(role: string, database: string): readonly string[] {
  return [
    // Start from nothing, so a grant removed here is removed from the role too.
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
    `GRANT CONNECT ON DATABASE ${database} TO ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    // Read and write every application table, message partitions included.
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    // The audit trail is appended and read, never rewritten or deleted row by
    // row; Purge Old Events goes through purge_events(), which keeps the minimum age.
    `REVOKE UPDATE, DELETE ON TABLE public.events FROM ${role}`,
    // nextval() for serial and bigserial ids.
    `GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    // The owner functions: only this role may call them. Revoking from PUBLIC
    // again covers a restore made with --no-privileges, which drops the
    // migration's own REVOKE.
    ...OWNER_FUNCTIONS.flatMap((fn) => [
      `REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC`,
      `GRANT EXECUTE ON FUNCTION ${fn} TO ${role}`,
    ]),
    // Tables and sequences the owner creates later (partitions, the next
    // migration's tables) get the same grants without waiting for a restart.
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO ${role}`,
  ];
}

/** The schema pg-boss (lib/queue.ts) keeps its job queue in. Migration 0016 creates it. */
export const PG_BOSS_SCHEMA = 'pgboss';

/**
 * Hand the runtime role the pg-boss schema and every table, sequence, function
 * and type in it (on an install whose server ran as the owner, pg-boss created
 * them as the owner). pg-boss creates, migrates and maintains (REINDEX,
 * partitions) its own tables while the server runs, so it needs to own them;
 * the schema holds only the job queue (the pruner's cron job), and its owner can
 * change nothing outside it. Reads the role's name from the
 * `galvaniflow.runtime_role` setting so the name is never spliced into SQL.
 */
const PG_BOSS_SCHEMA_SQL = `DO $pgboss$
DECLARE
  app text := current_setting('galvaniflow.runtime_role');
  app_oid oid := (SELECT oid FROM pg_roles WHERE rolname = app);
  ns regnamespace := '${PG_BOSS_SCHEMA}'::regnamespace;
  ddl text;
BEGIN
  EXECUTE format('ALTER SCHEMA ${PG_BOSS_SCHEMA} OWNER TO %I', app);
  FOR ddl IN
    SELECT format('ALTER TABLE %s OWNER TO %I', c.oid::regclass, app) FROM pg_class c
     WHERE c.relnamespace = ns AND c.relkind IN ('r', 'p') AND c.relowner <> app_oid
    UNION ALL
    SELECT format('ALTER SEQUENCE %s OWNER TO %I', c.oid::regclass, app) FROM pg_class c
     WHERE c.relnamespace = ns AND c.relkind = 'S' AND c.relowner <> app_oid
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
                         AND d.objid = c.oid AND d.deptype IN ('a', 'i'))
    UNION ALL
    SELECT format('ALTER ROUTINE %s OWNER TO %I', p.oid::regprocedure, app) FROM pg_proc p
     WHERE p.pronamespace = ns AND p.proowner <> app_oid
    UNION ALL
    SELECT format('ALTER TYPE %s OWNER TO %I', t.oid::regtype, app) FROM pg_type t
     WHERE t.typnamespace = ns AND t.typtype IN ('e', 'd') AND t.typowner <> app_oid
  LOOP
    EXECUTE ddl;
  END LOOP;
END
$pgboss$`;

/**
 * A SCRAM-SHA-256 verifier for `password`, in the form Postgres stores
 * (`SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`, RFC 5802 and
 * RFC 7677). Setting it with ALTER ROLE ... PASSWORD keeps the password itself
 * off the wire and out of any statement log. NFKC stands in for SASLprep, which
 * is the same for the letters and digits the docs ask for; a password it
 * treats differently fails the startup check, which logs in with it.
 */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${String(iterations)}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

interface Quoted {
  readonly role: string;
  readonly verifier: string;
  readonly database: string;
  readonly isOwner: boolean;
  readonly exists: boolean;
  readonly tooPowerful: boolean;
  readonly memberOf: string | null;
}

async function quote(owner: SqlClient, spec: RuntimeRole): Promise<Quoted> {
  const result = await owner.query<{
    role: string; verifier: string; database: string; is_owner: boolean; exists: boolean;
    too_powerful: boolean; member_of: string | null;
  }>(
    `SELECT quote_ident($1::text) AS role, quote_literal($2::text) AS verifier,
            quote_ident(current_database()) AS database, $1::text = current_user::text AS is_owner,
            r.oid IS NOT NULL AS exists,
            coalesce(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls, false) AS too_powerful,
            (SELECT string_agg(g.rolname, ', ' ORDER BY g.rolname) FROM pg_auth_members m
               JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid) AS member_of
     FROM (SELECT 1) AS one LEFT JOIN pg_roles r ON r.rolname::text = $1::text`,
    [spec.user, spec.password.length > 0 ? scramVerifier(spec.password) : ''],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Could not read the runtime role from pg_roles');
  return {
    role: row.role, verifier: row.verifier, database: row.database, isOwner: row.is_owner,
    exists: row.exists, tooPowerful: row.too_powerful, memberOf: row.member_of,
  };
}

/** Why `q` may not be the runtime role, or null when it may. */
function refusal(q: Quoted): string | null {
  if (q.isOwner) return `The runtime role ${q.role} is the role that runs migrations. Give the server its own role`;
  if (q.tooPowerful) return `The runtime role ${q.role} has superuser, CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS. Use a plain login role`;
  // A member can SET ROLE to the other role even without inheriting its rights:
  // the owner, a superuser role, pg_read_server_files and the like.
  if (q.memberOf !== null) return `The runtime role ${q.role} is a member of ${q.memberOf}. It must be a member of no role`;
  return null;
}

/**
 * Create the runtime role if it is missing, set its password, grant it the
 * server's privileges and give it the pg-boss schema, in one transaction. Run as
 * the role that owns the tables, after migrating. Refuses a role that is the
 * owner itself, has superuser, CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS,
 * or is a member of any role, rather than weakening it.
 */
export async function provisionRuntimeRole(owner: SqlClient, spec: RuntimeRole): Promise<Result<void>> {
  return tryCatch(async () => {
    if (spec.user.length === 0) throw new Error(`The runtime role has no name. See ${DOC}`);
    const q = await quote(owner, spec);
    const refused = refusal(q);
    if (refused !== null) throw new Error(`${refused}; see ${DOC}`);
    await owner.query('BEGIN');
    try {
      if (!q.exists) await owner.query(`CREATE ROLE ${q.role} LOGIN`);
      if (spec.password.length > 0) await owner.query(`ALTER ROLE ${q.role} PASSWORD ${q.verifier}`);
      for (const statement of grantStatements(q.role, q.database)) await owner.query(statement);
      await owner.query(`SELECT set_config('galvaniflow.runtime_role', $1::text, true)`, [spec.user]);
      await owner.query(PG_BOSS_SCHEMA_SQL);
      await owner.query('COMMIT');
    } catch (err) {
      await owner.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * Fail when a connection has more than the runtime role's rights: it is a
 * superuser, it has the rights of the role that owns an application table, or
 * it is a member of any role (and so could SET ROLE to it). Run on the server's
 * own connection before it starts.
 */
export async function checkRuntimeRole(runtime: SqlClient): Promise<Result<void>> {
  return tryCatch(async () => {
    const result = await runtime.query<{ name: string; superuser: boolean; owner_rights: boolean; member_of: string | null }>(
      `SELECT current_user AS name, r.rolsuper AS superuser,
              EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                        AND pg_has_role(current_user, c.relowner, 'USAGE')) AS owner_rights,
              (SELECT string_agg(g.rolname, ', ' ORDER BY g.rolname) FROM pg_auth_members m
                 JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid) AS member_of
       FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('Could not read the current role from pg_roles');
    const why = row.superuser ? 'a superuser'
      : row.owner_rights ? 'the owner of the application tables'
        : row.member_of !== null ? `a member of ${row.member_of}` : null;
    if (why !== null) {
      throw new Error(`DATABASE_URL connects as "${row.name}", which is ${why}. The server must run as a role that owns no application tables and is a member of no role; see ${DOC}`);
    }
  });
}

/** The user and password in a postgres:// connection string. The error never holds the password. */
export function runtimeRoleFromUrl(databaseUrl: string): Result<RuntimeRole> {
  const parsed = URL.canParse(databaseUrl) ? new URL(databaseUrl) : null;
  if (!parsed || parsed.username.length === 0) {
    return { ok: false, value: null, error: stderr(new Error(`The connection URL has no user name. See ${DOC}`)) };
  }
  try {
    return {
      ok: true,
      value: { user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) },
      error: null,
    };
  } catch {
    return {
      ok: false,
      value: null,
      error: stderr(new Error(`The connection URL's user name or password has a "%" that is not followed by two hex digits; write it as %25. See ${DOC}`)),
    };
  }
}
