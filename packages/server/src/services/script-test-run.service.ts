// ===========================================
// Script test run service
// ===========================================
// Runs one script against a sample message for the editor's Run button, with no
// side effects: sends, writes and routing are refused by the engine's test run;
// reads (resources, collection find) go to the real services. The run happens
// in a worker thread with a heap limit and a fixed time limit, one at a time per
// server, so a test run can never stall or crash the engine's main thread. The
// sample can hold PHI, so it is never stored or logged; the audit event records
// who ran a script for which channel.

import { tryCatch, type Result } from 'stderr-lib';
import { runScriptTestIsolated, type ScriptTestResult } from '@galvanigraph/engine';
import type { ScriptTestRunInput, TemplateSource } from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { ChannelService } from './channel.service.js';
import { CodeTemplateService } from './code-template.service.js';
import { createCollectionBridge, createResourceBridge } from '../engine.js';

/** The most a test run may take, whatever the channel's own script timeout. */
export const TEST_RUN_TIMEOUT_MS = 5_000;
/** Heap limit of the worker a test run runs in. */
export const TEST_RUN_HEAP_MB = 64;
/** How far the process's memory may grow during a test run (typed arrays are outside the heap limit). */
export const TEST_RUN_MEMORY_GROWTH_MB = 256;

interface ChannelScope {
  readonly templates: readonly TemplateSource[];
  readonly destinations: ReadonlyArray<{ readonly name: string; readonly metaDataId: number }>;
  readonly timeoutMs: number;
}

/** Templates, destinations and timeout for the channel being edited (or all templates without one). */
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
  if (!channel.ok) throw new ServiceError('NOT_FOUND', `Channel not found: ${channelId}`);
  if (!templates.ok) throw templates.error;
  return {
    templates: templates.value,
    destinations: channel.value.destinations.map((d) => ({ name: d.name, metaDataId: d.metaDataId })),
    timeoutMs: Math.min(TEST_RUN_TIMEOUT_MS, channel.value.scriptTimeoutSeconds * 1000),
  };
}

/** One test run at a time per server: a second request is refused, not queued. */
let running = false;

function audit(input: ScriptTestRunInput, context: AuditContext | undefined, result: ScriptTestResult | undefined): void {
  emitEvent({
    level: 'INFO', name: 'SCRIPT_TEST_RUN', outcome: result !== undefined && result.outcome !== 'error' ? 'SUCCESS' : 'FAILURE',
    userId: context?.userId ?? null, channelId: input.channelId ?? null,
    serverId: null, ipAddress: context?.ipAddress ?? null,
    attributes: { kind: input.kind, outcome: result?.outcome ?? 'not finished', skipped: result?.skipped.length ?? 0 },
  });
}

export class ScriptTestRunService {
  /** Run a script against a sample message. A failing script is an outcome, not an error. */
  static async run(input: ScriptTestRunInput, context?: AuditContext): Promise<Result<ScriptTestResult>> {
    return tryCatch(async () => {
      if (running) throw new ServiceError('CONFLICT', 'Another test run is in progress on this server. Try again in a few seconds.');
      running = true;
      let result: ScriptTestResult | undefined;
      try {
        const scope = await channelScope(input.channelId);
        const collections = createCollectionBridge();
        // Audited from here on, whatever happens: the script is about to run.
        try {
          result = await runScriptTestIsolated(
            {
              script: input.script,
              kind: input.kind,
              surface: { dataType: input.dataType, destinationSet: input.destinationSet, templateContext: input.templateContext },
              templates: scope.templates,
              sample: input.sample,
              destinations: scope.destinations,
            },
            { getResource: createResourceBridge(), collectionFind: collections.find },
            { timeoutMs: scope.timeoutMs, maxOldGenerationSizeMb: TEST_RUN_HEAP_MB, maxMemoryGrowthMb: TEST_RUN_MEMORY_GROWTH_MB },
          );
          return result;
        } finally {
          audit(input, context, result);
        }
      } finally {
        running = false;
      }
    });
  }
}
