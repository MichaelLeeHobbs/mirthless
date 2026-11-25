// The suites run only when DATABASE_URL names a database ending in `_test`, so
// their destructive inserts and deletes never touch a developer or production
// database; without one they skip.

import { randomUUID } from 'node:crypto';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IssuedApiKey } from '@galvanigraph/core-models';
import { describe, expect } from 'vitest';
import { INTEGRATION_WAIT_MS } from '../time-budgets.js';

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

export const describeIntegration = shouldRunIntegration ? describe : describe.skip;

if (!shouldRunIntegration) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integration] Skipping real-DB suites: set DATABASE_URL to a *_test database to run them.',
  );
}

/** A database connector and a data source give a connection 10 s, which is no setting, and a busy host can take longer (#444). */
async function allowSlowConnections(): Promise<void> {
  const { prototype } = (await import('@galvanigraph/connectors')).ConnectionPool;
  const create = prototype.create;
  prototype.create = function createWithTime(config) { return create.call(this, { ...config, connectionTimeoutMs: INTEGRATION_WAIT_MS }); };
}

/**
 * Deferred so that skipped suites never run config validation, which can
 * process.exit on a missing DATABASE_URL.
 */
export async function loadServerModules() {
  await allowSlowConnections();
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
 * `create_channel_partitions` refuses an id with no channel row, so a suite
 * that makes partitions directly needs one. Remove it with `deleteTestChannel`.
 */
export async function insertTestChannel(mods: ServerModules, id: string): Promise<void> {
  await mods.db.execute(mods.sql`
    INSERT INTO channels (id, name, inbound_data_type, outbound_data_type, source_connector_type, source_connector_properties)
    VALUES (${id}, ${`itest-${id}`}, 'RAW', 'RAW', 'CHANNEL', '{}'::jsonb)`);
}

/** Services that create channels place them in the actor's scope (D-310). */
export interface TestActor {
  readonly userId: string;
  readonly ipAddress: null;
}

export async function adminActor(pool: ServerModules['pool']): Promise<TestActor> {
  const name = `itest-admin-${randomUUID().slice(0, 8)}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'not-a-hash') RETURNING id`, [name, `${name}@example.test`],
  );
  const userId = rows[0]!.id;
  await pool.query(`INSERT INTO assignments (user_id, role_id, all_channels) SELECT $1, id, true FROM roles WHERE admin`, [userId]);
  return { userId, ipAddress: null };
}

export interface TestUser {
  readonly id: string;
  readonly token: string;
}

/**
 * Holds `role` on every channel (`groupIds` null) or on each of `groupIds`
 * (one assignment per group), or nothing (`role` null). The caller deletes the
 * user (assignments and sessions cascade).
 */
export async function userWithRole(pool: ServerModules['pool'], role: string | null, groupIds: readonly string[] | null): Promise<TestUser> {
  const { signAccessToken } = await import('../../src/lib/jwt.js');
  const name = `itest-user-${randomUUID().slice(0, 8)}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'not-a-hash') RETURNING id`, [name, `${name}@example.test`],
  );
  const id = rows[0]!.id;
  for (const groupId of role === null ? [] : groupIds ?? [null]) {
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

/** The caller deletes it. */
export async function insertTestGroup(pool: ServerModules['pool']): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('INSERT INTO channel_groups (name) VALUES ($1) RETURNING id', [`itest-group-${randomUUID().slice(0, 8)}`]);
  return rows[0]!.id;
}

/** For `vi.waitFor`. `expect.poll` has the same limit from the suite's config. */
export const WAIT = { timeout: INTEGRATION_WAIT_MS, interval: 20 } as const;

export async function listen(handler: RequestListener): Promise<{ readonly server: Server; readonly base: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return { server, base: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}` };
}

/** Undefined when the setup failed before `listen`. Waiting for that one never ends, and hides the setup's error (#405). */
export async function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined) return;
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
}

export interface ApiAnswer<T> {
  readonly status: number;
  readonly json: { readonly data?: T; readonly error?: { readonly code?: string; readonly message?: string; readonly details?: { readonly missing?: string[] } } };
}

export async function apiCall<T = unknown>(base: string, token: string, method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: res.status === 204 ? {} : await res.json() as ApiAnswer<T>['json'] };
}

/** On every channel, for 30 days. The caller deletes the key's user before its issuer. */
export async function issueKey(base: string, as: TestUser, permissions: readonly string[]): Promise<IssuedApiKey> {
  const res = await apiCall<IssuedApiKey>(base, as.token, 'POST', '/api-keys', {
    name: `itest-key-${randomUUID().slice(0, 8)}`, permissions, groupIds: null, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });
  expect(res.status).toBe(201);
  return res.json.data!;
}

export async function deleteTestChannel(mods: ServerModules, id: string): Promise<void> {
  await mods.db.execute(mods.sql`DELETE FROM channels WHERE id = ${id}`);
}

/** A blocked statement shows in pg_stat_activity as a Lock wait with the statement as its query. */
export async function waitForBlocked(pool: ServerModules['pool'], queryPrefix: string, timeoutMs = INTEGRATION_WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ waiting: string }>(
      `SELECT count(*) AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query ILIKE $1`,
      [`${queryPrefix}%`],
    );
    if (Number(rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No statement starting "${queryPrefix}" ever blocked on the locked row`);
}

type ResultLike<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } };

export function unwrap<T>(result: ResultLike<T>): T {
  if (!result.ok) {
    throw new Error(`Expected Ok Result, got error: ${result.error.message}`);
  }
  return result.value;
}
