// What GET /metrics answers, through the app (#417). No database is reached.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DeployedChannel, EngineManager } from '../../engine.js';
import { ROUTE_TREE_LOAD_MS } from '../../../test/time-budgets.js';

let server: Server;
let url: string;
let engine: EngineManager;
let pool: typeof import('../../lib/db.js').pool;

beforeAll(async () => {
  process.env['METRICS_PUBLIC'] = 'true';
  const app = (await import('../../app.js')).default;
  engine = (await import('../../engine.js')).getEngine();
  pool = (await import('../../lib/db.js')).pool;
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/metrics`;
}, ROUTE_TREE_LOAD_MS);

afterAll(async () => {
  const running = server as Server | undefined;
  if (running) await new Promise<void>((resolve) => { running.close(() => { resolve(); }); });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function channelsIn(...states: readonly string[]): void {
  vi.spyOn(engine, 'getAll').mockReturnValue(new Map(states.map((state, i) => [
    `channel-${String(i)}`, { runtime: { getState: () => state } } as unknown as DeployedChannel,
  ])));
}

async function valueOf(metric: string): Promise<number> {
  const res = await fetch(url, { headers: { connection: 'close' } });
  expect(res.status).toBe(200);
  const line = (await res.text()).split('\n').find((l) => l.startsWith(`${metric} `));
  return Number(line?.split(' ')[1]);
}

describe('GET /metrics', () => {
  it('gives the deployed channels and those of them that are started, as they are now', async () => {
    channelsIn('STARTED', 'STARTED', 'STOPPED', 'PAUSED');
    expect(await valueOf('galvanigraph_deployed_channels')).toBe(4);
    expect(await valueOf('galvanigraph_started_channels')).toBe(2);

    channelsIn('STOPPED');
    expect(await valueOf('galvanigraph_deployed_channels')).toBe(1);
    expect(await valueOf('galvanigraph_started_channels')).toBe(0);
  });

  it('gives the open and the idle connections of the database pool, as they are now', async () => {
    vi.spyOn(pool, 'totalCount', 'get').mockReturnValue(7);
    vi.spyOn(pool, 'idleCount', 'get').mockReturnValue(3);

    expect(await valueOf('galvanigraph_db_pool_total')).toBe(7);
    expect(await valueOf('galvanigraph_db_pool_idle')).toBe(3);
  });

  it('gives the messages that were counted', async () => {
    const { messagesProcessedTotal } = await import('../../lib/metrics.js');
    const before = await valueOf('galvanigraph_messages_processed_total');

    messagesProcessedTotal.inc();

    expect(await valueOf('galvanigraph_messages_processed_total')).toBe(before + 1);
  });

  it('puts nothing of a channel or a message on the metrics of the engine', async () => {
    const res = await fetch(url, { headers: { connection: 'close' } });
    const lines = (await res.text()).split('\n').filter((l) => l.startsWith('galvanigraph_'));

    expect(lines).toHaveLength(5);
    expect(lines.filter((l) => l.includes('{'))).toEqual([]);
  });
});
