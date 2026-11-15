// ===========================================
// Script type gate
// ===========================================
// A user-started deploy refuses a channel whose TypeScript scripts have type
// errors (saving them is allowed). JavaScript scripts are never type-checked.
// The startup redeploy does not come through here: a channel that was running
// keeps running after a restart even if a template change since broke its types.
//
// Each script is checked on the same surface the editor uses (msg typed by the
// channel's inbound data type, its code template context), so deploy reports
// the errors the editor already showed.

import { checkScriptTypes, type ScriptTypeError } from '@galvaniflow/engine';
import { CODE_TEMPLATE_CONTEXT, type ScriptSurface, type TemplateSource } from '@galvaniflow/core-models';
import { ServiceError } from '../lib/service-error.js';
import type { ChannelDetail } from './channel.service.js';
import type { GlobalScriptsData } from './global-script.service.js';

/** A TypeScript script to check, named the way the user knows it. */
export interface TypedScript {
  readonly label: string;
  readonly code: string;
  readonly surface: ScriptSurface;
}

/** One script's type errors. */
export interface ScriptTypeFailure {
  readonly label: string;
  readonly errors: readonly ScriptTypeError[];
}

/** Most errors listed in the deploy refusal; the rest are counted. */
export const MAX_LISTED_TYPE_ERRORS = 10;

const isTypeScript = (language: string | undefined, code: string | null | undefined): code is string =>
  language === 'TYPESCRIPT' && typeof code === 'string' && code.trim() !== '';

const CHANNEL_SCRIPTS: Readonly<Record<string, { readonly name: string; readonly context: string; readonly message: boolean }>> = {
  DEPLOY: { name: 'Channel deploy script', context: CODE_TEMPLATE_CONTEXT.CHANNEL_DEPLOY, message: false },
  UNDEPLOY: { name: 'Channel undeploy script', context: CODE_TEMPLATE_CONTEXT.CHANNEL_UNDEPLOY, message: false },
  PREPROCESSOR: { name: 'Channel preprocessor', context: CODE_TEMPLATE_CONTEXT.CHANNEL_PREPROCESSOR, message: true },
  POSTPROCESSOR: { name: 'Channel postprocessor', context: CODE_TEMPLATE_CONTEXT.CHANNEL_POSTPROCESSOR, message: true },
};

const GLOBAL_SCRIPTS = [
  { key: 'deploy', name: 'Global deploy script', context: CODE_TEMPLATE_CONTEXT.GLOBAL_DEPLOY },
  { key: 'undeploy', name: 'Global undeploy script', context: CODE_TEMPLATE_CONTEXT.GLOBAL_UNDEPLOY },
  { key: 'preprocessor', name: 'Global preprocessor', context: CODE_TEMPLATE_CONTEXT.GLOBAL_PREPROCESSOR },
  { key: 'postprocessor', name: 'Global postprocessor', context: CODE_TEMPLATE_CONTEXT.GLOBAL_POSTPROCESSOR },
] as const;

/** "the source" or `destination "To EHR"` for a filter or transformer's connector. */
function stageName(channel: ChannelDetail, connectorId: string | null): string {
  if (connectorId === null) return 'Source';
  const dest = channel.destinations.find((d) => d.id === connectorId);
  return `Destination "${dest?.name ?? connectorId}"`;
}

/** Filter, transformer and response transformer scripts written in TypeScript. */
function connectorScripts(channel: ChannelDetail): TypedScript[] {
  const dataType = channel.inboundDataType;
  const out: TypedScript[] = [];
  const stageSurface = (connectorId: string | null): ScriptSurface => (connectorId === null
    ? { dataType, destinationSet: true, templateContext: CODE_TEMPLATE_CONTEXT.SOURCE_FILTER_TRANSFORMER }
    : { dataType, templateContext: CODE_TEMPLATE_CONTEXT.DESTINATION_FILTER_TRANSFORMER });
  for (const filter of channel.filters) {
    for (const [i, rule] of filter.rules.entries()) {
      if (!rule.enabled || rule.type !== 'JAVASCRIPT' || !isTypeScript(rule.language, rule.script)) continue;
      out.push({ label: `${stageName(channel, filter.connectorId)} filter rule "${rule.name ?? `Rule ${String(i + 1)}`}"`, code: rule.script, surface: stageSurface(filter.connectorId) });
    }
  }
  for (const transformer of channel.transformers) {
    for (const [i, step] of transformer.steps.entries()) {
      if (!step.enabled || step.type === 'MAPPER' || !isTypeScript(step.language, step.script)) continue;
      out.push({ label: `${stageName(channel, transformer.connectorId)} transformer step "${step.name ?? `Step ${String(i + 1)}`}"`, code: step.script, surface: stageSurface(transformer.connectorId) });
    }
  }
  for (const dest of channel.destinations) {
    if (!isTypeScript(dest.responseTransformerLanguage, dest.responseTransformer)) continue;
    out.push({ label: `Response transformer of destination "${dest.name}"`, code: dest.responseTransformer, surface: { dataType, templateContext: CODE_TEMPLATE_CONTEXT.DESTINATION_RESPONSE_TRANSFORMER } });
  }
  return out;
}

/** Every TypeScript script that runs for this channel: its own and the global ones. */
export function typeScriptScripts(channel: ChannelDetail, globals: GlobalScriptsData): TypedScript[] {
  const own = channel.scripts.flatMap((s): TypedScript[] => {
    const meta = CHANNEL_SCRIPTS[s.scriptType];
    if (!meta || !isTypeScript(s.language, s.script)) return [];
    const surface: ScriptSurface = meta.message
      ? { dataType: channel.inboundDataType, templateContext: meta.context }
      : { templateContext: meta.context };
    return [{ label: meta.name, code: s.script, surface }];
  });
  // Global scripts run for every channel, so the editor checks them with no
  // data type; deploy checks them the same way.
  const global = GLOBAL_SCRIPTS.flatMap((g): TypedScript[] =>
    (isTypeScript(globals.languages[g.key], globals[g.key])
      ? [{ label: g.name, code: globals[g.key], surface: { templateContext: g.context } }]
      : []));
  return [...own, ...connectorScripts(channel), ...global];
}

/** The deploy refusal: what failed and where, most errors listed. */
export function formatTypeFailures(channelName: string, failures: readonly ScriptTypeFailure[]): string {
  const lines = failures.flatMap((f) => f.errors.map((e) => `- ${f.label}, line ${String(e.line)}: ${e.message}`));
  const shown = lines.slice(0, MAX_LISTED_TYPE_ERRORS);
  const more = lines.length - shown.length;
  const scripts = failures.length === 1 ? 'a TypeScript script has' : `${String(failures.length)} TypeScript scripts have`;
  return [
    `"${channelName}" was not deployed: ${scripts} type errors. Fix them, or switch the script to JavaScript to deploy without type checks.`,
    ...shown,
    ...(more > 0 ? [`- and ${String(more)} more`] : []),
  ].join('\n');
}

/** Refuse the deploy (INVALID_INPUT) when any TypeScript script has a type error. */
export async function assertScriptsTypeCheck(
  channel: ChannelDetail,
  globals: GlobalScriptsData,
  templates: readonly TemplateSource[],
): Promise<void> {
  const failures: ScriptTypeFailure[] = [];
  for (const script of typeScriptScripts(channel, globals)) {
    const result = await checkScriptTypes(script.code, script.surface, templates);
    if (!result.ok) {
      throw new ServiceError('INTERNAL', `Could not type-check ${script.label}: ${result.error.message}`);
    }
    if (result.value.length > 0) failures.push({ label: script.label, errors: result.value });
  }
  if (failures.length > 0) {
    throw new ServiceError('INVALID_INPUT', formatTypeFailures(channel.name, failures), { typeErrors: failures });
  }
}
