// ===========================================
// Pruner Scheduler Service
// ===========================================
// Cron-based scheduling for automatic data pruning via pg-boss.
// Reads schedule config from system_settings table.

import { tryCatch, type Result } from 'stderr-lib';
import { getBoss } from '../lib/queue.js';
import { SettingsService } from './settings.service.js';
import { DataPrunerService } from './data-pruner.service.js';
import { emitEvent } from '../lib/event-emitter.js';
import logger from '../lib/logger.js';

// ----- Constants -----

const JOB_NAME = 'data-pruner-auto';
const DEFAULT_CRON = '0 3 * * *'; // 3 AM daily

// ----- Types -----

export interface PrunerScheduleStatus {
  readonly enabled: boolean;
  readonly cronExpression: string;
  readonly lastRunAt: string | null;
  readonly lastRunResult: PrunerLastRunResult | null;
}

export interface PrunerLastRunResult {
  readonly channelsPruned: number;
  readonly totalDeleted: number;
  readonly completedAt: string;
}

export interface UpdatePrunerScheduleInput {
  readonly enabled: boolean;
  readonly cronExpression: string;
}

// ----- Module State -----

let lastRunResult: PrunerLastRunResult | null = null;
let lastRunAt: string | null = null;
let workerRegistered = false;

// ----- Service -----

export class PrunerSchedulerService {
  /** Start the pruner scheduler. Reads settings and registers worker. */
  static async start(): Promise<Result<void>> {
    return tryCatch(async () => {
      const boss = getBoss();
      if (!boss) {
        logger.warn({ component: 'pruner' }, 'pg-boss not available, pruner scheduler not started');
        return;
      }

      // Ensure queue exists (pgboss v10+ requires explicit creation)
      if (!workerRegistered) {
        await boss.createQueue(JOB_NAME);
        await boss.work(JOB_NAME, async () => {
          logger.info({ component: 'pruner' }, 'Auto data pruner triggered');
          const result = await DataPrunerService.pruneAll();
          const now = new Date().toISOString();
          lastRunAt = now;

          if (result.ok) {
            lastRunResult = {
              channelsPruned: result.value.channelsPruned,
              totalDeleted: result.value.totalDeleted,
              completedAt: now,
            };
            logger.info({ result: result.value }, 'Auto data pruner completed');
          } else {
            lastRunResult = { channelsPruned: 0, totalDeleted: 0, completedAt: now };
            logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Auto data pruner failed');
          }
        });
        workerRegistered = true;
      }

      // Read schedule settings
      const enabledResult = await SettingsService.getByKey('pruner.enabled');
      const cronResult = await SettingsService.getByKey('pruner.cron_expression');

      const enabled = enabledResult.ok && enabledResult.value.value === 'true';
      const cron = cronResult.ok ? (cronResult.value.value ?? DEFAULT_CRON) : DEFAULT_CRON;

      if (enabled) {
        await boss.schedule(JOB_NAME, cron, {});
        logger.info({ cron }, 'Pruner scheduler started');
      } else {
        logger.info({ component: 'pruner' }, 'Pruner scheduler disabled');
      }
    });
  }

  /** Stop the pruner scheduler. */
  static async stop(): Promise<Result<void>> {
    return tryCatch(async () => {
      const boss = getBoss();
      if (!boss) return;

      await boss.unschedule(JOB_NAME);
      logger.info({ component: 'pruner' }, 'Pruner scheduler stopped');
    });
  }

  /** Get current scheduler status. */
  static async getStatus(): Promise<Result<PrunerScheduleStatus>> {
    return tryCatch(async () => {
      const enabledResult = await SettingsService.getByKey('pruner.enabled');
      const cronResult = await SettingsService.getByKey('pruner.cron_expression');

      const enabled = enabledResult.ok && enabledResult.value.value === 'true';
      const cronExpression = cronResult.ok ? (cronResult.value.value ?? DEFAULT_CRON) : DEFAULT_CRON;

      return { enabled, cronExpression, lastRunAt, lastRunResult };
    });
  }

  /** Update schedule and restart. */
  static async updateSchedule(
    input: UpdatePrunerScheduleInput,
  ): Promise<Result<PrunerScheduleStatus>> {
    return tryCatch(async () => {
      const boss = getBoss();

      // Persist settings
      await SettingsService.upsert({
        key: 'pruner.enabled',
        value: String(input.enabled),
        type: 'boolean',
        description: 'Enable automatic data pruning',
        category: 'pruner',
      });
      await SettingsService.upsert({
        key: 'pruner.cron_expression',
        value: input.cronExpression,
        type: 'string',
        description: 'Cron expression for data pruner schedule',
        category: 'pruner',
      });

      // Reschedule
      if (boss) {
        await boss.unschedule(JOB_NAME);
        if (input.enabled) {
          await boss.schedule(JOB_NAME, input.cronExpression, {});
          logger.info({ cron: input.cronExpression }, 'Pruner schedule updated');
        } else {
          logger.info({ component: 'pruner' }, 'Pruner schedule disabled');
        }
      }

      emitEvent({
        level: 'INFO', name: 'DATA_PRUNER_SCHEDULE_UPDATED', outcome: 'SUCCESS',
        userId: null, channelId: null, serverId: null, ipAddress: null,
        attributes: { enabled: input.enabled, cronExpression: input.cronExpression },
      });

      return {
        enabled: input.enabled,
        cronExpression: input.cronExpression,
        lastRunAt,
        lastRunResult,
      };
    });
  }

  /** Reset module state (for testing). */
  static _reset(): void {
    lastRunResult = null;
    lastRunAt = null;
    workerRegistered = false;
  }
}
