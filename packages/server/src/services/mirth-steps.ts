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

/** Mirth 3.x/4.x: <filter> is a sibling of <transformer>. Older exports nest it. */
export function filterOf(connector: Record<string, unknown>): Record<string, unknown> | null {
  return getNestedRecord(connector, 'filter') ?? getNestedRecord(getNestedRecord(connector, 'transformer') ?? {}, 'filter');
}

/** GalvaniGraph's name for a Mirth data type: Mirth calls X12 "EDI/X12". */
export function mirthDataType(name: string | null): string | null {
  return name === 'EDI/X12' ? 'X12' : name;
}

function dataTypes(transformer: Record<string, unknown>): readonly [string, string] {
  const type = (key: string): string => mirthDataType(getString(transformer, key)) ?? 'HL7V2';
  return [type('inboundDataType'), type('outboundDataType')];
}

/** Whether a destination's own transformer can make another message of the one it gets. */
export function transforms(destination: Record<string, unknown>): boolean {
  const transformer = getNestedRecord(destination, 'transformer') ?? {};
  const [inbound, outbound] = dataTypes(transformer);
  return inbound !== outbound || transformerSteps(transformer).some((s) => s.enabled);
}

function mapTransformerStepType(type: string | null): string {
  if (!type) return 'JAVASCRIPT';
  const upper = type.toUpperCase().replace(/\s+/g, '_');
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

export function unrunnableStepWarnings(steps: readonly TransformerStep[], channelName: string): string[] {
  return steps
    .filter((s) => s.enabled && !runnable(s))
    .map((s) => `Channel "${channelName}": GalvaniGraph cannot run the transformer step "${s.name ?? ''}" (${s.type}); the channel will not deploy until it is rewritten or disabled`);
}

export interface ResponseTransformer {
  readonly script: string | null;
  /** Why the channel may not run until someone decides. */
  readonly holds: readonly string[];
  readonly disabledSteps: readonly string[];
  /** Mirth's data types for the answer, in and out. */
  readonly dataTypes: readonly string[];
  readonly hasTemplates: boolean;
}

const NO_RESPONSE_TRANSFORMER: ResponseTransformer = { script: null, holds: [], disabledSteps: [], dataTypes: [], hasTemplates: false };

/** What a Mirth response transformer makes an answer an error, or a delivery, with. */
const DECIDES_DELIVERY = ['responseStatus', 'throw'] as const;

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
  const decides = DECIDES_DELIVERY.filter((word) => enabled.some((step) => new RegExp(`\\b${word}\\b`).test(step.script ?? '')));
  if (decides.length > 0) holds.push(`${of} uses ${decides.join(' and ')}, which decides in Mirth whether the message was delivered and cannot here`);
  const compiled = compileTransformerStepsToScript(parts);
  return {
    script: compiled.ok ? compiled.value : null,
    holds,
    disabledSteps: steps.filter((s) => !s.enabled).map((s) => s.name ?? ''),
    dataTypes: dataTypes(node),
    hasTemplates: ['inboundTemplate', 'outboundTemplate'].some((key) => (getString(node, key) ?? getString(node[key], '#text') ?? '') !== ''),
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
  const differences = [
    'it runs only for an answer that counts as delivered',
    'it cannot change whether the message counts as delivered',
    'the postprocessor and later destinations get the answer as it came',
  ];
  if (context.queued) differences.push('it does not run for a message the queue delivers');
  const other = [...new Set(transformer.dataTypes)].filter((type) => type !== context.dataType);
  if (other.length > 0) differences.push(`it gets the answer as the channel's ${context.dataType}, where Mirth used ${other.join(' and ')}`);
  if (transformer.hasTemplates) differences.push('its message templates are not carried');
  return [
    `${prefix} is carried as one script; here ${differences.join(', ')}`,
    ...transformer.disabledSteps.map((name) => `${prefix} has the disabled step "${name}", which is left out`),
  ];
}
