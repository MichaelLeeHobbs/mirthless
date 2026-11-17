// ===========================================
// Integration Test Harness (real Postgres)
// ===========================================
// Shared gate + lazy module loader for the *.itest.ts suites.
//
// Gating: integration tests only run when DATABASE_URL points at a database
// whose name ends in `_test`. This protects developer/prod databases from the
// destructive inserts/deletes these suites perform, and lets the suites skip
// gracefully when no test DB is configured (e.g. a plain `pnpm test:integration`
// on a machine without Postgres). CI sets DATABASE_URL to the `galvanigraph_test`
// service DB, so the suites run there.

import { randomUUID } from 'node:crypto';
import { describe } from 'vitest';

/** True when DATABASE_URL targets a `*_test` database. */
function isTestDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  try {
    const name = new URL(url).pathname.replace(/^\//, '');
    return /_test$/i.test(name);
  } catch {
    return false;
  }
}

export const shouldRunIntegration = isTestDatabaseConfigured();

/** `describe` when a test DB is configured, otherwise `describe.skip`. */
export const describeIntegration = shouldRunIntegration ? describe : describe.skip;

if (!shouldRunIntegration) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integration] Skipping real-DB suites: set DATABASE_URL to a *_test database to run them.',
  );
}

/**
 * Lazily import the server modules under test plus Drizzle helpers. Deferred so
 * that when the suites are skipped, config validation (which reads env and can
 * process.exit on a missing DATABASE_URL) never runs.
 */
export async function loadServerModules() {
  const [dbMod, schemaMod, drizzleMod, messageMod, queueMod, channelMod, partitionMod, prunerMod, collectionMod, dataSourceMod, poolMgrMod] =
    await Promise.all([
      import('../../src/lib/db.js'),
      import('../../src/db/schema/index.js'),
      import('drizzle-orm'),
      import('../../src/services/message.service.js'),
      import('../../src/services/queue-manager.service.js'),
      import('../../src/services/channel.service.js'),
      import('../../src/services/partition-manager.service.js'),
      import('../../src/services/data-pruner.service.js'),
      import('../../src/services/collection.service.js'),
      import('../../src/services/data-source.service.js'),
      import('../../src/services/data-source-pool-manager.js'),
    ]);
  const crossChannelMod = await import('../../src/services/cross-channel-search.service.js');

  return {
    db: dbMod.db,
    pool: dbMod.pool,
    schema: schemaMod,
    sql: drizzleMod.sql,
    eq: drizzleMod.eq,
    and: drizzleMod.and,
    MessageService: messageMod.MessageService,
    QueueManagerService: queueMod.QueueManagerService,
    ChannelService: channelMod.ChannelService,
    PartitionManagerService: partitionMod.PartitionManagerService,
    DataPrunerService: prunerMod.DataPrunerService,
    CollectionService: collectionMod.CollectionService,
    DataSourceService: dataSourceMod.DataSourceService,
    dataSourcePoolManager: poolMgrMod.dataSourcePoolManager,
    CrossChannelSearchService: crossChannelMod.CrossChannelSearchService,
  };
}

export type ServerModules = Awaited<ReturnType<typeof loadServerModules>>;

/**
 * Insert a bare channel row with this id. `create_channel_partitions` refuses an
 * id with no channel, so a suite that makes partitions directly needs one.
 * Remove it with `deleteTestChannel`.
 */
export async function insertTestChannel(mods: ServerModules, id: string): Promise<void> {
  await mods.db.execute(mods.sql`
    INSERT INTO channels (id, name, inbound_data_type, outbound_data_type, source_connector_type, source_connector_properties)
    VALUES (${id}, ${`itest-${id}`}, 'RAW', 'RAW', 'CHANNEL', '{}'::jsonb)`);
}

/** Who a suite acts as: services that create channels place them in the actor's scope (D-310). */
export interface TestActor {
  readonly userId: string;
  readonly ipAddress: null;
}

/** A new user holding the admin role on every channel, to act as. */
export async function adminActor(pool: ServerModules['pool']): Promise<TestActor> {
  const name = `itest-admin-${randomUUID().slice(0, 8)}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'not-a-hash') RETURNING id`, [name, `${name}@example.test`],
  );
  const userId = rows[0]!.id;
  await pool.query(`INSERT INTO assignments (user_id, role_id, all_channels) SELECT $1, id, true FROM roles WHERE admin`, [userId]);
  return { userId, ipAddress: null };
}

/** A signed-in test user: their id and an access token for the API. */
export interface TestUser {
  readonly id: string;
  readonly token: string;
}

/**
 * A new user holding `role` on every channel (`groupIds` null) or on each of
 * `groupIds` (one assignment per group), with a live session and token.
 * The caller deletes the user (assignments and sessions cascade).
 */
export async function userWithRole(pool: ServerModules['pool'], role: string, groupIds: readonly string[] | null): Promise<TestUser> {
  const { signAccessToken } = await import('../../src/lib/jwt.js');
  const name = `itest-user-${randomUUID().slice(0, 8)}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'not-a-hash') RETURNING id`, [name, `${name}@example.test`],
  );
  const id = rows[0]!.id;
  for (const groupId of groupIds ?? [null]) {
    const assigned = await pool.query<{ id: string }>(
      `INSERT INTO assignments (user_id, role_id, all_channels) SELECT $1, id, $3 FROM roles WHERE name = $2 RETURNING id`,
      [id, role, groupId === null],
    );
    if (groupId !== null) await pool.query('INSERT INTO assignment_groups (assignment_id, channel_group_id) VALUES ($1, $2)', [assigned.rows[0]!.id, groupId]);
  }
  const session = await pool.query<{ id: string }>(
    `INSERT INTO sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, now() + interval '1 hour') RETURNING id`, [id, `itest-${randomUUID()}`],
  );
  return { id, token: signAccessToken({ userId: id, sessionId: session.rows[0]!.id }) };
}

/** A new channel group; the caller deletes it. */
export async function insertTestGroup(pool: ServerModules['pool']): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('INSERT INTO channel_groups (name) VALUES ($1) RETURNING id', [`itest-group-${randomUUID().slice(0, 8)}`]);
  return rows[0]!.id;
}

/** An API answer: its status and parsed JSON body (empty for 204). */
export interface ApiAnswer<T> {
  readonly status: number;
  readonly json: { readonly data?: T; readonly error?: { readonly code?: string; readonly message?: string; readonly details?: { readonly missing?: string[] } } };
}

/** Call `/api/v1<path>` on a test server at `base` as the holder of `token`. */
export async function apiCall<T = unknown>(base: string, token: string, method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: res.status === 204 ? {} : await res.json() as ApiAnswer<T>['json'] };
}

/** Delete a channel row made by `insertTestChannel`. */
export async function deleteTestChannel(mods: ServerModules, id: string): Promise<void> {
  await mods.db.execute(mods.sql`DELETE FROM channels WHERE id = ${id}`);
}

/** Minimal structural view of a stderr-lib Result for unwrapping in tests. */
type ResultLike<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } };

/** Unwrap a Result<T>, failing the test loudly if it is an error. */
export function unwrap<T>(result: ResultLike<T>): T {
  if (!result.ok) {
    throw new Error(`Expected Ok Result, got error: ${result.error.message}`);
  }
  return result.value;
}
