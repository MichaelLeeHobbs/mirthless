// ===========================================
// Scenario suite: a partner Postgres database
// ===========================================
// Scenarios that read from or write to "the hospital's database" use tables in
// a dedicated `partner` schema of the scenario database, never the app's own
// tables.

import pg from 'pg';

export const SCENARIO_DB_URL = process.env.SCENARIO_DATABASE_URL ?? '';

/** The same database as a Mirth JDBC URL, the form a Mirth export carries. */
export function jdbcUrl(): string {
  const u = new URL(SCENARIO_DB_URL);
  return `jdbc:postgresql://${u.hostname}:${u.port || '5432'}${u.pathname}`;
}

export function dbUser(): { username: string; password: string } {
  const u = new URL(SCENARIO_DB_URL);
  return { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
}

/** Run SQL against the scenario database. */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: SCENARIO_DB_URL });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS partner');
    const res = await client.query<T>(text, params);
    return res.rows;
  } finally {
    await client.end();
  }
}
