import { transform, type TransformOptions } from 'esbuild';
import type { Result } from '@galvanigraph/core-util';
import { tryCatch } from '@galvanigraph/core-util';
import { SCRIPT_BODY_OPEN, regexError, scriptBodyPosition, wrapScriptBody } from '@galvanigraph/core-models';
import type { CompiledScript } from './sandbox-executor.js';

export interface CompileOptions {
  readonly sourcefile?: string;
  readonly sourcemap?: boolean;
  /** Default true. A one-off syntax check passes false so it does not evict scripts deploy compiled. */
  readonly cache?: boolean;
}

const DEFAULT_COMPILE_OPTIONS: CompileOptions = {
  sourcefile: 'script.ts',
  sourcemap: true,
} as const;

export const SCRIPT_CACHE_LIMIT = 1_000;

/**
 * Bounded: a long-running server adds an entry for every edit of every script.
 * A Map keeps insertion order, so the first key is the oldest.
 */
const scriptCache = new Map<string, CompiledScript>();

export function scriptCacheSize(): number {
  return scriptCache.size;
}

function remember(key: string, compiled: CompiledScript): void {
  scriptCache.set(key, compiled);
  if (scriptCache.size <= SCRIPT_CACHE_LIMIT) return;
  const oldest = scriptCache.keys().next();
  if (!oldest.done) scriptCache.delete(oldest.value);
}

/**
 * The compiled function's body: the lines between the wrapper's first line
 * and its closing brace, plus the inline source map comment if there is one.
 * esbuild indents code lines but never the inside of a template literal.
 */
function unwrapBody(output: string): string {
  const lines = output.split('\n');
  const close = lines.lastIndexOf('}');
  if (!(lines[0] ?? '').startsWith(SCRIPT_BODY_OPEN) || close < 1) {
    throw new Error('Script compiler produced output it could not unwrap');
  }
  const trailer = lines.slice(close + 1).filter((l) => l.startsWith('//# sourceMappingURL='));
  return [...lines.slice(1, close), ...trailer].join('\n');
}

/**
 * Asks esbuild, off the main thread: compiled for a target without `import()`, only a script that
 * has one comes out different.
 */
async function usesDynamicImport(source: string, options: TransformOptions, compiled: string): Promise<boolean> {
  if (!compiled.includes('import')) return false;
  const without = await transform(source, { ...options, supported: { 'dynamic-import': false } });
  return without.code !== compiled;
}

export async function compileScript(
  code: string,
  options?: CompileOptions,
): Promise<Result<CompiledScript>> {
  return tryCatch(async () => {
    const opts = { ...DEFAULT_COMPILE_OPTIONS, ...options };
    // The options change the output (source map, file name), so they are part of the key.
    const key = `${opts.sourcemap ? '1' : '0'}\u0000${opts.sourcefile ?? ''}\u0000${code}`;
    const useCache = opts.cache !== false;
    const cached = useCache ? scriptCache.get(key) : undefined;
    if (cached) return cached;

    const transformOptions: TransformOptions = {
      loader: 'ts',
      target: 'es2022',
      sourcemap: opts.sourcemap ? 'inline' : false,
    };
    if (opts.sourcefile) {
      transformOptions.sourcefile = opts.sourcefile;
    }

    // A script is a function body (the executor runs it inside one), so it is
    // compiled as one: on its own, a top-level await makes esbuild read it as a
    // module, where the script's top-level return is a syntax error.
    const source = wrapScriptBody(code);
    const result = await transform(source, transformOptions);
    const body = unwrapBody(result.code);
    // The sandbox would fail every message on it with a syntax error that does not say why.
    if (await usesDynamicImport(source, transformOptions, result.code)) throw new Error("Scripts can't load modules: import() is not available");

    const compiled: CompiledScript = result.map
      ? { code: body, sourceMap: result.map }
      : { code: body };

    if (useCache) remember(key, compiled);
    return compiled;
  });
}

interface CompileMessage {
  readonly text: string;
  readonly location?: { readonly line: number } | null;
}

function compileMessages(error: unknown): ReadonlyArray<CompileMessage> | null {
  if (error === null || typeof error !== 'object' || !('errors' in error)) return null;
  const { errors } = error as { readonly errors: unknown };
  return Array.isArray(errors) && errors.length > 0 ? (errors as ReadonlyArray<CompileMessage>) : null;
}

/**
 * The syntax errors from a failed {@link compileScript}, as `Line N: <text>`
 * with N counted in the user's script, not in the function the compiler wraps
 * it in. An error esbuild places on the wrapper's closing brace (an unclosed
 * block, say) is reported on the script's last line.
 */
export function compileErrorMessages(error: unknown, code: string): readonly string[] {
  const messages = compileMessages(error);
  if (messages === null) return [error instanceof Error ? error.message : 'Unknown syntax error'];
  return messages.map((m) => {
    if (!m.location) return m.text;
    const { line } = scriptBodyPosition(code, m.location.line, 1);
    return `Line ${String(line)}: ${m.text}`;
  });
}

export function clearScriptCache(): void {
  scriptCache.clear();
}

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

export interface FilterRuleInput {
  readonly enabled: boolean;
  readonly operator: string;
  readonly type: string;
  readonly script: string | null;
  /** Rule Builder: HL7 path (`MSH.9.1`) or dotted property path into `msg`. */
  readonly field?: string | null | undefined;
  /** Rule Builder: one of RULE_BUILDER_CONDITIONS. */
  readonly condition?: string | null | undefined;
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

/** User text is embedded only as JSON literals. */
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
  // Refused at deploy instead of on the first message.
  if (condition === 'REGEX') {
    const bad = values.find((value) => regexError(value) !== null);
    if (bad !== undefined) return unsupported(`Filter rule ${String(position)} (Rule Builder) has an invalid regular expression "${bad}"`);
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
 * A rule that returns anything but a boolean fails the message: treating it as "accept" would
 * send messages the filter was written to stop, and as "reject" would drop them quietly.
 */
function filterRuleCall(body: string, position: number): string {
  const n = String(position);
  return (
    `(function () { var r = (function () { ${body}\n})();` +
    " if (r !== true && r !== false) { throw new Error('Filter rule " + n + " returned ' +" +
    " (r === undefined ? 'nothing' : r === null ? 'null' : 'a ' + typeof r) + '. A filter rule must return true or false.'); }" +
    ' return r; })()'
  );
}

/** Null when there is nothing to run; an error when an enabled rule cannot run, so the caller can refuse to deploy. */
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
    const wrapped = filterRuleCall(body.value, i + 1);
    // The first rule's operator is ignored; later rules say how they join.
    parts.push(parts.length === 0 ? wrapped : ` ${rule.operator === 'OR' ? '||' : '&&'} ${wrapped}`);
  }
  if (parts.length === 0) return OK_NULL;
  return okScript(`return ${parts.join('')};`);
}

export interface TransformerStepInput {
  readonly enabled: boolean;
  readonly type: string;
  readonly script: string | null;
}

/** Null when there is nothing to run; an error when an enabled step cannot run. */
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
