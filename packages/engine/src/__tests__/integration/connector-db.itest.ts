// ===========================================
// Database destination connector — real Postgres
// ===========================================
// Sends a message through a channel whose destination is the Database dispatcher,
// then reads the row back from a real table to prove it landed.
// Runs only when DATABASE_URL points at a *_test database.

import { it, expect, beforeAll, afterAll } from 'vitest';
import { ConnectionPool, TcpMllpReceiver, DatabaseDispatcher, clearChannelRegistry } from '@mirthless/connectors';
import { deployChannel, teardownAll } from '../support/e2e-harness.js';
import { sendMllp } from '../support/tcp-helpers.js';
import { describeDb, requireDb } from './gates.js';

const TABLE = 'e2e_db_dest';
const PORT = 17731;

describeDb('Database destination connector (real Postgres)', () => {
  const pool = new ConnectionPool();

  beforeAll(async () => {
    const cfg = requireDb();
    const created = await pool.create({ ...cfg, maxConnections: 2 });
    if (!created.ok) throw created.error;
    await pool.query(`DROP TABLE IF EXISTS ${TABLE}`, []);
    await pool.query(`CREATE TABLE ${TABLE} (id serial PRIMARY KEY, message_id integer, payload text)`, []);
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${TABLE}`, []);
    await pool.destroy();
    clearChannelRegistry();
  });

  it('inserts the transformed message into a real table via the Database dispatcher', async () => {
    const cfg = requireDb();
    const dispatcher = new DatabaseDispatcher({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      username: cfg.user,
      password: cfg.password,
      query: `INSERT INTO ${TABLE} (message_id, payload) VALUES ($\{messageId}, $\{content})`,
      useTransaction: false,
      returnGeneratedKeys: false,
    });

    const channel = await deployChannel({
      channelId: '00000000-0000-0000-0000-conndb000001',
      dataType: 'RAW',
      source: new TcpMllpReceiver({ host: '127.0.0.1', port: PORT, maxConnections: 10 }),
      transformer: "return String(msg) + '::db';",
      destinations: [{ metaDataId: 1, name: 'DB Out', connector: dispatcher }],
    });

    try {
      await sendMllp(PORT, 'MSH|^~\\&|DBTEST');

      let rows: readonly Record<string, unknown>[] = [];
      for (let i = 0; i < 200; i++) {
        const r = await pool.query(`SELECT message_id, payload FROM ${TABLE}`, []);
        if (r.ok && r.value.rows.length > 0) { rows = r.value.rows; break; }
        await new Promise((res) => setTimeout(res, 10));
      }

      expect(rows).toHaveLength(1);
      expect(String(rows[0]?.payload)).toBe('MSH|^~\\&|DBTEST::db');
    } finally {
      await teardownAll([channel]);
    }
  });
});
