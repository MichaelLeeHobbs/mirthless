import { describe, it, expect } from 'vitest';
import type { SystemInfo } from '../../hooks/use-system-info.js';
import { diagnosticsText, formatBytes, formatUptime, healthCells, percentOf, usageLevel, type HealthCell } from '../system-health.js';

const GB = 2 ** 30;
const MB = 2 ** 20;

function info(overrides: { [K in keyof SystemInfo]?: Partial<SystemInfo[K]> } = {}): SystemInfo {
  return {
    server: { version: '0.1.0', nodeVersion: 'v24.1.0', env: 'production', pid: 42, uptime: 93_784, startedAt: '2026-10-26T10:00:00.000Z', hostname: 'mirth-01', ...overrides.server },
    os: { platform: 'linux', release: '6.8.0', arch: 'x64', cpus: 8, loadAverage: [0.5, 0.4, 0.3], totalMemory: 16 * GB, freeMemory: 8 * GB, ...overrides.os },
    memory: { rss: 512 * MB, heapUsed: 200 * MB, heapTotal: 300 * MB, heapLimit: 4 * GB, external: 12 * MB, ...overrides.memory },
    engine: { deployed: 4, started: 4, stopped: 0, paused: 0, ...overrides.engine },
    database: { connected: true, latencyMs: 3.2, version: '17.2', sizeBytes: 2 * GB, ...overrides.database },
  };
}

function cell(i: SystemInfo, key: HealthCell['key']): HealthCell {
  const found = healthCells(i).find((c) => c.key === key);
  if (!found) throw new Error(`no ${key} cell`);
  return found;
}

describe('formatting', () => {
  it('formats bytes in binary units and caps at TB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * GB)).toBe('2.0 GB');
    expect(formatBytes(3 * 1024 ** 5)).toBe('3072.0 TB');
  });

  it('formats uptime as days, hours and minutes, always showing minutes', () => {
    expect(formatUptime(93_784)).toBe('1d 2h 3m');
    expect(formatUptime(30)).toBe('0m');
    expect(formatUptime(86_400)).toBe('1d 0m');
  });

  it('treats an unknown total as zero percent and caps at 100', () => {
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(150, 100)).toBe(100);
  });

  it('rates usage healthy below 75%, warning from 75% and critical from 90%', () => {
    expect(usageLevel(74.9)).toBe('healthy');
    expect(usageLevel(75)).toBe('warning');
    expect(usageLevel(90)).toBe('critical');
  });
});

describe('healthCells', () => {
  it('reads all healthy for a normal server, in strip order', () => {
    const cells = healthCells(info());
    expect(cells.map((c) => c.key)).toEqual(['server', 'database', 'engine', 'memory', 'host']);
    expect(cells.every((c) => c.level === 'healthy')).toBe(true);
    expect(cells[0]?.summary).toBe('v0.1.0 · up 1d 2h 3m');
  });

  it('marks an unreachable database critical', () => {
    const c = cell(info({ database: { connected: false, latencyMs: null, version: null, sizeBytes: null } }), 'database');
    expect(c).toMatchObject({ level: 'critical', word: 'Unreachable' });
  });

  it('marks a slow database as a warning and shows the round trip', () => {
    const c = cell(info({ database: { latencyMs: 400 } }), 'database');
    expect(c).toMatchObject({ level: 'warning', word: 'Slow', summary: 'PostgreSQL 17.2 · 400 ms' });
  });

  it('still describes a connected database whose version and latency are unknown', () => {
    expect(cell(info({ database: { version: null, latencyMs: null } }), 'database').summary).toBe('PostgreSQL');
  });

  it('calls an engine with nothing deployed idle, not healthy', () => {
    expect(cell(info({ engine: { deployed: 0, started: 0 } }), 'engine')).toMatchObject({ level: 'neutral', word: 'Idle' });
  });

  it('flags paused or stopped channels and counts them', () => {
    const c = cell(info({ engine: { deployed: 6, started: 4, paused: 1, stopped: 1 } }), 'engine');
    expect(c).toMatchObject({ level: 'warning', summary: '4 of 6 started · 1 paused · 1 stopped' });
  });

  it('rates heap against the V8 limit, not the current heap size', () => {
    // heapUsed is 95% of heapTotal, which is normal; it is 5% of the limit.
    expect(cell(info({ memory: { heapUsed: 285 * MB, heapTotal: 300 * MB } }), 'memory').level).toBe('healthy');
    expect(cell(info({ memory: { heapUsed: 3.8 * GB } }), 'memory')).toMatchObject({ level: 'critical', word: 'Critical' });
    expect(cell(info({ memory: { heapUsed: 3.2 * GB } }), 'memory').word).toBe('High');
  });

  it('flags a host whose memory is nearly full or whose load exceeds its CPUs', () => {
    expect(cell(info({ os: { freeMemory: 1 * GB } }), 'host').level).toBe('critical');
    expect(cell(info({ os: { freeMemory: 3 * GB } }), 'host').level).toBe('warning');
    expect(cell(info({ os: { loadAverage: [9, 8, 7] } }), 'host')).toMatchObject({ level: 'warning', word: 'Busy' });
  });

  it('ignores load average on Windows, where it is always zero', () => {
    const c = cell(info({ os: { platform: 'win32', loadAverage: [0, 0, 0] } }), 'host');
    expect(c.summary).toBe('Memory 50% used · 8 CPUs');
  });

  it('does not divide by zero when the CPU count is unknown', () => {
    expect(cell(info({ os: { cpus: 0, loadAverage: [3, 3, 3] } }), 'host').level).toBe('healthy');
  });
});

describe('diagnosticsText', () => {
  const now = new Date('2026-10-27T12:00:00.000Z');

  it('summarises every section on one line each', () => {
    const text = diagnosticsText(info(), now);
    expect(text).toContain('GalvaniFlow system information (2026-10-27T12:00:00.000Z)');
    expect(text).toContain('Database   connected · PostgreSQL 17.2 · 3.2 ms · 2.0 GB');
    expect(text).toContain('load 0.50 / 0.40 / 0.30');
    expect(text).toContain('pid 42 on mirth-01');
  });

  it('says plainly when the database is unreachable', () => {
    expect(diagnosticsText(info({ database: { connected: false } }), now)).toContain('Database   UNREACHABLE');
  });

  it('marks unknown database details and Windows load average', () => {
    const text = diagnosticsText(info({ database: { version: null, latencyMs: null, sizeBytes: null }, os: { platform: 'win32' } }), now);
    expect(text).toContain('PostgreSQL unknown · ? ms · size unknown');
    expect(text).toContain('load n/a');
  });
});
