// ===========================================
// Runtime Database Role
// ===========================================
// The server connects to Postgres as a role that owns no tables (D-307). The
// owner (the role that runs migrations) creates that role and grants it what the
// server needs; the server image's entrypoint (docker/migrate.mjs) calls this
// module after migrating. It imports nothing from the app, so the entrypoint can
// load it without the server's configuration.

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
    // The audit trail is appended and purged (Events > Purge), never rewritten.
    `REVOKE UPDATE ON TABLE public.events FROM ${role}`,
    // nextval() for serial and bigserial ids.
    `GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    // A new channel's message partitions are created through this owner function.
    `GRANT EXECUTE ON FUNCTION public.create_channel_partitions(uuid) TO ${role}`,
    // Tables and sequences the owner creates later (partitions, the next
    // migration's tables) get the same grants without waiting for a restart.
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO ${role}`,
  ];
}

interface Quoted {
  readonly role: string;
  readonly password: string;
  readonly database: string;
  readonly isOwner: boolean;
  readonly exists: boolean;
  readonly tooPowerful: boolean;
}

async function quote(owner: SqlClient, spec: RuntimeRole): Promise<Quoted> {
  const result = await owner.query<{
    role: string; password: string; database: string; is_owner: boolean; exists: boolean; too_powerful: boolean;
  }>(
    `SELECT quote_ident($1::text) AS role, quote_literal($2::text) AS password,
            quote_ident(current_database()) AS database, $1::text = current_user::text AS is_owner,
            r.oid IS NOT NULL AS exists,
            coalesce(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls, false) AS too_powerful
     FROM (SELECT 1) AS one LEFT JOIN pg_roles r ON r.rolname::text = $1::text`,
    [spec.user, spec.password],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Could not read the runtime role from pg_roles');
  return {
    role: row.role, password: row.password, database: row.database,
    isOwner: row.is_owner, exists: row.exists, tooPowerful: row.too_powerful,
  };
}

/**
 * Create the runtime role if it is missing, set its password, and grant it the
 * server's privileges, in one transaction. Run as the role that owns the tables,
 * after migrating. Refuses a role that is the owner itself or has superuser,
 * CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS, rather than weakening it.
 */
export async function provisionRuntimeRole(owner: SqlClient, spec: RuntimeRole): Promise<Result<void>> {
  return tryCatch(async () => {
    if (spec.user.length === 0) throw new Error(`The runtime role has no name. See ${DOC}`);
    const q = await quote(owner, spec);
    if (q.isOwner) {
      throw new Error(`The runtime role ${q.role} is the role that runs migrations. Give the server its own role; see ${DOC}`);
    }
    if (q.tooPowerful) {
      throw new Error(`The runtime role ${q.role} has superuser, CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS. Use a plain login role; see ${DOC}`);
    }
    await owner.query('BEGIN');
    try {
      if (!q.exists) await owner.query(`CREATE ROLE ${q.role} LOGIN`);
      if (spec.password.length > 0) await owner.query(`ALTER ROLE ${q.role} PASSWORD ${q.password}`);
      for (const statement of grantStatements(q.role, q.database)) await owner.query(statement);
      await owner.query('COMMIT');
    } catch (err) {
      await owner.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * Fail when a connection has more than the runtime role's rights: it is a
 * superuser, or it owns (or is a member of the role that owns) an application
 * table. Run on the server's own connection before it starts.
 */
export async function checkRuntimeRole(runtime: SqlClient): Promise<Result<void>> {
  return tryCatch(async () => {
    const result = await runtime.query<{ name: string; superuser: boolean; owner_rights: boolean }>(
      `SELECT current_user AS name, r.rolsuper AS superuser,
              EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                        AND pg_has_role(current_user, c.relowner, 'USAGE')) AS owner_rights
       FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('Could not read the current role from pg_roles');
    if (row.superuser || row.owner_rights) {
      const why = row.superuser ? 'a superuser' : 'the owner of the application tables';
      throw new Error(`DATABASE_URL connects as "${row.name}", which is ${why}. The server must run as a role that owns no tables; see ${DOC}`);
    }
  });
}

/** The user and password in a postgres:// connection string. */
export function runtimeRoleFromUrl(databaseUrl: string): Result<RuntimeRole> {
  const parsed = URL.canParse(databaseUrl) ? new URL(databaseUrl) : null;
  if (!parsed || parsed.username.length === 0) {
    return { ok: false, value: null, error: stderr(new Error(`DATABASE_URL has no user name. See ${DOC}`)) };
  }
  return {
    ok: true,
    value: { user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) },
    error: null,
  };
}
