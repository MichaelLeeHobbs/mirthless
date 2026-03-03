// ===========================================
// System Info Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mocks -----

const mockCheckDatabase = vi.fn();
const mockGetEngineStats = vi.fn();
const mockGetMemoryStats = vi.fn();

vi.mock('../health.service.js', () => ({
  checkDatabase: (...args: unknown[]) => mockCheckDatabase(...args),
  getEngineStats: (...args: unknown[]) => mockGetEngineStats(...args),
  getMemoryStats: (...args: unknown[]) => mockGetMemoryStats(...args),
}));

const { SystemInfoService } = await import('../system-info.service.js');

// ----- Tests -----

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SystemInfoService', () => {
  describe('getInfo', () => {
    it('returns system info with all fields', async () => {
      mockCheckDatabase.mockResolvedValueOnce(true);
      mockGetEngineStats.mockReturnValueOnce({ deployed: 5, started: 3, stopped: 1, paused: 1 });
      mockGetMemoryStats.mockReturnValueOnce({ rss: 100, heapUsed: 50, heapTotal: 80, external: 10 });

      const result = await SystemInfoService.getInfo();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.server).toBeDefined();
      expect(result.value.os).toBeDefined();
      expect(result.value.memory).toBeDefined();
      expect(result.value.engine).toBeDefined();
      expect(result.value.database).toBeDefined();
    });

    it('includes Node.js version', async () => {
      mockCheckDatabase.mockResolvedValueOnce(true);
      mockGetEngineStats.mockReturnValueOnce({ deployed: 0, started: 0, stopped: 0, paused: 0 });
      mockGetMemoryStats.mockReturnValueOnce({ rss: 0, heapUsed: 0, heapTotal: 0, external: 0 });

      const result = await SystemInfoService.getInfo();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.server.nodeVersion).toMatch(/^v\d+/);
    });

    it('includes memory stats', async () => {
      mockCheckDatabase.mockResolvedValueOnce(true);
      mockGetEngineStats.mockReturnValueOnce({ deployed: 0, started: 0, stopped: 0, paused: 0 });
      mockGetMemoryStats.mockReturnValueOnce({ rss: 100, heapUsed: 50, heapTotal: 80, external: 10 });

      const result = await SystemInfoService.getInfo();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.memory.rss).toBe(100);
      expect(result.value.memory.heapUsed).toBe(50);
    });

    it('includes engine stats', async () => {
      mockCheckDatabase.mockResolvedValueOnce(true);
      mockGetEngineStats.mockReturnValueOnce({ deployed: 5, started: 3, stopped: 1, paused: 1 });
      mockGetMemoryStats.mockReturnValueOnce({ rss: 0, heapUsed: 0, heapTotal: 0, external: 0 });

      const result = await SystemInfoService.getInfo();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.engine.deployed).toBe(5);
      expect(result.value.engine.started).toBe(3);
    });

    it('handles DB failure gracefully (degraded status)', async () => {
      mockCheckDatabase.mockResolvedValueOnce(false);
      mockGetEngineStats.mockReturnValueOnce({ deployed: 0, started: 0, stopped: 0, paused: 0 });
      mockGetMemoryStats.mockReturnValueOnce({ rss: 0, heapUsed: 0, heapTotal: 0, external: 0 });

      const result = await SystemInfoService.getInfo();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.database.connected).toBe(false);
    });

    it('includes OS info', async () => {
      mockCheckDatabase.mockResolvedValueOnce(true);
      mockGetEngineStats.mockReturnValueOnce({ deployed: 0, started: 0, stopped: 0, paused: 0 });
      mockGetMemoryStats.mockReturnValueOnce({ rss: 0, heapUsed: 0, heapTotal: 0, external: 0 });

      const result = await SystemInfoService.getInfo();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.os.platform).toBeDefined();
      expect(result.value.os.arch).toBeDefined();
      expect(result.value.os.totalMemory).toBeGreaterThan(0);
    });
  });
});
