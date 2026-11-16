// ===========================================
// Runtime database role: unit tests
// ===========================================
// The SQL itself runs against real Postgres in test/integration/runtime-role.itest.ts.
// These cover the decisions around it with a fake pg client.

import { describe, expect, it } from 'vitest';
import {
  checkRuntimeRole, provisionRuntimeRole, runtimeRoleFromUrl, scramVerifier, type SqlClient,
} from '../runtime-role.js';

interface QuoteRow {
  role: string; verifier: string; database: string; is_owner: boolean; exists: boolean;
  too_powerful: boolean; member_of: string | null;
}

const QUOTED: QuoteRow = {
  role: 'galvanigraph_app', verifier: "'SCRAM-SHA-256$4096:c2FsdA==$a2V5:a2V5'", database: 'galvanigraph',
  is_owner: false, exists: false, too_powerful: false, member_of: null,
};

/** A pg client that answers the role lookup with `rows`, records every statement and its values, and fails on `failOn`. */
function fakeClient(rows: readonly object[], failOn?: string): { client: SqlClient; statements: string[]; values: unknown[] } {
  const statements: string[] = [];
  const values: unknown[] = [];
  const query = async (text: string, params?: unknown[]): Promise<{ rows: readonly object[] }> => {
    statements.push(text);
    values.push(...(params ?? []));
    if (failOn !== undefined && text.startsWith(failOn)) throw new Error(`failed: ${failOn}`);
    return { rows: text.startsWith('SELECT') ? rows : [] };
  };
  return { client: { query } as unknown as SqlClient, statements, values };
}

describe('scramVerifier', () => {
  it('matches the verifier Postgres 17 stored for the same password and salt', () => {
    // From `CREATE ROLE ... PASSWORD 'vector-pass-1'` with password_encryption = scram-sha-256.
    const stored = 'SCRAM-SHA-256$4096:o09w3E82W1bonx9LtATiGw==$h//dR3pOk6SzOJ8ykOvYLVBYKj44cYtChlHmYbeii1U=:/kdllC/fdaiqjFNTs61j2FiJGuy8zTLHcD4z6KLU1Cc=';

    expect(scramVerifier('vector-pass-1', Buffer.from('o09w3E82W1bonx9LtATiGw==', 'base64'))).toBe(stored);
  });

  it('uses a new random salt each time', () => {
    expect(scramVerifier('same')).not.toBe(scramVerifier('same'));
  });
});

describe('provisionRuntimeRole', () => {
  it('creates a missing role, sets its password and grants in one transaction', async () => {
    const { client, statements } = fakeClient([QUOTED]);

    const result = await provisionRuntimeRole(client, { user: 'galvanigraph_app', password: 'secret' });

    expect(result.ok).toBe(true);
    expect(statements.slice(1, 4)).toEqual([
      'BEGIN',
      'CREATE ROLE galvanigraph_app LOGIN',
      `ALTER ROLE galvanigraph_app PASSWORD ${QUOTED.verifier}`,
    ]);
    expect(statements).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO galvanigraph_app');
    expect(statements).toContain('REVOKE UPDATE, DELETE ON TABLE public.events FROM galvanigraph_app');
    for (const fn of ['public.create_channel_partitions(uuid)', 'public.purge_events(integer)']) {
      expect(statements).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC`);
      expect(statements).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO galvanigraph_app`);
    }
    expect(statements.at(-2)).toMatch(/^DO \$pgboss\$/);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements.some((s) => /TRUNCATE|REFERENCES|TRIGGER|CREATE ON SCHEMA/.test(s) && s.startsWith('GRANT'))).toBe(false);
  });

  it('leaves an existing role in place and its password alone when none is given', async () => {
    const { client, statements } = fakeClient([{ ...QUOTED, exists: true }]);

    const result = await provisionRuntimeRole(client, { user: 'galvanigraph_app', password: '' });

    expect(result.ok).toBe(true);
    expect(statements.some((s) => s.startsWith('CREATE ROLE') || s.startsWith('ALTER ROLE'))).toBe(false);
  });

  it('refuses the role that runs migrations, before changing anything', async () => {
    const { client, statements } = fakeClient([{ ...QUOTED, is_owner: true }]);

    const result = await provisionRuntimeRole(client, { user: 'galvanigraph', password: 'secret' });

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

  it('refuses a role that is a member of another role, which it could SET ROLE to', async () => {
    const { client, statements } = fakeClient([{ ...QUOTED, exists: true, member_of: 'galvanigraph, pg_read_server_files' }]);

    const result = await provisionRuntimeRole(client, { user: 'galvanigraph_app', password: 'secret' });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('is a member of galvanigraph, pg_read_server_files');
    expect(statements).toHaveLength(1);
  });

  it('never sends the password itself, only a SCRAM verifier of it', async () => {
    const { client, statements, values } = fakeClient([QUOTED]);

    await provisionRuntimeRole(client, { user: 'galvanigraph_app', password: 'Pa55word-not-sent' });

    expect([...statements, ...values].some((s) => String(s).includes('Pa55word-not-sent'))).toBe(false);
    expect(values).toContainEqual(expect.stringMatching(/^SCRAM-SHA-256\$4096:/));
  });

  it('refuses an empty role name without querying', async () => {
    const { client, statements } = fakeClient([QUOTED]);

    const result = await provisionRuntimeRole(client, { user: '', password: 'secret' });

    expect(result.ok).toBe(false);
    expect(statements).toHaveLength(0);
  });

  it('rolls back and returns the error when a grant fails', async () => {
    const { client, statements } = fakeClient([QUOTED], 'GRANT EXECUTE');

    const result = await provisionRuntimeRole(client, { user: 'galvanigraph_app', password: 'secret' });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('GRANT EXECUTE');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });

  it('returns an error when the role lookup returns no row', async () => {
    const { client } = fakeClient([]);

    const result = await provisionRuntimeRole(client, { user: 'galvanigraph_app', password: 'secret' });

    expect(result.ok).toBe(false);
  });
});

describe('checkRuntimeRole', () => {
  it('passes a role that is neither a superuser nor has the owner\'s rights', async () => {
    const { client } = fakeClient([{ name: 'galvanigraph_app', superuser: false, owner_rights: false, member_of: null }]);

    expect((await checkRuntimeRole(client)).ok).toBe(true);
  });

  it('fails a superuser connection', async () => {
    const { client } = fakeClient([{ name: 'galvanigraph', superuser: true, owner_rights: true, member_of: null }]);

    const result = await checkRuntimeRole(client);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('"galvanigraph", which is a superuser');
  });

  it('fails a connection with the rights of the table owner', async () => {
    const { client } = fakeClient([{ name: 'owner', superuser: false, owner_rights: true, member_of: null }]);

    const result = await checkRuntimeRole(client);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('the owner of the application tables');
  });

  it('fails a connection whose role is a member of another role', async () => {
    const { client } = fakeClient([{ name: 'galvanigraph_app', superuser: false, owner_rights: false, member_of: 'galvanigraph' }]);

    const result = await checkRuntimeRole(client);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('which is a member of galvanigraph');
  });

  it('fails when the current role cannot be read', async () => {
    const { client } = fakeClient([]);

    expect((await checkRuntimeRole(client)).ok).toBe(false);
  });
});

describe('runtimeRoleFromUrl', () => {
  it('reads the user and the decoded password', () => {
    const result = runtimeRoleFromUrl('postgresql://galvanigraph_app:p%40ss%2Fword@db:5432/galvanigraph');

    expect(result.ok && result.value).toEqual({ user: 'galvanigraph_app', password: 'p@ss/word' });
  });

  it('reads an empty password when the URL has none', () => {
    const result = runtimeRoleFromUrl('postgresql://galvanigraph_app@db:5432/galvanigraph');

    expect(result.ok && result.value).toEqual({ user: 'galvanigraph_app', password: '' });
  });

  it('fails a URL without a user name', () => {
    expect(runtimeRoleFromUrl('postgresql://db:5432/galvanigraph').ok).toBe(false);
  });

  it('fails, without the password in the message, when a % is not followed by two hex digits', () => {
    const result = runtimeRoleFromUrl('postgresql://galvanigraph_app:abc%zzsecret@db:5432/galvanigraph');

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('%25');
    expect(result.error?.message).not.toContain('secret');
  });

  it('fails a string that is not a URL', () => {
    expect(runtimeRoleFromUrl('not a url').ok).toBe(false);
  });
});
