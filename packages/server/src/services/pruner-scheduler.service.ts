import { tryCatch, type Result } from 'stderr-lib';
import { getBoss } from '../lib/queue.js';
import { SettingsService } from './settings.service.js';
import { DataPrunerService } from './data-pruner.service.js';
import { emitEvent } from '../lib/event-emitter.js';
import logger from '../lib/logger.js';

const JOB_NAME = 'data-pruner-auto';
const DEFAULT_CRON = '0 3 * * *';

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

let lastRunResult: PrunerLastRunResult | null = null;
let lastRunAt: string | null = null;
let workerRegistered = false;

export class PrunerSchedulerService {
  static async start(): Promise<Result<void>> {
    return tryCatch(async () => {
      const boss = getBoss();
      if (!boss) {
        logger.warn({ component: 'pruner' }, 'pg-boss not available, pruner scheduler not started');
        return;
      }

      // pg-boss v10+ requires explicit queue creation.
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
            if (result.value.failedChannelIds.length > 0) {
              logger.error({ result: result.value }, 'Auto data pruner completed, but some channels could not be pruned');
            } else {
              logger.info({ result: result.value }, 'Auto data pruner completed');
            }
          } else {
            lastRunResult = { channelsPruned: 0, totalDeleted: 0, completedAt: now };
            logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Auto data pruner failed');
          }
        });
        workerRegistered = true;
      }

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

  static async stop(): Promise<Result<void>> {
    return tryCatch(async () => {
      const boss = getBoss();
      if (!boss) return;

      await boss.unschedule(JOB_NAME);
      logger.info({ component: 'pruner' }, 'Pruner scheduler stopped');
    });
  }

  static async getStatus(): Promise<Result<PrunerScheduleStatus>> {
    return tryCatch(async () => {
      const enabledResult = await SettingsService.getByKey('pruner.enabled');
      const cronResult = await SettingsService.getByKey('pruner.cron_expression');

      const enabled = enabledResult.ok && enabledResult.value.value === 'true';
      const cronExpression = cronResult.ok ? (cronResult.value.value ?? DEFAULT_CRON) : DEFAULT_CRON;

      return { enabled, cronExpression, lastRunAt, lastRunResult };
    });
  }

  static async updateSchedule(
    input: UpdatePrunerScheduleInput,
  ): Promise<Result<PrunerScheduleStatus>> {
    return tryCatch(async () => {
      const boss = getBoss();

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

  /** Tests only. */
  static _reset(): void {
    lastRunResult = null;
    lastRunAt = null;
    workerRegistered = false;
  }
}
