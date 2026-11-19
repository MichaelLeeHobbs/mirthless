// What is checked, when, and against which surface: D-285.

import { checkScriptTypesBatch, onlySyntaxWhileBroken, type ScriptTypeError } from '@galvanigraph/engine';
import { CODE_TEMPLATE_CONTEXT, toScriptLanguage, type ScriptSurface, type TemplateSource } from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import type { ChannelDetail } from './channel.service.js';
import type { GlobalScriptsData } from './global-script.service.js';

export interface ScriptSegment {
  readonly label: string;
  /** 1-based, in the checked code. */
  readonly startLine: number;
  readonly lineCount: number;
  readonly typescript: boolean;
}

export interface TypedScript {
  readonly code: string;
  readonly surface: ScriptSurface;
  readonly segments: readonly ScriptSegment[];
}

export interface ScriptTypeFailure {
  readonly label: string;
  readonly errors: readonly ScriptTypeError[];
}

export const MAX_LISTED_TYPE_ERRORS = 10;

const isTypeScript = (language: string | undefined, code: string | null | undefined): code is string =>
  language === 'TYPESCRIPT' && typeof code === 'string' && code.trim() !== '';

const lineCount = (code: string): number => code.split('\n').length;

function single(label: string, code: string, surface: ScriptSurface): TypedScript {
  return { code, surface, segments: [{ label, startLine: 1, lineCount: lineCount(code), typescript: true }] };
}

const CHANNEL_SCRIPTS: Readonly<Record<string, { readonly name: string; readonly context: string; readonly message: boolean }>> = {
  DEPLOY: { name: 'Channel deploy script', context: CODE_TEMPLATE_CONTEXT.CHANNEL_DEPLOY, message: false },
  UNDEPLOY: { name: 'Channel undeploy script', context: CODE_TEMPLATE_CONTEXT.CHANNEL_UNDEPLOY, message: false },
  PREPROCESSOR: { name: 'Channel preprocessor', context: CODE_TEMPLATE_CONTEXT.CHANNEL_PREPROCESSOR, message: true },
  POSTPROCESSOR: { name: 'Channel postprocessor', context: CODE_TEMPLATE_CONTEXT.CHANNEL_POSTPROCESSOR, message: true },
};

const GLOBAL_SCRIPTS = [
  { key: 'deploy', name: 'Global deploy script', context: CODE_TEMPLATE_CONTEXT.GLOBAL_DEPLOY, message: false },
  { key: 'undeploy', name: 'Global undeploy script', context: CODE_TEMPLATE_CONTEXT.GLOBAL_UNDEPLOY, message: false },
  { key: 'preprocessor', name: 'Global preprocessor', context: CODE_TEMPLATE_CONTEXT.GLOBAL_PREPROCESSOR, message: true },
  { key: 'postprocessor', name: 'Global postprocessor', context: CODE_TEMPLATE_CONTEXT.GLOBAL_POSTPROCESSOR, message: true },
] as const;

/** "the source" or `destination "To EHR"` for a filter or transformer's connector. */
function stageName(channel: ChannelDetail, connectorId: string | null): string {
  if (connectorId === null) return 'Source';
  const dest = channel.destinations.find((d) => d.id === connectorId);
  return `Destination "${dest?.name ?? connectorId}"`;
}

/**
 * Joined in order into one body, as the engine runs them
 * (compileTransformerStepsToScript), so a later step can use what an earlier
 * one declared (D-285).
 */
function joinedSteps(prefix: string, steps: ChannelDetail['transformers'][number]['steps'], surface: ScriptSurface): TypedScript | null {
  const segments: ScriptSegment[] = [];
  const bodies: string[] = [];
  let next = 1;
  for (const [i, step] of steps.entries()) {
    const script = step.script ?? '';
    if (!step.enabled || script.trim() === '') continue;
    const count = lineCount(script);
    segments.push({ label: `${prefix} transformer step "${step.name ?? `Step ${String(i + 1)}`}"`, startLine: next, lineCount: count, typescript: step.language === 'TYPESCRIPT' });
    bodies.push(script);
    next += count;
  }
  if (!segments.some((s) => s.typescript)) return null;
  return { code: `${bodies.join('\n')}\nreturn msg;`, surface, segments };
}

function connectorScripts(channel: ChannelDetail): TypedScript[] {
  const dataType = channel.inboundDataType;
  const out: TypedScript[] = [];
  const stageSurface = (connectorId: string | null): ScriptSurface => (connectorId === null
    ? { dataType, destinationSet: true, templateContext: CODE_TEMPLATE_CONTEXT.SOURCE_FILTER_TRANSFORMER }
    : { dataType, templateContext: CODE_TEMPLATE_CONTEXT.DESTINATION_FILTER_TRANSFORMER });
  // Each filter rule compiles to its own function, so each is checked alone (D-285).
  for (const filter of channel.filters) {
    for (const [i, rule] of filter.rules.entries()) {
      if (!rule.enabled || rule.type !== 'JAVASCRIPT' || !isTypeScript(rule.language, rule.script)) continue;
      out.push(single(`${stageName(channel, filter.connectorId)} filter rule "${rule.name ?? `Rule ${String(i + 1)}`}"`, rule.script, stageSurface(filter.connectorId)));
    }
  }
  for (const transformer of channel.transformers) {
    const joined = joinedSteps(stageName(channel, transformer.connectorId), transformer.steps, stageSurface(transformer.connectorId));
    if (joined) out.push(joined);
  }
  for (const dest of channel.destinations) {
    if (!isTypeScript(dest.responseTransformerLanguage, dest.responseTransformer)) continue;
    out.push(single(`Response transformer of destination "${dest.name}"`, dest.responseTransformer, { dataType, templateContext: CODE_TEMPLATE_CONTEXT.DESTINATION_RESPONSE_TRANSFORMER }));
  }
  return out;
}

/**
 * Their language is `scriptLanguage` in the connector's properties, missing
 * means JavaScript (D-296). The polling script runs with no message; a
 * destination's script also gets the connector message (engine.ts).
 */
function javascriptConnectorScripts(channel: ChannelDetail): TypedScript[] {
  const out: TypedScript[] = [];
  const source = channel.sourceConnectorProperties;
  if (channel.sourceConnectorType === 'JAVASCRIPT' && isTypeScript(toScriptLanguage(source['scriptLanguage']), connectorScript(source))) {
    out.push(single('JavaScript source polling script', connectorScript(source), { message: false, templateContext: CODE_TEMPLATE_CONTEXT.SOURCE_RECEIVER }));
  }
  for (const dest of channel.destinations) {
    if (dest.connectorType !== 'JAVASCRIPT' || !isTypeScript(toScriptLanguage(dest.properties['scriptLanguage']), connectorScript(dest.properties))) continue;
    out.push(single(`Script of JavaScript destination "${dest.name}"`, connectorScript(dest.properties), {
      dataType: channel.inboundDataType, connectorMessage: true, templateContext: CODE_TEMPLATE_CONTEXT.DESTINATION_DISPATCHER,
    }));
  }
  return out;
}

function connectorScript(properties: Readonly<Record<string, unknown>>): string {
  return typeof properties['script'] === 'string' ? properties['script'] : '';
}

/** Global scripts are not included: they are checked when saved (D-285). */
export function typeScriptScripts(channel: ChannelDetail): TypedScript[] {
  const own = channel.scripts.flatMap((s): TypedScript[] => {
    const meta = CHANNEL_SCRIPTS[s.scriptType];
    if (!meta || !isTypeScript(s.language, s.script)) return [];
    const surface: ScriptSurface = meta.message
      ? { dataType: channel.inboundDataType, templateContext: meta.context }
      : { message: false, templateContext: meta.context };
    return [single(meta.name, s.script, surface)];
  });
  return [...own, ...connectorScripts(channel), ...javascriptConnectorScripts(channel)];
}

export type GlobalScriptKey = (typeof GLOBAL_SCRIPTS)[number]['key'];

/** Global scripts run for every channel, so msg has no one data type. */
export function typeScriptGlobalScripts(globals: GlobalScriptsData, keys: readonly GlobalScriptKey[]): TypedScript[] {
  return GLOBAL_SCRIPTS.flatMap((g): TypedScript[] =>
    (keys.includes(g.key) && isTypeScript(globals.languages[g.key], globals[g.key])
      ? [single(g.name, globals[g.key], g.message ? { templateContext: g.context } : { message: false, templateContext: g.context })]
      : []));
}

function attribute(script: TypedScript, errors: readonly ScriptTypeError[]): ScriptTypeFailure[] {
  const byLabel = new Map<string, ScriptTypeError[]>();
  for (const error of errors) {
    const segment = script.segments.find((s) => error.line >= s.startLine && error.line < s.startLine + s.lineCount);
    // An error past the last part is on the engine's own `return msg;`; none is expected.
    if (!segment?.typescript) continue;
    const list = byLabel.get(segment.label) ?? [];
    list.push({ ...error, line: error.line - segment.startLine + 1 });
    byLabel.set(segment.label, list);
  }
  // Per part, so a JavaScript step TypeScript cannot parse does not hide a
  // TypeScript step's type errors (D-285).
  return [...byLabel]
    .map(([label, list]) => ({ label, errors: onlySyntaxWhileBroken(list) }))
    .filter((f) => f.errors.length > 0);
}

/**
 * When the checker itself fails (busy, overran, crashed) nothing is known about
 * the scripts, so the refusal is UNAVAILABLE (503), to try again, not a 500 (#228).
 */
export async function findTypeFailures(scripts: readonly TypedScript[], templates: readonly TemplateSource[]): Promise<ScriptTypeFailure[]> {
  if (scripts.length === 0) return [];
  const result = await checkScriptTypesBatch(scripts.map((s) => ({ code: s.code, surface: s.surface })), templates);
  if (!result.ok) {
    const reason = result.error.message.replace(/\.?$/, '.');
    throw new ServiceError('UNAVAILABLE', `Could not type-check the TypeScript scripts: ${reason} Try again in a moment.`);
  }
  return scripts.flatMap((script, i) => attribute(script, result.value[i]!));
}

export function listTypeFailures(failures: readonly ScriptTypeFailure[]): string[] {
  const lines = failures.flatMap((f) => f.errors.map((e) => `- ${f.label}, line ${String(e.line)}: ${e.message}`));
  const shown = lines.slice(0, MAX_LISTED_TYPE_ERRORS);
  const more = lines.length - shown.length;
  return [...shown, ...(more > 0 ? [`- and ${String(more)} more`] : [])];
}

export function formatTypeFailures(channelName: string, failures: readonly ScriptTypeFailure[]): string {
  const scripts = failures.length === 1 ? 'a TypeScript script has' : `${String(failures.length)} TypeScript scripts have`;
  return [
    `"${channelName}" was not deployed: ${scripts} type errors. Fix them, or switch the script to JavaScript to deploy without type checks.`,
    ...listTypeFailures(failures),
  ].join('\n');
}

export async function assertScriptsTypeCheck(channel: ChannelDetail, templates: readonly TemplateSource[]): Promise<void> {
  const failures = await findTypeFailures(typeScriptScripts(channel), templates);
  if (failures.length > 0) {
    throw new ServiceError('INVALID_INPUT', formatTypeFailures(channel.name, failures), { typeErrors: failures });
  }
}

/** Only the scripts being saved are checked, so an older script saved before this rule cannot block an unrelated fix. */
export async function assertGlobalScriptsTypeCheck(
  globals: GlobalScriptsData, keys: readonly GlobalScriptKey[], templates: readonly TemplateSource[],
): Promise<void> {
  const failures = await findTypeFailures(typeScriptGlobalScripts(globals, keys), templates);
  if (failures.length > 0) {
    throw new ServiceError('INVALID_INPUT', [
      'The global scripts were not saved: a TypeScript global script has type errors. Fix them, or switch the script to JavaScript.',
      ...listTypeFailures(failures),
    ].join('\n'), { typeErrors: failures });
  }
}
