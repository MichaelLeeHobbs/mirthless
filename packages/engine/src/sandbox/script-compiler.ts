// ===========================================
// Script Compiler
// ===========================================
// Transpiles TypeScript user scripts to JavaScript using esbuild.
// Returns CompiledScript objects ready for sandbox execution.

import { transform } from 'esbuild';
import type { Result } from '@galvaniflow/core-util';
import { tryCatch } from '@galvaniflow/core-util';
import type { CompiledScript } from './sandbox-executor.js';

// ----- Compile Options -----

export interface CompileOptions {
  readonly sourcefile?: string;
  readonly sourcemap?: boolean;
}

const DEFAULT_COMPILE_OPTIONS: CompileOptions = {
  sourcefile: 'script.ts',
  sourcemap: true,
} as const;

// ----- Compiler -----

/** Script cache keyed by source code hash. */
const scriptCache = new Map<string, CompiledScript>();

/** Compile TypeScript source to JavaScript via esbuild. */
export async function compileScript(
  code: string,
  options?: CompileOptions,
): Promise<Result<CompiledScript>> {
  return tryCatch(async () => {
    const cached = scriptCache.get(code);
    if (cached) return cached;

    const opts = { ...DEFAULT_COMPILE_OPTIONS, ...options };

    const transformOptions: Parameters<typeof transform>[1] = {
      loader: 'ts',
      target: 'es2022',
      sourcemap: opts.sourcemap ? 'inline' : false,
    };
    if (opts.sourcefile) {
      transformOptions.sourcefile = opts.sourcefile;
    }

    const result = await transform(code, transformOptions);

    const compiled: CompiledScript = result.map
      ? { code: result.code, sourceMap: result.map }
      : { code: result.code };

    scriptCache.set(code, compiled);
    return compiled;
  });
}

/** Clear the script compilation cache. */
export function clearScriptCache(): void {
  scriptCache.clear();
}

// ----- Filter/Transformer Compilation -----
// A rule or step the engine cannot run is an error, never a skip: dropping a filter
// rule lets every message through, and dropping a transformer step forwards data
// that was meant to be changed or removed.

const OK_NULL: Result<string | null> = { ok: true, value: null, error: null };

function okScript(value: string): Result<string | null> {
  return { ok: true, value, error: null };
}

function unsupported(message: string): Result<never> {
  return { ok: false, value: null, error: new Error(message) } as Result<never>;
}

/** A single filter rule for compilation. */
export interface FilterRuleInput {
  readonly enabled: boolean;
  readonly operator: string;
  readonly type: string;
  readonly script: string | null;
  /** Rule Builder: HL7 path (`MSH.9.1`) or dotted property path into `msg`. */
  readonly field?: string | null | undefined;
  /** Rule Builder: one of RULE_BUILDER_CONDITIONS. */
  readonly condition?: string | null | undefined;
  /** Rule Builder: values the field is compared with. */
  readonly values?: ReadonlyArray<string> | null | undefined;
}

/** Rule Builder conditions mapped to a JavaScript test of `s` (the field text) against `vals`. */
const RULE_BUILDER_CONDITIONS: Readonly<Record<string, string>> = {
  EQUALS: 'vals.indexOf(s) !== -1',
  NOT_EQUALS: 'vals.indexOf(s) === -1',
  CONTAINS: 'vals.some(function (v) { return s.indexOf(v) !== -1; })',
  NOT_CONTAINS: '!vals.some(function (v) { return s.indexOf(v) !== -1; })',
  EXISTS: "s !== ''",
  NOT_EXISTS: "s === ''",
  STARTS_WITH: 'vals.some(function (v) { return s.lastIndexOf(v, 0) === 0; })',
  ENDS_WITH: 'vals.some(function (v) { return v.length <= s.length && s.indexOf(v, s.length - v.length) !== -1; })',
  REGEX: 'vals.some(function (v) { return new RegExp(v).test(s); })',
};

const CONDITIONS_WITHOUT_VALUES: ReadonlySet<string> = new Set(['EXISTS', 'NOT_EXISTS']);

/** Reject a Rule Builder regex at deploy time instead of on the first message. */
function firstInvalidRegex(values: ReadonlyArray<string>): string | null {
  for (const value of values) {
    try {
      new RegExp(value);
    } catch {
      return value;
    }
  }
  return null;
}

/** Generate the body of a Rule Builder rule. User text is embedded only as JSON literals. */
function ruleBuilderBody(rule: FilterRuleInput, position: number): Result<string> {
  const field = rule.field?.trim() ?? '';
  const condition = rule.condition ?? '';
  const values = rule.values ?? [];
  const test = Object.hasOwn(RULE_BUILDER_CONDITIONS, condition) ? RULE_BUILDER_CONDITIONS[condition] : undefined;
  if (field === '') return unsupported(`Filter rule ${String(position)} (Rule Builder) has no field`);
  if (test === undefined) return unsupported(`Filter rule ${String(position)} (Rule Builder) has an unknown condition "${condition}"`);
  if (!CONDITIONS_WITHOUT_VALUES.has(condition) && values.length === 0) {
    return unsupported(`Filter rule ${String(position)} (Rule Builder) needs at least one value for ${condition}`);
  }
  if (condition === 'REGEX') {
    const bad = firstInvalidRegex(values);
    if (bad !== null) return unsupported(`Filter rule ${String(position)} (Rule Builder) has an invalid regular expression "${bad}"`);
  }
  const body =
    `var f = ${JSON.stringify(field)}; var vals = ${JSON.stringify(values)};` +
    " var raw = (msg !== null && typeof msg === 'object' && typeof msg.get === 'function')" +
    ' ? msg.get(f)' +
    " : f.split('.').reduce(function (o, k) { return o === null || o === undefined ? undefined : o[k]; }, msg);" +
    " var s = raw === null || raw === undefined ? '' : String(raw);" +
    ` return ${test};`;
  return { ok: true, value: body, error: null };
}

/** Turn one enabled filter rule into a function body, or explain why it cannot run. */
function filterRuleBody(rule: FilterRuleInput, position: number): Result<string | null> {
  if (rule.type === 'RULE_BUILDER') return ruleBuilderBody(rule, position);
  const script = rule.script ?? '';
  if (rule.type === 'JAVASCRIPT') return script === '' ? OK_NULL : okScript(script);
  // Any other type (for example an imported rule) runs only if it carries a script.
  if (script.trim() === '') {
    return unsupported(`Filter rule ${String(position)} has type ${rule.type}, which this engine cannot run`);
  }
  return okScript(script);
}

/**
 * Compile filter rules into a single boolean-returning script.
 * Returns null when there is nothing to run, and an error when an enabled rule
 * cannot be run (so the caller can refuse to deploy).
 */
export function compileFilterRulesToScript(
  rules: ReadonlyArray<FilterRuleInput>,
): Result<string | null> {
  const parts: string[] = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    if (!rule.enabled) continue;
    const body = filterRuleBody(rule, i + 1);
    if (!body.ok) return body;
    if (body.value === null) continue;
    const wrapped = `(function() { ${body.value} })()`;
    // The first rule's operator is ignored; later rules say how they join.
    parts.push(parts.length === 0 ? wrapped : ` ${rule.operator === 'OR' ? '||' : '&&'} ${wrapped}`);
  }
  if (parts.length === 0) return OK_NULL;
  return okScript(`return ${parts.join('')};`);
}

/** A single transformer step for compilation. */
export interface TransformerStepInput {
  readonly enabled: boolean;
  readonly type: string;
  readonly script: string | null;
}

/**
 * Compile transformer steps into a sequential execution script.
 * Returns null when there is nothing to run, and an error when an enabled step
 * cannot be run. JavaScript and Message Builder steps are scripts; any other type
 * runs only if it carries a script.
 */
export function compileTransformerStepsToScript(
  steps: ReadonlyArray<TransformerStepInput>,
): Result<string | null> {
  const lines: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (!step.enabled) continue;
    const script = step.script ?? '';
    if (script.trim() === '') {
      if (step.type === 'JAVASCRIPT' || step.type === 'MESSAGE_BUILDER') continue;
      return unsupported(`Transformer step ${String(i + 1)} has type ${step.type}, which this engine cannot run`);
    }
    lines.push(script);
  }
  if (lines.length === 0) return OK_NULL;
  return okScript(`${lines.join('\n')}\nreturn msg;`);
}
