import { tryCatch, type Result } from 'stderr-lib';
import { getBoss } from '../lib/queue.js';
import { SettingsService } from './settings.service.js';
import { DataPrunerService, type PruneAllResult } from './data-pruner.service.js';
import { emitEvent } from '../lib/event-emitter.js';
import { foundOrThrow } from '../lib/service-error.js';
import logger from '../lib/logger.js';

const JOB_NAME = 'data-pruner-auto';
const DEFAULT_CRON = '0 3 * * *';

export interface PrunerScheduleStatus {
  readonly enabled: boolean;
  readonly cronExpression: string;
  readonly lastRunAt: string | null;
  readonly lastRunResult: PrunerLastRunResult | null;
}

export interface PrunerLastRunResult extends Pick<
  PruneAllResult,
  'channelsPruned' | 'totalDeleted' | 'failedChannelIds' | 'expiredRecordsDeleted' | 'expiredRecordsComplete' | 'expiredRecordsFailed'
> {
  /** The run as a whole: nothing is known of what it did. */
  readonly failed: boolean;
  readonly completedAt: string;
}

const NOTHING_PRUNED = { channelsPruned: 0, totalDeleted: 0, failedChannelIds: [], expiredRecordsDeleted: 0, expiredRecordsComplete: true, expiredRecordsFailed: false };

export interface UpdatePrunerScheduleInput {
  readonly enabled: boolean;
  readonly cronExpression: string;
}

let lastRunResult: PrunerLastRunResult | null = null;
let lastRunAt: string | null = null;
let workerRegistered = false;

async function readSchedule(): Promise<UpdatePrunerScheduleInput> {
  const enabled = foundOrThrow(await SettingsService.getByKey('pruner.enabled'));
  const cron = foundOrThrow(await SettingsService.getByKey('pruner.cron_expression'));
  return { enabled: enabled?.value === 'true', cronExpression: cron?.value ?? DEFAULT_CRON };
}

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
            const { channelsPruned, totalDeleted, failedChannelIds, expiredRecordsDeleted, expiredRecordsComplete, expiredRecordsFailed } = result.value;
            lastRunResult = { channelsPruned, totalDeleted, failedChannelIds, expiredRecordsDeleted, expiredRecordsComplete, expiredRecordsFailed, failed: false, completedAt: now };
            if (result.value.failedChannelIds.length > 0 || result.value.expiredRecordsFailed) {
              logger.error({ result: result.value }, 'Auto data pruner completed, but not everything could be pruned');
            } else {
              logger.info({ result: result.value }, 'Auto data pruner completed');
            }
          } else {
            lastRunResult = { ...NOTHING_PRUNED, failed: true, completedAt: now };
            logger.error({ errMsg: result.error.message, stack: result.error.stack }, 'Auto data pruner failed');
          }
        });
        workerRegistered = true;
      }

      // After the worker: when this fails, a schedule an earlier start stored still runs.
      const { enabled, cronExpression } = await readSchedule();

      if (enabled) {
        await boss.schedule(JOB_NAME, cronExpression, {});
        logger.info({ cron: cronExpression }, 'Pruner scheduler started');
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
      return { ...(await readSchedule()), lastRunAt, lastRunResult };
    });
  }

  static async updateSchedule(
    input: UpdatePrunerScheduleInput,
  ): Promise<Result<PrunerScheduleStatus>> {
    return tryCatch(async () => {
      const boss = getBoss();

      const saved = await SettingsService.bulkUpsert([
        {
          key: 'pruner.enabled',
          value: String(input.enabled),
          type: 'boolean',
          description: 'Enable automatic data pruning',
          category: 'pruner',
        },
        {
          key: 'pruner.cron_expression',
          value: input.cronExpression,
          type: 'string',
          description: 'Cron expression for data pruner schedule',
          category: 'pruner',
        },
      ]);
      if (!saved.ok) throw saved.error;

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
