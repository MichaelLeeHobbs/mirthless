// Mirth filter rules and transformer steps, response transformers included.

import type { ChannelExportEntry } from '@galvanigraph/core-models';
import { isPlainObject } from '@galvanigraph/core-util';
import { compileTransformerStepsToScript } from '@galvanigraph/engine';
import { getBoolean, getNestedRecord, getNumber, getString, toRecordList } from './mirth-xml.js';

type TransformerStep = ChannelExportEntry['transformers'][number]['steps'][number];

interface ScriptElement {
  /** Mirth 3.4+ element class without its package (`JavaScriptStep`); null for the 3.x `<step>` form. */
  readonly className: string | null;
  readonly node: Record<string, unknown>;
}

/**
 * Filter rules and transformer steps. Mirth 3.4+ lists them under `<elements>`,
 * one child per element named by its class
 * (`com.mirth.connect.plugins.javascriptstep.JavaScriptStep`). Earlier versions
 * use `<steps><step>` and `<rules><rule>` with a `<type>` child.
 */
export function scriptElements(container: Record<string, unknown>, legacyKey: 'steps' | 'rules', legacyChild: 'step' | 'rule'): readonly ScriptElement[] {
  const elements = container['elements'];
  if (isPlainObject(elements)) {
    const result: ScriptElement[] = [];
    for (const [key, value] of Object.entries(elements)) {
      if (key.startsWith('@_')) continue;
      const className = key.slice(key.lastIndexOf('.') + 1);
      for (const node of toRecordList(value)) result.push({ className, node });
    }
    return result.sort((a, b) => getNumber(a.node, 'sequenceNumber', 0) - getNumber(b.node, 'sequenceNumber', 0));
  }
  const legacy = container[legacyKey] ?? container[legacyChild];
  const list = isPlainObject(legacy) ? toRecordList(legacy[legacyChild]) : toRecordList(legacy);
  return list.map((node) => ({ className: null, node }));
}

function mapTransformerStepType(type: string | null): string {
  if (!type) return 'JAVASCRIPT';
  const upper = type.toUpperCase();
  if (upper.includes('JAVASCRIPT') || upper === 'STEP_BUILDER') return 'JAVASCRIPT';
  if (upper.includes('MAPPER') || upper === 'MAPPER') return 'MAPPER';
  if (upper.includes('MESSAGE_BUILDER') || upper === 'MESSAGEBUILDERSTEP') return 'MESSAGE_BUILDER';
  return upper;
}

/** A Mirth list of `Pair`s, whose elements are named by the pair's class. */
function pairList(node: unknown): ReadonlyArray<readonly [string, string]> {
  if (!isPlainObject(node)) return [];
  return Object.values(node).flatMap(toRecordList)
    .map((pair) => [getString(pair, 'left') ?? '', getString(pair, 'right') ?? ''] as const);
}

/**
 * The script Mirth's MessageBuilderStep.getScript generates, or null when the
 * step names nothing to set, which Mirth does not compile either.
 */
function messageBuilderScript(step: Record<string, unknown>): string | null {
  const segment = getString(step, 'messageSegment') ?? '';
  if (segment === '') return null;
  const orEmptyText = (key: string): string => getString(step, key) || "''";
  const replacements = pairList(step['replacements']).map(([from, to]) => `new Array(${from}, ${to})`).join(',');
  return `${segment} = validate(${orEmptyText('mapping')}, ${orEmptyText('defaultValue')}, new Array(${replacements}));`;
}

function transformerStep({ className, node }: ScriptElement): TransformerStep {
  const type = mapTransformerStepType(className ?? getString(node, 'type'));
  return {
    enabled: getBoolean(node, 'enabled', true),
    name: getString(node, 'name'),
    type,
    script: getString(node, 'script') ?? (type === 'MESSAGE_BUILDER' ? messageBuilderScript(node) : null),
    sourceField: getString(node, 'sourceField') ?? getString(node, 'field'),
    targetField: getString(node, 'targetField') ?? getString(node, 'variable'),
    defaultValue: getString(node, 'defaultValue'),
    mapping: getString(node, 'mapping'),
  };
}

export function transformerSteps(transformer: Record<string, unknown>): TransformerStep[] {
  return scriptElements(transformer, 'steps', 'step').map(transformerStep);
}

function runnable(step: TransformerStep): boolean {
  return compileTransformerStepsToScript([{ ...step, enabled: true }]).ok;
}

export function messageBuilderWarnings(steps: readonly TransformerStep[], channelName: string): string[] {
  return steps
    .filter((s) => s.enabled && s.type === 'MESSAGE_BUILDER' && !runnable(s))
    .map((s) => `Channel "${channelName}": Message Builder step "${s.name ?? ''}" names nothing to set; it will not deploy until it is rewritten or disabled`);
}

export interface ResponseTransformer {
  readonly script: string | null;
  /** Why the channel may not run until someone decides. */
  readonly holds: readonly string[];
  readonly disabledSteps: readonly string[];
  /** Mirth's data types for the answer, in and out. */
  readonly dataTypes: readonly string[];
}

const NO_RESPONSE_TRANSFORMER: ResponseTransformer = { script: null, holds: [], disabledSteps: [], dataTypes: [] };

/** A destination has one response transformer script and no steps, so Mirth's enabled steps become one script. */
export function responseTransformer(destination: Record<string, unknown>): ResponseTransformer {
  const node = getNestedRecord(destination, 'responseTransformer');
  const steps = node ? transformerSteps(node) : [];
  const enabled = steps.filter((s) => s.enabled);
  if (!node || enabled.length === 0) return NO_RESPONSE_TRANSFORMER;
  const of = `the response transformer of "${getString(destination, 'name') ?? ''}"`;
  const holds: string[] = [];
  const parts = enabled.map((step) => {
    if (runnable(step)) return step;
    const what = `the step "${step.name ?? ''}" (${step.type})`;
    holds.push(`${of} has ${what}, which GalvaniGraph cannot run`);
    // In its place, so that it fails on every answer instead of being skipped (D-207).
    return { ...step, type: 'JAVASCRIPT', script: `throw new Error(${JSON.stringify(`Not imported from Mirth: ${what}. Rewrite it here.`)});` };
  });
  const compiled = compileTransformerStepsToScript(parts);
  const script = compiled.ok ? compiled.value : null;
  if (script !== null && /\bresponseStatus\b/.test(script)) {
    holds.push(`${of} uses responseStatus, which decides in Mirth whether the message was delivered and does not exist here`);
  }
  return {
    script,
    holds,
    disabledSteps: steps.filter((s) => !s.enabled).map((s) => s.name ?? ''),
    dataTypes: [getString(node, 'inboundDataType') ?? 'HL7V2', getString(node, 'outboundDataType') ?? 'HL7V2'],
  };
}

export interface ResponseTransformerContext {
  readonly channelName: string;
  readonly destination: string;
  readonly queued: boolean;
  /** What GalvaniGraph parses the answer as. */
  readonly dataType: string;
}

export function responseTransformerWarnings(transformer: ResponseTransformer, context: ResponseTransformerContext): string[] {
  if (transformer.script === null) return [];
  const prefix = `Channel "${context.channelName}": destination "${context.destination}"'s response transformer`;
  const differences = ['it cannot change whether the message counts as delivered'];
  if (context.queued) differences.push('it does not run for a message the queue delivers');
  const other = [...new Set(transformer.dataTypes)].filter((type) => type !== context.dataType);
  if (other.length > 0) differences.push(`it gets the answer as the channel's ${context.dataType}, where Mirth used ${other.join(' and ')}`);
  return [
    `${prefix} is carried as one script; here ${differences.join(', and ')}`,
    ...transformer.disabledSteps.map((name) => `${prefix} has the disabled step "${name}", which is left out`),
  ];
}
