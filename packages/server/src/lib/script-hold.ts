// Run by the watchdog's thread, which must not load the server: no config, logger or pool here.

import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { channelDeployments } from '../db/schema/channel-deployments.js';

/** What a thread can be sent of the server's pool config. */
export interface WatchdogDb {
  readonly connectionString?: string | undefined;
  readonly ssl?: pg.PoolConfig['ssl'];
}

type Transaction = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

const CONNECT_TIMEOUT_MS = 3_000;
const STATEMENT_TIMEOUT_MS = 3_000;
/** All of it: the server takes no messages meanwhile. */
const HOLD_DEADLINE_MS = 8_000;

export function holdReason(graceMs: number, at: Date): string {
  return `A script of this channel was still running ${String(graceMs / 1_000)} s past its time limit at ${at.toISOString()}, so the server was restarted without the channel. A message it had not finished runs again on the next deploy, if its content is stored.`;
}

/** Drizzle's error names the query and its parameters; the reason is its cause. */
function reasonFor(err: unknown): unknown {
  return err instanceof Error && err.cause !== undefined ? err.cause : err;
}

/** One transaction, so a write given up on is never committed later. */
async function inTransaction<T>(db: WatchdogDb, run: (tx: Transaction) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    ...(db.connectionString === undefined ? {} : { connectionString: db.connectionString }),
    ...(db.ssl === undefined ? {} : { ssl: db.ssl }),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  // A connection that breaks later must not be an uncaught error.
  client.on('error', () => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`The database did not answer within ${String(HOLD_DEADLINE_MS / 1_000)} s`)); }, HOLD_DEADLINE_MS);
  });
  const work = async (): Promise<T> => {
    await client.connect();
    return drizzle(client).transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`);
      return run(tx);
    });
  };
  try {
    return await Promise.race([work(), deadline]);
  } catch (err: unknown) {
    throw reasonFor(err);
  } finally {
    clearTimeout(timer);
    void client.end().catch(() => {});
  }
}

/**
 * Whether a deployment of the channel was there to hold. An earlier hold keeps its reason, so
 * releasing this one leaves it. Rejects when it cannot be told in time.
 */
export function holdChannel(db: WatchdogDb, channelId: string, reason: string): Promise<boolean> {
  return inTransaction(db, async (tx) => {
    const held = await tx.update(channelDeployments)
      .set({ heldReason: sql`coalesce(${channelDeployments.heldReason}, ${reason})` })
      .where(eq(channelDeployments.channelId, channelId)).returning({ channelId: channelDeployments.channelId });
    return held.length > 0;
  });
}

/** Undoes `holdChannel`, unless a deploy or another hold has replaced it since. */
export function releaseChannel(db: WatchdogDb, channelId: string, reason: string): Promise<void> {
  return inTransaction(db, async (tx) => {
    await tx.update(channelDeployments).set({ heldReason: null })
      .where(and(eq(channelDeployments.channelId, channelId), eq(channelDeployments.heldReason, reason)));
  });
}
