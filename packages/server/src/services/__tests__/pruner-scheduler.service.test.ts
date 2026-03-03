// ===========================================
// Pruner Scheduler Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock Dependencies -----

const mockSchedule = vi.fn().mockResolvedValue(undefined);
const mockUnschedule = vi.fn().mockResolvedValue(undefined);
const mockWork = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lib/queue.js', () => ({
  getBoss: vi.fn(() => ({
    schedule: mockSchedule,
    unschedule: mockUnschedule,
    work: mockWork,
  })),
}));

const mockSettingsGetByKey = vi.fn();
const mockSettingsUpsert = vi.fn().mockResolvedValue({ ok: true, value: {}, error: null });

vi.mock('../settings.service.js', () => ({
  SettingsService: {
    getByKey: mockSettingsGetByKey,
    upsert: mockSettingsUpsert,
  },
}));

const mockPruneAll = vi.fn();

vi.mock('../data-pruner.service.js', () => ({
  DataPrunerService: { pruneAll: mockPruneAll },
}));

vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn() }));
vi.mock('../../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { PrunerSchedulerService } = await import('../pruner-scheduler.service.js');

// ----- Helpers -----

function okResult<T>(value: T): { ok: true; value: T; error: null } {
  return { ok: true, value, error: null };
}

function errResult(message: string): { ok: false; value: null; error: { message: string } } {
  return { ok: false, value: null, error: { message } };
}

// ----- Tests -----

beforeEach(() => {
  vi.clearAllMocks();
  PrunerSchedulerService._reset();
});

describe('PrunerSchedulerService', () => {
  describe('start', () => {
    it('registers worker and schedules when enabled', async () => {
      mockSettingsGetByKey.mockImplementation((key: string) => {
        if (key === 'pruner.enabled') return Promise.resolve(okResult({ value: 'true' }));
        if (key === 'pruner.cron_expression') return Promise.resolve(okResult({ value: '0 4 * * *' }));
        return Promise.resolve(errResult('NOT_FOUND'));
      });

      const result = await PrunerSchedulerService.start();

      expect(result.ok).toBe(true);
      expect(mockWork).toHaveBeenCalledWith('data-pruner-auto', expect.any(Function));
      expect(mockSchedule).toHaveBeenCalledWith('data-pruner-auto', '0 4 * * *', {});
    });

    it('does not schedule when disabled', async () => {
      mockSettingsGetByKey.mockImplementation((key: string) => {
        if (key === 'pruner.enabled') return Promise.resolve(okResult({ value: 'false' }));
        if (key === 'pruner.cron_expression') return Promise.resolve(okResult({ value: '0 3 * * *' }));
        return Promise.resolve(errResult('NOT_FOUND'));
      });

      const result = await PrunerSchedulerService.start();

      expect(result.ok).toBe(true);
      expect(mockSchedule).not.toHaveBeenCalled();
    });

    it('uses default cron when setting is missing', async () => {
      mockSettingsGetByKey.mockImplementation((key: string) => {
        if (key === 'pruner.enabled') return Promise.resolve(okResult({ value: 'true' }));
        return Promise.resolve(errResult('NOT_FOUND'));
      });

      await PrunerSchedulerService.start();

      expect(mockSchedule).toHaveBeenCalledWith('data-pruner-auto', '0 3 * * *', {});
    });
  });

  describe('stop', () => {
    it('unschedules the job', async () => {
      const result = await PrunerSchedulerService.stop();

      expect(result.ok).toBe(true);
      expect(mockUnschedule).toHaveBeenCalledWith('data-pruner-auto');
    });
  });

  describe('getStatus', () => {
    it('returns current schedule status', async () => {
      mockSettingsGetByKey.mockImplementation((key: string) => {
        if (key === 'pruner.enabled') return Promise.resolve(okResult({ value: 'true' }));
        if (key === 'pruner.cron_expression') return Promise.resolve(okResult({ value: '0 5 * * *' }));
        return Promise.resolve(errResult('NOT_FOUND'));
      });

      const result = await PrunerSchedulerService.getStatus();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enabled).toBe(true);
      expect(result.value.cronExpression).toBe('0 5 * * *');
      expect(result.value.lastRunAt).toBeNull();
      expect(result.value.lastRunResult).toBeNull();
    });

    it('returns disabled when setting is false', async () => {
      mockSettingsGetByKey.mockResolvedValue(okResult({ value: 'false' }));

      const result = await PrunerSchedulerService.getStatus();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enabled).toBe(false);
    });
  });

  describe('updateSchedule', () => {
    it('persists settings and reschedules', async () => {
      const result = await PrunerSchedulerService.updateSchedule({
        enabled: true,
        cronExpression: '0 6 * * *',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enabled).toBe(true);
      expect(result.value.cronExpression).toBe('0 6 * * *');
      expect(mockSettingsUpsert).toHaveBeenCalledTimes(2);
      expect(mockUnschedule).toHaveBeenCalledWith('data-pruner-auto');
      expect(mockSchedule).toHaveBeenCalledWith('data-pruner-auto', '0 6 * * *', {});
    });

    it('unschedules when disabled', async () => {
      const result = await PrunerSchedulerService.updateSchedule({
        enabled: false,
        cronExpression: '0 3 * * *',
      });

      expect(result.ok).toBe(true);
      expect(mockUnschedule).toHaveBeenCalledWith('data-pruner-auto');
      expect(mockSchedule).not.toHaveBeenCalled();
    });

    it('emits schedule update event', async () => {
      const { emitEvent } = await import('../../lib/event-emitter.js');

      await PrunerSchedulerService.updateSchedule({
        enabled: true,
        cronExpression: '0 3 * * *',
      });

      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'DATA_PRUNER_SCHEDULE_UPDATED' }),
      );
    });
  });
});
