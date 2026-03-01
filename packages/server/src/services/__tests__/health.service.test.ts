// ===========================================
// Health Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Hoisted Mocks -----

const { mockExecute, mockGetAll } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockGetAll: vi.fn(),
}));

vi.mock('../../lib/db.js', () => ({
  db: { execute: mockExecute },
}));

vi.mock('../../engine.js', () => ({
  getEngine: vi.fn(() => ({
    getAll: mockGetAll,
  })),
}));

// ----- Import after mocks -----

import { checkDatabase, getEngineStats, getMemoryStats, getHealthStatus } from '../health.service.js';

// ----- Tests -----

describe('Health Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll.mockReturnValue(new Map());
  });

  // ----- checkDatabase -----

  describe('checkDatabase', () => {
    it('returns true when query succeeds', async () => {
      mockExecute.mockResolvedValue([{ '?column?': 1 }]);
      const result = await checkDatabase();
      expect(result).toBe(true);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('returns false when query fails', async () => {
      mockExecute.mockRejectedValue(new Error('Connection refused'));
      const result = await checkDatabase();
      expect(result).toBe(false);
    });

    it('returns false when query times out', async () => {
      mockExecute.mockRejectedValue(new Error('ETIMEDOUT'));
      const result = await checkDatabase();
      expect(result).toBe(false);
    });
  });

  // ----- getEngineStats -----

  describe('getEngineStats', () => {
    it('returns zeroes when no channels are deployed', () => {
      mockGetAll.mockReturnValue(new Map());
      const stats = getEngineStats();
      expect(stats).toEqual({ deployed: 0, started: 0, stopped: 0, paused: 0 });
    });

    it('counts started channels', () => {
      mockGetAll.mockReturnValue(new Map([
        ['ch-1', { runtime: { getState: () => 'STARTED' } }],
        ['ch-2', { runtime: { getState: () => 'STARTED' } }],
      ]));
      const stats = getEngineStats();
      expect(stats).toEqual({ deployed: 2, started: 2, stopped: 0, paused: 0 });
    });

    it('counts stopped channels', () => {
      mockGetAll.mockReturnValue(new Map([
        ['ch-1', { runtime: { getState: () => 'STOPPED' } }],
      ]));
      const stats = getEngineStats();
      expect(stats).toEqual({ deployed: 1, started: 0, stopped: 1, paused: 0 });
    });

    it('counts paused channels', () => {
      mockGetAll.mockReturnValue(new Map([
        ['ch-1', { runtime: { getState: () => 'PAUSED' } }],
      ]));
      const stats = getEngineStats();
      expect(stats).toEqual({ deployed: 1, started: 0, stopped: 0, paused: 1 });
    });

    it('counts mixed channel states correctly', () => {
      mockGetAll.mockReturnValue(new Map([
        ['ch-1', { runtime: { getState: () => 'STARTED' } }],
        ['ch-2', { runtime: { getState: () => 'STOPPED' } }],
        ['ch-3', { runtime: { getState: () => 'PAUSED' } }],
        ['ch-4', { runtime: { getState: () => 'STARTED' } }],
        ['ch-5', { runtime: { getState: () => 'STOPPED' } }],
      ]));
      const stats = getEngineStats();
      expect(stats).toEqual({ deployed: 5, started: 2, stopped: 2, paused: 1 });
    });

    it('ignores unrecognized states in counting', () => {
      mockGetAll.mockReturnValue(new Map([
        ['ch-1', { runtime: { getState: () => 'UNDEPLOYED' } }],
        ['ch-2', { runtime: { getState: () => 'STARTED' } }],
      ]));
      const stats = getEngineStats();
      expect(stats.deployed).toBe(2);
      expect(stats.started).toBe(1);
      expect(stats.stopped).toBe(0);
      expect(stats.paused).toBe(0);
    });
  });

  // ----- getMemoryStats -----

  describe('getMemoryStats', () => {
    it('includes rss, heapUsed, heapTotal, and external', () => {
      const memory = getMemoryStats();
      expect(memory).toHaveProperty('rss');
      expect(memory).toHaveProperty('heapUsed');
      expect(memory).toHaveProperty('heapTotal');
      expect(memory).toHaveProperty('external');
      expect(typeof memory.rss).toBe('number');
      expect(typeof memory.heapUsed).toBe('number');
      expect(typeof memory.heapTotal).toBe('number');
      expect(typeof memory.external).toBe('number');
    });

    it('returns positive values for all memory fields', () => {
      const memory = getMemoryStats();
      expect(memory.rss).toBeGreaterThan(0);
      expect(memory.heapUsed).toBeGreaterThan(0);
      expect(memory.heapTotal).toBeGreaterThan(0);
      expect(memory.external).toBeGreaterThanOrEqual(0);
    });
  });

  // ----- getHealthStatus -----

  describe('getHealthStatus', () => {
    it('returns ok status when database is connected', async () => {
      mockExecute.mockResolvedValue([{ '?column?': 1 }]);
      mockGetAll.mockReturnValue(new Map());

      const health = await getHealthStatus();
      expect(health.status).toBe('ok');
      expect(health.database.connected).toBe(true);
    });

    it('returns degraded status when database is unreachable', async () => {
      mockExecute.mockRejectedValue(new Error('Connection refused'));
      mockGetAll.mockReturnValue(new Map());

      const health = await getHealthStatus();
      expect(health.status).toBe('degraded');
      expect(health.database.connected).toBe(false);
    });

    it('includes engine deployment stats', async () => {
      mockExecute.mockResolvedValue([{ '?column?': 1 }]);
      mockGetAll.mockReturnValue(new Map([
        ['ch-1', { runtime: { getState: () => 'STARTED' } }],
        ['ch-2', { runtime: { getState: () => 'STOPPED' } }],
      ]));

      const health = await getHealthStatus();
      expect(health.engine).toEqual({ deployed: 2, started: 1, stopped: 1, paused: 0 });
    });

    it('includes memory usage', async () => {
      mockExecute.mockResolvedValue([{ '?column?': 1 }]);

      const health = await getHealthStatus();
      expect(health.memory).toHaveProperty('rss');
      expect(health.memory).toHaveProperty('heapUsed');
      expect(health.memory).toHaveProperty('heapTotal');
      expect(health.memory).toHaveProperty('external');
      expect(health.memory.rss).toBeGreaterThan(0);
    });

    it('includes timestamp in ISO format', async () => {
      mockExecute.mockResolvedValue([{ '?column?': 1 }]);

      const health = await getHealthStatus();
      expect(health.timestamp).toBeDefined();
      // ISO 8601 format check
      expect(new Date(health.timestamp).toISOString()).toBe(health.timestamp);
    });

    it('includes uptime as a positive number', async () => {
      mockExecute.mockResolvedValue([{ '?column?': 1 }]);

      const health = await getHealthStatus();
      expect(typeof health.uptime).toBe('number');
      expect(health.uptime).toBeGreaterThan(0);
    });
  });
});
