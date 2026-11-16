// ===========================================
// Runtime database role: unit tests
// ===========================================
// The SQL itself runs against real Postgres in test/integration/runtime-role.itest.ts.
// These cover the decisions around it with a fake pg client.

import { describe, expect, it } from 'vitest';
import { checkRuntimeRole, provisionRuntimeRole, runtimeRoleFromUrl, type SqlClient } from '../runtime-role.js';

interface QuoteRow {
  role: string; password: string; database: string; is_owner: boolean; exists: boolean; too_powerful: boolean;
}

const QUOTED: QuoteRow = {
  role: 'galvaniflow_app', password: "'secret'", database: 'galvaniflow',
  is_owner: false, exists: false, too_powerful: false,
};

/** A pg client that answers the role lookup with `rows`, records every statement, and fails on `failOn`. */
function fakeClient(rows: readonly object[], failOn?: string): { client: SqlClient; statements: string[] } {
  const statements: string[] = [];
  const query = async (text: string): Promise<{ rows: readonly object[] }> => {
    statements.push(text);
    if (failOn !== undefined && text.startsWith(failOn)) throw new Error(`failed: ${failOn}`);
    return { rows: text.startsWith('SELECT') ? rows : [] };
  };
  return { client: { query } as unknown as SqlClient, statements };
}

describe('provisionRuntimeRole', () => {
  it('creates a missing role, sets its password and grants in one transaction', async () => {
    const { client, statements } = fakeClient([QUOTED]);

    const result = await provisionRuntimeRole(client, { user: 'galvaniflow_app', password: 'secret' });

    expect(result.ok).toBe(true);
    expect(statements.slice(1, 4)).toEqual([
      'BEGIN',
      'CREATE ROLE galvaniflow_app LOGIN',
      "ALTER ROLE galvaniflow_app PASSWORD 'secret'",
    ]);
    expect(statements).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO galvaniflow_app');
    expect(statements).toContain('REVOKE UPDATE ON TABLE public.events FROM galvaniflow_app');
    expect(statements).toContain('GRANT EXECUTE ON FUNCTION public.create_channel_partitions(uuid) TO galvaniflow_app');
    expect(statements.at(-2)).toMatch(/^DO \$pgboss\$/);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements.some((s) => /TRUNCATE|REFERENCES|TRIGGER|CREATE ON SCHEMA/.test(s) && s.startsWith('GRANT'))).toBe(false);
  });

  it('leaves an existing role in place and its password alone when none is given', async () => {
    const { client, statements } = fakeClient([{ ...QUOTED, exists: true }]);

    const result = await provisionRuntimeRole(client, { user: 'galvaniflow_app', password: '' });

    expect(result.ok).toBe(true);
    expect(statements.some((s) => s.startsWith('CREATE ROLE') || s.startsWith('ALTER ROLE'))).toBe(false);
  });

  it('refuses the role that runs migrations, before changing anything', async () => {
    const { client, statements } = fakeClient([{ ...QUOTED, is_owner: true }]);

    const result = await provisionRuntimeRole(client, { user: 'galvaniflow', password: 'secret' });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('runs migrations');
    expect(statements).toHaveLength(1);
  });

  it('refuses a role with superuser or other cluster-wide powers instead of weakening it', async () => {
    const { client, statements } = fakeClient([{ ...QUOTED, exists: true, too_powerful: true }]);

    const result = await provisionRuntimeRole(client, { user: 'admin', password: 'secret' });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('superuser');
    expect(statements).toHaveLength(1);
  });

  it('refuses an empty role name without querying', async () => {
    const { client, statements } = fakeClient([QUOTED]);

    const result = await provisionRuntimeRole(client, { user: '', password: 'secret' });

    expect(result.ok).toBe(false);
    expect(statements).toHaveLength(0);
  });

  it('rolls back and returns the error when a grant fails', async () => {
    const { client, statements } = fakeClient([QUOTED], 'GRANT EXECUTE');

    const result = await provisionRuntimeRole(client, { user: 'galvaniflow_app', password: 'secret' });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('GRANT EXECUTE');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });

  it('returns an error when the role lookup returns no row', async () => {
    const { client } = fakeClient([]);

    const result = await provisionRuntimeRole(client, { user: 'galvaniflow_app', password: 'secret' });

    expect(result.ok).toBe(false);
  });
});

describe('checkRuntimeRole', () => {
  it('passes a role that is neither a superuser nor has the owner\'s rights', async () => {
    const { client } = fakeClient([{ name: 'galvaniflow_app', superuser: false, owner_rights: false }]);

    expect((await checkRuntimeRole(client)).ok).toBe(true);
  });

  it('fails a superuser connection', async () => {
    const { client } = fakeClient([{ name: 'galvaniflow', superuser: true, owner_rights: true }]);

    const result = await checkRuntimeRole(client);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('"galvaniflow", which is a superuser');
  });

  it('fails a connection with the rights of the table owner', async () => {
    const { client } = fakeClient([{ name: 'owner', superuser: false, owner_rights: true }]);

    const result = await checkRuntimeRole(client);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('the owner of the application tables');
  });

  it('fails when the current role cannot be read', async () => {
    const { client } = fakeClient([]);

    expect((await checkRuntimeRole(client)).ok).toBe(false);
  });
});

describe('runtimeRoleFromUrl', () => {
  it('reads the user and the decoded password', () => {
    const result = runtimeRoleFromUrl('postgresql://galvaniflow_app:p%40ss%2Fword@db:5432/galvaniflow');

    expect(result.ok && result.value).toEqual({ user: 'galvaniflow_app', password: 'p@ss/word' });
  });

  it('reads an empty password when the URL has none', () => {
    const result = runtimeRoleFromUrl('postgresql://galvaniflow_app@db:5432/galvaniflow');

    expect(result.ok && result.value).toEqual({ user: 'galvaniflow_app', password: '' });
  });

  it('fails a URL without a user name', () => {
    expect(runtimeRoleFromUrl('postgresql://db:5432/galvaniflow').ok).toBe(false);
  });

  it('fails a string that is not a URL', () => {
    expect(runtimeRoleFromUrl('not a url').ok).toBe(false);
  });
});
