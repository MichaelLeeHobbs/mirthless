// ===========================================
// System Info Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mocks -----

const mockExecute = vi.fn();
const mockGetEngineStats = vi.fn();
const mockGetMemoryStats = vi.fn();

vi.mock('../../lib/db.js', () => ({ db: { execute: (...args: unknown[]) => mockExecute(...args) } }));

vi.mock('../health.service.js', () => ({
  getEngineStats: (...args: unknown[]) => mockGetEngineStats(...args),
  getMemoryStats: (...args: unknown[]) => mockGetMemoryStats(...args),
}));

const { SystemInfoService, probeDatabase } = await import('../system-info.service.js');

// ----- Tests -----

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rows: [{ version: '17.2', size: '73400320' }] });
  mockGetEngineStats.mockReturnValue({ deployed: 5, started: 3, stopped: 1, paused: 1 });
  mockGetMemoryStats.mockReturnValue({ rss: 100, heapUsed: 50, heapTotal: 80, external: 10 });
});

async function getInfo(): Promise<Awaited<ReturnType<typeof SystemInfoService.getInfo>> & { ok: true }> {
  const result = await SystemInfoService.getInfo();
  if (!result.ok) throw new Error('expected ok');
  return result;
}

describe('SystemInfoService.getInfo', () => {
  it('reports the server process: Node version, pid, start time and hostname', async () => {
    const { value } = await getInfo();
    expect(value.server.nodeVersion).toMatch(/^v\d+/);
    expect(value.server.pid).toBe(process.pid);
    expect(value.server.hostname.length).toBeGreaterThan(0);
    const startedMs = Date.parse(value.server.startedAt);
    expect(Math.abs(Date.now() - value.server.uptime * 1000 - startedMs)).toBeLessThan(2000);
  });

  it('reports host CPU count, load average and memory', async () => {
    const { value } = await getInfo();
    expect(value.os.platform.length).toBeGreaterThan(0);
    expect(value.os.cpus).toBeGreaterThan(0);
    expect(value.os.loadAverage).toHaveLength(3);
    expect(value.os.totalMemory).toBeGreaterThan(0);
  });

  it('adds the V8 heap ceiling to the process memory stats', async () => {
    const { value } = await getInfo();
    expect(value.memory.heapUsed).toBe(50);
    expect(value.memory.rss).toBe(100);
    expect(value.memory.heapLimit).toBeGreaterThan(value.memory.heapTotal);
  });

  it('includes engine stats', async () => {
    const { value } = await getInfo();
    expect(value.engine).toEqual({ deployed: 5, started: 3, stopped: 1, paused: 1 });
  });

  it('still answers when the database is down, reporting it disconnected', async () => {
    mockExecute.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { value } = await getInfo();
    expect(value.database).toEqual({ connected: false, latencyMs: null, version: null, sizeBytes: null });
  });
});

describe('probeDatabase', () => {
  it('returns the server version, database size and a round-trip time', async () => {
    const probe = await probeDatabase();
    expect(probe.connected).toBe(true);
    expect(probe.version).toBe('17.2');
    expect(probe.sizeBytes).toBe(73_400_320);
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports connected with unknown details when the query returns no row', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    const probe = await probeDatabase();
    expect(probe).toMatchObject({ connected: true, version: null, sizeBytes: null });
  });
});
