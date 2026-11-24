import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSchedule = vi.fn().mockResolvedValue(undefined);
const mockUnschedule = vi.fn().mockResolvedValue(undefined);
const mockWork = vi.fn().mockResolvedValue(undefined);
const mockCreateQueue = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lib/queue.js', () => ({
  getBoss: vi.fn(() => ({
    schedule: mockSchedule,
    unschedule: mockUnschedule,
    work: mockWork,
    createQueue: mockCreateQueue,
  })),
}));

const mockSettingsGetByKey = vi.fn();
const mockSettingsBulkUpsert = vi.fn();

vi.mock('../settings.service.js', () => ({
  SettingsService: {
    getByKey: mockSettingsGetByKey,
    bulkUpsert: mockSettingsBulkUpsert,
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
const { ServiceError } = await import('../../lib/service-error.js');

function okResult<T>(value: T): { ok: true; value: T; error: null } {
  return { ok: true, value, error: null };
}

function errResult(error: Error): { ok: false; value: null; error: Error } {
  return { ok: false, value: null, error };
}

const NOT_FOUND = errResult(new ServiceError('NOT_FOUND', 'Setting not found'));

function mockStored(values: Readonly<Record<string, string | Error>>): void {
  mockSettingsGetByKey.mockImplementation(async (key: string) => {
    const value = values[key];
    if (value === undefined) return NOT_FOUND;
    return value instanceof Error ? errResult(value) : okResult({ value });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSettingsBulkUpsert.mockResolvedValue(okResult([]));
  PrunerSchedulerService._reset();
});

describe('PrunerSchedulerService', () => {
  describe('start', () => {
    it('registers worker and schedules when enabled', async () => {
      mockStored({ 'pruner.enabled': 'true', 'pruner.cron_expression': '0 4 * * *' });

      const result = await PrunerSchedulerService.start();

      expect(result.ok).toBe(true);
      expect(mockWork).toHaveBeenCalledWith('data-pruner-auto', expect.any(Function));
      expect(mockSchedule).toHaveBeenCalledWith('data-pruner-auto', '0 4 * * *', {});
    });

    it('does not schedule when disabled', async () => {
      mockStored({ 'pruner.enabled': 'false', 'pruner.cron_expression': '0 3 * * *' });

      const result = await PrunerSchedulerService.start();

      expect(result.ok).toBe(true);
      expect(mockSchedule).not.toHaveBeenCalled();
    });

    it('uses default cron when setting is missing', async () => {
      mockStored({ 'pruner.enabled': 'true' });

      await PrunerSchedulerService.start();

      expect(mockSchedule).toHaveBeenCalledWith('data-pruner-auto', '0 3 * * *', {});
    });
  });

  describe('a setting that cannot be read', () => {
    const down = new Error('connection refused');
    const UNREADABLE = [
      ['pruner.enabled', { 'pruner.enabled': down, 'pruner.cron_expression': '0 4 * * *' }],
      ['pruner.cron_expression', { 'pruner.enabled': 'true', 'pruner.cron_expression': down }],
    ] as const;

    it.each(UNREADABLE)('fails the start instead of taking the default of %s, and keeps the worker for a schedule stored earlier', async (_key, values) => {
      mockStored(values);

      const result = await PrunerSchedulerService.start();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe('connection refused');
      expect(mockSchedule).not.toHaveBeenCalled();
      expect(mockWork).toHaveBeenCalledTimes(1);
    });

    it.each(UNREADABLE)('fails the status instead of showing the default of %s', async (_key, values) => {
      mockStored(values);

      const result = await PrunerSchedulerService.getStatus();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe('connection refused');
    });

    it('reports a setting that was never stored as disabled at the default time', async () => {
      mockStored({});

      const result = await PrunerSchedulerService.getStatus();

      expect(result).toMatchObject({ ok: true, value: { enabled: false, cronExpression: '0 3 * * *' } });
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
      mockStored({ 'pruner.enabled': 'true', 'pruner.cron_expression': '0 5 * * *' });

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
      expect(mockSettingsBulkUpsert.mock.calls[0]?.[0]).toMatchObject([
        { key: 'pruner.enabled', value: 'true' },
        { key: 'pruner.cron_expression', value: '0 6 * * *' },
      ]);
      expect(mockUnschedule).toHaveBeenCalledWith('data-pruner-auto');
      expect(mockSchedule).toHaveBeenCalledWith('data-pruner-auto', '0 6 * * *', {});
    });

    it('leaves the schedule alone and fails when the settings cannot be saved', async () => {
      mockSettingsBulkUpsert.mockResolvedValue(errResult(new Error('connection refused')));
      const { emitEvent } = await import('../../lib/event-emitter.js');

      const result = await PrunerSchedulerService.updateSchedule({ enabled: true, cronExpression: '0 6 * * *' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe('connection refused');
      expect(mockUnschedule).not.toHaveBeenCalled();
      expect(mockSchedule).not.toHaveBeenCalled();
      expect(emitEvent).not.toHaveBeenCalled();
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
