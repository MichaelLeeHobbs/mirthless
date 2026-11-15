// ===========================================
// Script test run service
// ===========================================
// Runs one script against a sample message for the editor's Run button, with no
// side effects: sends, writes and routing are refused by the engine's test run;
// reads (resources, collection find) go to the real services. The sample can
// hold PHI, so it is never stored or logged; the audit event records who ran a
// script for which channel.

import { tryCatch, type Result } from 'stderr-lib';
import { runScriptTest, type ScriptTestResult } from '@galvaniflow/engine';
import type { ScriptTestRunInput, TemplateSource } from '@galvaniflow/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { ChannelService } from './channel.service.js';
import { CodeTemplateService } from './code-template.service.js';
import { createCollectionBridge, createResourceBridge } from '../engine.js';

/** Timeout without a channel, and the most a test run may take. */
export const DEFAULT_TEST_TIMEOUT_MS = 10_000;
export const MAX_TEST_TIMEOUT_MS = 30_000;

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
    return { templates: templates.value, destinations: [], timeoutMs: DEFAULT_TEST_TIMEOUT_MS };
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
    timeoutMs: Math.min(MAX_TEST_TIMEOUT_MS, channel.value.scriptTimeoutSeconds * 1000),
  };
}

export class ScriptTestRunService {
  /** Run a script against a sample message. A failing script is an outcome, not an error. */
  static async run(input: ScriptTestRunInput, context?: AuditContext): Promise<Result<ScriptTestResult>> {
    return tryCatch(async () => {
      const scope = await channelScope(input.channelId);
      const collections = createCollectionBridge();
      const result = await runScriptTest({
        script: input.script,
        kind: input.kind,
        surface: {
          dataType: input.dataType,
          destinationSet: input.destinationSet,
          templateContext: input.templateContext,
        },
        templates: scope.templates,
        sample: input.sample,
        destinations: scope.destinations,
        timeoutMs: scope.timeoutMs,
        readers: { getResource: createResourceBridge(), collectionFind: collections.find },
      });
      if (!result.ok) throw result.error;

      emitEvent({
        level: 'INFO', name: 'SCRIPT_TEST_RUN', outcome: result.value.outcome === 'error' ? 'FAILURE' : 'SUCCESS',
        userId: context?.userId ?? null, channelId: input.channelId ?? null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { kind: input.kind, outcome: result.value.outcome, skipped: result.value.skipped.length },
      });
      return result.value;
    });
  }
}
