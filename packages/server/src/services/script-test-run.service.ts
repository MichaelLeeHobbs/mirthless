// The sample can hold PHI, so it is never stored or logged; the audit event
// records only who ran a script for which channel.

import { tryCatch, type Result } from 'stderr-lib';
import { runScriptTestIsolated, type ScriptTestResult } from '@galvanigraph/engine';
import { AUDIT_ACTION, type ScriptTestRunInput, type TemplateSource } from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { dataTypeOptionsFrom } from '../lib/data-type-options.js';
import { emitAuditEvent, type AuditContext } from '../lib/event-emitter.js';
import { AuditService } from './audit.service.js';
import { ChannelService } from './channel.service.js';
import { CodeTemplateService } from './code-template.service.js';
import { createCollectionBridge, createResourceBridge } from '../engine.js';

/** The run's own start-up comes before the script's limit (#188). */
export const TEST_RUN_START_LIMIT_MS = 30_000;
export const TEST_RUN_TIMEOUT_MS = 5_000;
export const TEST_RUN_HEAP_MB = 64;
/** Typed arrays are outside the worker's heap limit, so their growth is capped separately. */
export const TEST_RUN_MEMORY_GROWTH_MB = 256;

interface ChannelScope {
  readonly templates: readonly TemplateSource[];
  readonly destinations: ReadonlyArray<{ readonly name: string; readonly metaDataId: number }>;
  readonly timeoutMs: number;
}

async function channelScope(channelId: string | undefined): Promise<ChannelScope> {
  if (channelId === undefined) {
    const templates = await CodeTemplateService.listTemplates();
    if (!templates.ok) throw templates.error;
    return { templates: templates.value, destinations: [], timeoutMs: TEST_RUN_TIMEOUT_MS };
  }
  const [channel, templates] = await Promise.all([
    ChannelService.getById(channelId),
    CodeTemplateService.listTemplatesForChannel(channelId),
  ]);
  if (!channel.ok) throw channel.error;
  if (!templates.ok) throw templates.error;
  return {
    templates: templates.value,
    destinations: channel.value.destinations.map((d) => ({ name: d.name, metaDataId: d.metaDataId })),
    timeoutMs: Math.min(TEST_RUN_TIMEOUT_MS, channel.value.scriptTimeoutSeconds * 1000),
  };
}

let running = false;

/**
 * A run that returned a result can show resource and collection data, so it is
 * recorded fail-closed and the result withheld when that fails (D-312); a run
 * that threw is recorded best effort.
 */
async function audit(input: ScriptTestRunInput, context: AuditContext | undefined, result: ScriptTestResult | undefined): Promise<void> {
  const record = {
    action: AUDIT_ACTION.SCRIPT_TEST_RUN, outcome: result !== undefined && result.outcome !== 'error' ? 'SUCCESS' : 'FAILURE',
    userId: context?.userId ?? null, channelId: input.channelId ?? null, ipAddress: context?.ipAddress ?? null,
    attributes: { kind: input.kind, outcome: result?.outcome ?? 'not finished', skipped: result?.skipped.length ?? 0 },
  } as const;
  if (result === undefined) {
    emitAuditEvent(record);
    return;
  }
  const recorded = await AuditService.recordOrRefuse(record);
  if (!recorded.ok) throw recorded.error;
}

/** Each bridge only with its read permission (D-310). */
export interface TestRunReads {
  readonly resources: boolean;
  readonly collections: boolean;
}

function refused(label: string, permission: string): () => Promise<never> {
  return () => Promise.reject(new Error(`This test run cannot read ${label}: it needs the ${permission} permission.`));
}

export class ScriptTestRunService {
  /** Run a script against a sample message. A failing script is an outcome, not an error. */
  static async run(input: ScriptTestRunInput, context: AuditContext | undefined, reads: TestRunReads): Promise<Result<ScriptTestResult>> {
    return tryCatch(async () => {
      if (running) throw new ServiceError('CONFLICT', 'Another test run is in progress on this server. Try again in a few seconds.');
      running = true;
      let result: ScriptTestResult | undefined;
      try {
        const dataTypeOptions = dataTypeOptionsFrom(input.dataType, input.dataTypeProperties ?? {});
        const scope = await channelScope(input.channelId);
        const collections = createCollectionBridge();
        // Audited from here on, whatever happens: the script is about to run.
        try {
          result = await runScriptTestIsolated(
            {
              script: input.script,
              kind: input.kind,
              surface: { dataType: input.dataType, destinationSet: input.destinationSet, templateContext: input.templateContext },
              dataTypeOptions,
              templates: scope.templates,
              sample: input.sample,
              destinations: scope.destinations,
            },
            {
              getResource: reads.resources ? createResourceBridge() : refused('resources', 'resources:read'),
              collectionFind: reads.collections ? collections.find : refused('collections', 'collections:read'),
            },
            { startLimitMs: TEST_RUN_START_LIMIT_MS, timeoutMs: scope.timeoutMs, maxOldGenerationSizeMb: TEST_RUN_HEAP_MB, maxMemoryGrowthMb: TEST_RUN_MEMORY_GROWTH_MB },
          );
        } catch (err: unknown) {
          await audit(input, context, undefined);
          throw err;
        }
        // The result is returned only once its record is written.
        await audit(input, context, result);
        return result;
      } finally {
        running = false;
      }
    });
  }
}
