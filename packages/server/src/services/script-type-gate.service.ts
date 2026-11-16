// ===========================================
// Script type gate
// ===========================================
// A user-started deploy refuses a channel whose TypeScript scripts have type
// errors (saving them is allowed). JavaScript scripts are never type-checked.
// The startup redeploy does not check at all: a channel that was running keeps
// running after a restart even if a template change since broke its types.
// Global scripts are not part of a channel's deploy check: a global script
// with type errors cannot be saved (checkGlobalScriptTypes), so one bad global
// script cannot stop every channel from deploying.
//
// Each script is checked on the same surface the editor uses (msg typed by the
// channel's inbound data type, its code template context). A transformer's
// steps are checked joined into one body, the way the engine compiles and runs
// them, so a step can use what an earlier step declared. Checks run off the
// main thread and are cached (checkScriptTypesBatch).

import { checkScriptTypesBatch, onlySyntaxWhileBroken, type ScriptTypeError } from '@galvaniflow/engine';
import { CODE_TEMPLATE_CONTEXT, toScriptLanguage, type ScriptSurface, type TemplateSource } from '@galvaniflow/core-models';
import { ServiceError } from '../lib/service-error.js';
import type { ChannelDetail } from './channel.service.js';
import type { GlobalScriptsData } from './global-script.service.js';

/** A part of a checked script that the user knows by one name. */
export interface ScriptSegment {
  readonly label: string;
  /** 1-based first line of this part in the checked code. */
  readonly startLine: number;
  readonly lineCount: number;
  /** Errors are reported only for TypeScript parts; JavaScript is not type-checked. */
  readonly typescript: boolean;
}

/** One type check: a script (or a transformer's joined steps) and how to name its errors. */
export interface TypedScript {
  readonly code: string;
  readonly surface: ScriptSurface;
  readonly segments: readonly ScriptSegment[];
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

const lineCount = (code: string): number => code.split('\n').length;

/** A single script, all of it TypeScript. */
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
 * A transformer's steps as the engine runs them: every enabled step with a
 * script, joined in order into one body (compileTransformerStepsToScript), so
 * a later step can use what an earlier one declared. Checked only when at least
 * one of those steps is TypeScript.
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

/** Filter, transformer and response transformer scripts written in TypeScript. */
function connectorScripts(channel: ChannelDetail): TypedScript[] {
  const dataType = channel.inboundDataType;
  const out: TypedScript[] = [];
  const stageSurface = (connectorId: string | null): ScriptSurface => (connectorId === null
    ? { dataType, destinationSet: true, templateContext: CODE_TEMPLATE_CONTEXT.SOURCE_FILTER_TRANSFORMER }
    : { dataType, templateContext: CODE_TEMPLATE_CONTEXT.DESTINATION_FILTER_TRANSFORMER });
  // Filter rules are compiled each into its own function, so each is checked alone.
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
 * The JavaScript source's polling script and each JavaScript destination's
 * script, when written in TypeScript. Their language lives in the connector's
 * properties beside the script (`scriptLanguage`); missing means JavaScript.
 * The polling script runs with no message, like a deploy script; a
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

/** A JavaScript connector's script property, '' when missing. */
function connectorScript(properties: Readonly<Record<string, unknown>>): string {
  return typeof properties['script'] === 'string' ? properties['script'] : '';
}

/** Every TypeScript script that belongs to this channel (global scripts are checked when saved). */
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

/** Which global scripts: deploy, undeploy, preprocessor, postprocessor. */
export type GlobalScriptKey = (typeof GLOBAL_SCRIPTS)[number]['key'];

/** The TypeScript global scripts among `keys`. They run for every channel, so msg has no one data type. */
export function typeScriptGlobalScripts(globals: GlobalScriptsData, keys: readonly GlobalScriptKey[]): TypedScript[] {
  return GLOBAL_SCRIPTS.flatMap((g): TypedScript[] =>
    (keys.includes(g.key) && isTypeScript(globals.languages[g.key], globals[g.key])
      ? [single(g.name, globals[g.key], g.message ? { templateContext: g.context } : { message: false, templateContext: g.context })]
      : []));
}

/** Errors grouped by the part they fall in, on that part's own line numbers; JavaScript parts dropped. */
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
  // Per part: a JavaScript step that TypeScript cannot parse (esbuild can, e.g.
  // `010`) must not hide a TypeScript step's type errors.
  return [...byLabel]
    .map(([label, list]) => ({ label, errors: onlySyntaxWhileBroken(list) }))
    .filter((f) => f.errors.length > 0);
}

/** Type-check scripts off the main thread and name each error by the part the user wrote. */
export async function findTypeFailures(scripts: readonly TypedScript[], templates: readonly TemplateSource[]): Promise<ScriptTypeFailure[]> {
  if (scripts.length === 0) return [];
  const result = await checkScriptTypesBatch(scripts.map((s) => ({ code: s.code, surface: s.surface })), templates);
  if (!result.ok) throw new ServiceError('INTERNAL', `Could not type-check the TypeScript scripts: ${result.error.message}`);
  return scripts.flatMap((script, i) => attribute(script, result.value[i]!));
}

/** The list of failures: what failed and where, most errors listed. */
export function listTypeFailures(failures: readonly ScriptTypeFailure[]): string[] {
  const lines = failures.flatMap((f) => f.errors.map((e) => `- ${f.label}, line ${String(e.line)}: ${e.message}`));
  const shown = lines.slice(0, MAX_LISTED_TYPE_ERRORS);
  const more = lines.length - shown.length;
  return [...shown, ...(more > 0 ? [`- and ${String(more)} more`] : [])];
}

/** The deploy refusal. */
export function formatTypeFailures(channelName: string, failures: readonly ScriptTypeFailure[]): string {
  const scripts = failures.length === 1 ? 'a TypeScript script has' : `${String(failures.length)} TypeScript scripts have`;
  return [
    `"${channelName}" was not deployed: ${scripts} type errors. Fix them, or switch the script to JavaScript to deploy without type checks.`,
    ...listTypeFailures(failures),
  ].join('\n');
}

/** Refuse the deploy (INVALID_INPUT) when any of the channel's TypeScript scripts has a type error. */
export async function assertScriptsTypeCheck(channel: ChannelDetail, templates: readonly TemplateSource[]): Promise<void> {
  const failures = await findTypeFailures(typeScriptScripts(channel), templates);
  if (failures.length > 0) {
    throw new ServiceError('INVALID_INPUT', formatTypeFailures(channel.name, failures), { typeErrors: failures });
  }
}

/**
 * Refuse saving global scripts (INVALID_INPUT) when one of the scripts being
 * saved is TypeScript with a type error. Only those are checked, so an older
 * script saved before this rule cannot block an unrelated fix.
 */
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
