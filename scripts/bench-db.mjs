// ===========================================
// Database Latency Benchmark
// ===========================================
// Measures raw pg driver query latency to isolate Docker/network overhead
// from application-level overhead (Drizzle ORM, tryCatch, etc.).
//
// Usage: node scripts/bench-db.mjs

import { createRequire } from 'node:module';
const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
const pg = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://mirthless:mirthless_dev@localhost:5432/mirthless';
const ITERATIONS = 50;
const WARMUP = 5;

/** Build pool config — supports DATABASE_URL or individual PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE env vars. */
function buildPoolConfig() {
  if (process.env.PGHOST || process.env.PGUSER) {
    return {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT || '5432'),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'postgres',
      max: 5,
    };
  }
  return { connectionString: DATABASE_URL, max: 5 };
}

async function bench(label, fn) {
  const times = [];
  for (let i = 0; i < WARMUP + ITERATIONS; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  const data = times.slice(WARMUP);
  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const p50 = data.sort((a, b) => a - b)[Math.floor(data.length * 0.5)];
  const p95 = data.sort((a, b) => a - b)[Math.floor(data.length * 0.95)];
  console.log(`  ${label.padEnd(45)} avg=${avg.toFixed(2)}ms  p50=${p50.toFixed(2)}ms  p95=${p95.toFixed(2)}ms  min=${min.toFixed(2)}ms  max=${max.toFixed(2)}ms`);
  return avg;
}

async function main() {
  const pool = new pg.Pool(buildPoolConfig());

  // Verify connection
  const client = await pool.connect();
  const version = await client.query('SELECT version()');
  console.log(`Connected: ${version.rows[0].version.split(',')[0]}`);
  console.log(`URL: ${DATABASE_URL}`);
  console.log(`Iterations: ${ITERATIONS} (after ${WARMUP} warmup)\n`);
  client.release();

  // --- 1. Raw query latency ---
  console.log('=== Raw Query Latency ===');

  await bench('SELECT 1 (ping)', async () => {
    await pool.query('SELECT 1');
  });

  await bench('SELECT NOW()', async () => {
    await pool.query('SELECT NOW()');
  });

  // --- 2. Single INSERT + RETURNING ---
  console.log('\n=== Single Operations ===');

  // Create a temp table for benchmarking
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _bench_messages (
      id BIGSERIAL PRIMARY KEY,
      channel_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
      server_id VARCHAR(36) DEFAULT 'bench',
      received_at TIMESTAMPTZ DEFAULT NOW(),
      processed BOOLEAN DEFAULT false
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _bench_content (
      id BIGSERIAL PRIMARY KEY,
      message_id BIGINT NOT NULL,
      meta_data_id INT NOT NULL DEFAULT 0,
      content_type INT NOT NULL,
      content TEXT,
      data_type VARCHAR(20) DEFAULT 'RAW'
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _bench_connector (
      id BIGSERIAL PRIMARY KEY,
      message_id BIGINT NOT NULL,
      meta_data_id INT NOT NULL DEFAULT 0,
      status VARCHAR(20) DEFAULT 'RECEIVED',
      connector_name VARCHAR(255) DEFAULT 'Source'
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _bench_stats (
      channel_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
      meta_data_id INT NOT NULL DEFAULT 0,
      server_id VARCHAR(36) NOT NULL DEFAULT 'bench',
      received INT DEFAULT 0,
      PRIMARY KEY (channel_id, meta_data_id, server_id)
    )
  `);
  // Seed stats row
  await pool.query(`
    INSERT INTO _bench_stats (channel_id, meta_data_id, server_id, received)
    VALUES ('00000000-0000-0000-0000-000000000001', 0, 'bench', 0)
    ON CONFLICT DO NOTHING
  `);

  await bench('INSERT + RETURNING (messages)', async () => {
    await pool.query(
      `INSERT INTO _bench_messages (channel_id, server_id) VALUES ($1, $2) RETURNING id`,
      ['00000000-0000-0000-0000-000000000001', 'bench']
    );
  });

  await bench('INSERT (content)', async () => {
    await pool.query(
      `INSERT INTO _bench_content (message_id, content_type, content) VALUES ($1, $2, $3)`,
      [1, 1, 'test message content']
    );
  });

  await bench('UPDATE (status)', async () => {
    await pool.query(
      `UPDATE _bench_connector SET status = 'SENT' WHERE message_id = 1 AND meta_data_id = 0`
    );
  });

  await bench('UPSERT (stats increment)', async () => {
    await pool.query(`
      INSERT INTO _bench_stats (channel_id, meta_data_id, server_id, received)
      VALUES ('00000000-0000-0000-0000-000000000001', 0, 'bench', 1)
      ON CONFLICT (channel_id, meta_data_id, server_id)
      DO UPDATE SET received = _bench_stats.received + 1
    `);
  });

  // --- 3. Batched CTE (like our initializeMessage) ---
  console.log('\n=== Batched CTEs (pipeline-style) ===');

  await bench('CTE: create + connector + 2 content + stats', async () => {
    await pool.query(`
      WITH new_msg AS (
        INSERT INTO _bench_messages (channel_id, server_id)
        VALUES ('00000000-0000-0000-0000-000000000001', 'bench')
        RETURNING id
      ),
      new_connector AS (
        INSERT INTO _bench_connector (message_id, meta_data_id, status, connector_name)
        SELECT id, 0, 'RECEIVED', 'Source' FROM new_msg
      ),
      new_content AS (
        INSERT INTO _bench_content (message_id, content_type, content, data_type)
        SELECT id, 1, 'raw content here', 'RAW' FROM new_msg
        UNION ALL
        SELECT id, 9, '{}', 'JSON' FROM new_msg
      ),
      new_stats AS (
        INSERT INTO _bench_stats (channel_id, meta_data_id, server_id, received)
        VALUES ('00000000-0000-0000-0000-000000000001', 0, 'bench', 1)
        ON CONFLICT (channel_id, meta_data_id, server_id)
        DO UPDATE SET received = _bench_stats.received + 1
      )
      SELECT id FROM new_msg
    `);
  });

  await bench('CTE: finalize (update status + stats + processed)', async () => {
    await pool.query(`
      WITH update_connector AS (
        UPDATE _bench_connector SET status = 'SENT' WHERE message_id = 1 AND meta_data_id = 0
      ),
      update_stats AS (
        INSERT INTO _bench_stats (channel_id, meta_data_id, server_id, received)
        VALUES ('00000000-0000-0000-0000-000000000001', 0, 'bench', 1)
        ON CONFLICT (channel_id, meta_data_id, server_id)
        DO UPDATE SET received = _bench_stats.received + 1
      )
      UPDATE _bench_messages SET processed = true WHERE id = 1
    `);
  });

  // --- 4. Promise.all parallel (like our old approach) ---
  console.log('\n=== Promise.all parallel (old approach) ===');

  await bench('Promise.all(INSERT x3 + UPSERT)', async () => {
    const [msgResult] = await Promise.all([
      pool.query(`INSERT INTO _bench_messages (channel_id) VALUES ('00000000-0000-0000-0000-000000000001') RETURNING id`),
    ]);
    const msgId = msgResult.rows[0].id;
    await Promise.all([
      pool.query(`INSERT INTO _bench_connector (message_id) VALUES ($1)`, [msgId]),
      pool.query(`INSERT INTO _bench_content (message_id, content_type, content) VALUES ($1, 1, 'raw')`, [msgId]),
      pool.query(`INSERT INTO _bench_content (message_id, content_type, content) VALUES ($1, 9, '{}')`, [msgId]),
      pool.query(`
        INSERT INTO _bench_stats (channel_id, meta_data_id, server_id, received)
        VALUES ('00000000-0000-0000-0000-000000000001', 0, 'bench', 1)
        ON CONFLICT (channel_id, meta_data_id, server_id)
        DO UPDATE SET received = _bench_stats.received + 1
      `),
    ]);
  });

  // --- 5. Full pipeline simulation ---
  console.log('\n=== Full Pipeline Simulation ===');

  await bench('2-round-trip (CTE init + CTE finalize)', async () => {
    // Initialize
    await pool.query(`
      WITH new_msg AS (
        INSERT INTO _bench_messages (channel_id, server_id)
        VALUES ('00000000-0000-0000-0000-000000000001', 'bench')
        RETURNING id
      ),
      new_connector AS (
        INSERT INTO _bench_connector (message_id, meta_data_id, status, connector_name)
        SELECT id, 0, 'RECEIVED', 'Source' FROM new_msg
      ),
      new_content AS (
        INSERT INTO _bench_content (message_id, content_type, content, data_type)
        SELECT id, 1, 'raw content here', 'RAW' FROM new_msg
        UNION ALL
        SELECT id, 9, '{}', 'JSON' FROM new_msg
      ),
      new_stats AS (
        INSERT INTO _bench_stats (channel_id, meta_data_id, server_id, received)
        VALUES ('00000000-0000-0000-0000-000000000001', 0, 'bench', 1)
        ON CONFLICT (channel_id, meta_data_id, server_id)
        DO UPDATE SET received = _bench_stats.received + 1
      )
      SELECT id FROM new_msg
    `);
    // Finalize
    await pool.query(`
      WITH update_connector AS (
        UPDATE _bench_connector SET status = 'SENT' WHERE message_id = 1 AND meta_data_id = 0
      ),
      update_stats AS (
        INSERT INTO _bench_stats (channel_id, meta_data_id, server_id, received)
        VALUES ('00000000-0000-0000-0000-000000000001', 0, 'bench', 1)
        ON CONFLICT (channel_id, meta_data_id, server_id)
        DO UPDATE SET received = _bench_stats.received + 1
      )
      UPDATE _bench_messages SET processed = true WHERE id = 1
    `);
  });

  await bench('3-round-trip (init + store+update + finalize)', async () => {
    const r = await pool.query(`
      WITH new_msg AS (
        INSERT INTO _bench_messages (channel_id, server_id)
        VALUES ('00000000-0000-0000-0000-000000000001', 'bench')
        RETURNING id
      ),
      new_connector AS (
        INSERT INTO _bench_connector (message_id, meta_data_id, status, connector_name)
        SELECT id, 0, 'RECEIVED', 'Source' FROM new_msg
      ),
      new_content AS (
        INSERT INTO _bench_content (message_id, content_type, content, data_type)
        SELECT id, 1, 'raw content', 'RAW' FROM new_msg
        UNION ALL
        SELECT id, 9, '{}', 'JSON' FROM new_msg
      ),
      new_stats AS (
        INSERT INTO _bench_stats (channel_id, meta_data_id, server_id, received)
        VALUES ('00000000-0000-0000-0000-000000000001', 0, 'bench', 1)
        ON CONFLICT (channel_id, meta_data_id, server_id)
        DO UPDATE SET received = _bench_stats.received + 1
      )
      SELECT id FROM new_msg
    `);
    const msgId = r.rows[0].id;
    // Store transformed + update status
    await Promise.all([
      pool.query(`INSERT INTO _bench_content (message_id, content_type, content) VALUES ($1, 3, 'transformed')`, [msgId]),
      pool.query(`UPDATE _bench_connector SET status = 'TRANSFORMED' WHERE message_id = $1`, [msgId]),
    ]);
    // Finalize
    await pool.query(`
      WITH update_connector AS (
        UPDATE _bench_connector SET status = 'SENT' WHERE message_id = $1 AND meta_data_id = 0
      ),
      update_stats AS (
        INSERT INTO _bench_stats (channel_id, meta_data_id, server_id, received)
        VALUES ('00000000-0000-0000-0000-000000000001', 0, 'bench', 1)
        ON CONFLICT (channel_id, meta_data_id, server_id)
        DO UPDATE SET received = _bench_stats.received + 1
      )
      UPDATE _bench_messages SET processed = true WHERE id = $1
    `, [msgId]);
  });

  // Cleanup
  await pool.query('DROP TABLE IF EXISTS _bench_content, _bench_connector, _bench_messages, _bench_stats');
  await pool.end();

  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
