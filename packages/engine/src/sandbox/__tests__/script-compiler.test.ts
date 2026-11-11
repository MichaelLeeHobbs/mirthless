// ===========================================
// Script Compiler Tests
// ===========================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  compileScript,
  clearScriptCache,
  compileFilterRulesToScript,
  compileTransformerStepsToScript,
  type FilterRuleInput,
  SCRIPT_CACHE_LIMIT,
  scriptCacheSize,
} from '../script-compiler.js';
import { VmSandboxExecutor, DEFAULT_EXECUTION_OPTIONS } from '../sandbox-executor.js';
import { createSandboxContext } from '../sandbox-context.js';
import { createHl7Proxy } from '../../pipeline/data-type-handler.js';
import { Hl7Message } from '@galvaniflow/core-util';

beforeEach(() => {
  clearScriptCache();
});

describe('compileScript', () => {
  it('compiles valid TypeScript to JavaScript', async () => {
    const result = await compileScript('const x: number = 42; return x;');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toContain('const x = 42');
    expect(result.value.code).not.toContain(': number');
  });

  it('strips type annotations from interfaces', async () => {
    const code = `
      interface Msg { field: string; }
      const m: Msg = { field: "hello" };
      return m.field;
    `;
    const result = await compileScript(code);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).not.toContain('interface');
  });

  it('returns inline source map when sourcemap enabled', async () => {
    const result = await compileScript('const x = 1;', { sourcemap: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toContain('sourceMappingURL');
  });

  it('omits source map when sourcemap disabled', async () => {
    const result = await compileScript('const x = 1;', { sourcemap: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).not.toContain('sourceMappingURL');
  });

  it('returns error for invalid TypeScript', async () => {
    // esbuild is lenient with TS errors but fails on syntax errors
    const result = await compileScript('const x: = ;');

    expect(result.ok).toBe(false);
  });

  it('caches compiled results for identical source', async () => {
    const code = 'const y: string = "cached";';
    const result1 = await compileScript(code);
    const result2 = await compileScript(code);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;
    // Same reference from cache
    expect(result1.value).toBe(result2.value);
  });

  it('handles arrow functions and modern syntax', async () => {
    const code = 'const fn = (x: number): number => x * 2; return fn(21);';
    const result = await compileScript(code);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toContain('=>');
  });

  it('handles as const assertions', async () => {
    const code = 'const vals = ["a", "b"] as const; return vals[0];';
    const result = await compileScript(code);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).not.toContain('as const');
  });

  it('uses custom sourcefile name in source map', async () => {
    const result = await compileScript('return 1;', {
      sourcefile: 'channel-filter.ts',
      sourcemap: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Source file name is embedded in the base64-encoded inline source map
    const match = result.value.code.match(/sourceMappingURL=data:[^,]+,(.+)/);
    expect(match).toBeTruthy();
    const decoded = Buffer.from(match![1]!, 'base64').toString('utf-8');
    expect(decoded).toContain('channel-filter.ts');
  });

  it('clearScriptCache empties the cache', async () => {
    const code = 'const z = 1;';
    const result1 = await compileScript(code);
    clearScriptCache();
    const result2 = await compileScript(code);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;
    // After clearing, should be a new object
    expect(result1.value).not.toBe(result2.value);
    // But same content
    expect(result1.value.code).toBe(result2.value.code);
  });
});

/** Unwrap a successful compile, failing the test otherwise. */
function script(result: ReturnType<typeof compileFilterRulesToScript>): string | null {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error.message}`);
  return result.value;
}

/** Run a generated filter script against a message and return its verdict. */
async function runFilter(code: string | null, msg: unknown): Promise<unknown> {
  if (code === null) throw new Error('no script generated');
  const executor = new VmSandboxExecutor();
  const result = await executor.execute({ code }, createSandboxContext(msg, ''), DEFAULT_EXECUTION_OPTIONS);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.returnValue;
}

const ADT = createHl7Proxy(Hl7Message.parse('MSH|^~\\&|LAB|FAC|EHR|FAC|20260101||ADT^A01|1|P|2.5\rPID|1||000123'));

function builder(condition: string, values: string[], field = 'MSH.9.1'): FilterRuleInput {
  return { enabled: true, operator: 'AND', type: 'RULE_BUILDER', script: null, field, condition, values };
}

describe('compileFilterRulesToScript', () => {
  it('returns null for empty rules array', () => {
    expect(script(compileFilterRulesToScript([]))).toBeNull();
  });

  it('returns null when all rules are disabled', () => {
    const rules = [
      { enabled: false, operator: 'AND', type: 'JAVASCRIPT', script: 'return true;' },
      { enabled: false, operator: 'AND', type: 'RULE_BUILDER', script: null },
    ];
    expect(script(compileFilterRulesToScript(rules))).toBeNull();
  });

  it('skips an enabled JavaScript rule with an empty script', () => {
    const rules = [{ enabled: true, operator: 'AND', type: 'JAVASCRIPT', script: '' }];
    expect(script(compileFilterRulesToScript(rules))).toBeNull();
  });

  it('compiles single JS rule into a return statement', () => {
    const rules = [
      { enabled: true, operator: 'AND', type: 'JAVASCRIPT', script: 'return msg.type === "ADT";' },
    ];
    const result = script(compileFilterRulesToScript(rules));
    expect(result).toContain('return');
    expect(result).toContain('msg.type === "ADT"');
  });

  it('combines multiple rules with AND operator', async () => {
    const rules = [
      { enabled: true, operator: 'AND', type: 'JAVASCRIPT', script: 'return true;' },
      { enabled: true, operator: 'AND', type: 'JAVASCRIPT', script: 'return false;' },
    ];
    expect(await runFilter(script(compileFilterRulesToScript(rules)), {})).toBe(false);
  });

  it('combines multiple rules with OR operator', async () => {
    const rules = [
      { enabled: true, operator: 'AND', type: 'JAVASCRIPT', script: 'return true;' },
      { enabled: true, operator: 'OR', type: 'JAVASCRIPT', script: 'return false;' },
    ];
    expect(await runFilter(script(compileFilterRulesToScript(rules)), {})).toBe(true);
  });

  it('skips disabled rules in combination', () => {
    const rules = [
      { enabled: true, operator: 'AND', type: 'JAVASCRIPT', script: 'return true;' },
      { enabled: false, operator: 'AND', type: 'JAVASCRIPT', script: 'return false;' },
      { enabled: true, operator: 'AND', type: 'JAVASCRIPT', script: 'return true;' },
    ];
    const result = script(compileFilterRulesToScript(rules));
    expect(result).toContain('&&');
    expect(result).not.toContain('return false');
  });

  describe('Rule Builder', () => {
    it.each([
      ['EQUALS', ['ADT'], true],
      ['EQUALS', ['ORU', 'ADT'], true],
      ['EQUALS', ['ORU'], false],
      ['NOT_EQUALS', ['ORU'], true],
      ['NOT_EQUALS', ['ADT'], false],
      ['CONTAINS', ['D'], true],
      ['CONTAINS', ['X'], false],
      ['NOT_CONTAINS', ['X'], true],
      ['NOT_CONTAINS', ['D'], false],
      ['STARTS_WITH', ['AD'], true],
      ['STARTS_WITH', ['DT'], false],
      ['ENDS_WITH', ['DT'], true],
      ['ENDS_WITH', ['AD'], false],
      ['REGEX', ['^A.T$'], true],
      ['REGEX', ['^O'], false],
      ['EXISTS', [], true],
      ['NOT_EXISTS', [], false],
    ] as const)('%s %j on an HL7 field gives %s', async (condition, values, expected) => {
      const code = script(compileFilterRulesToScript([builder(condition, [...values])]));
      expect(await runFilter(code, ADT)).toBe(expected);
    });

    it('treats a missing HL7 field as empty text', async () => {
      const exists = script(compileFilterRulesToScript([builder('EXISTS', [], 'PID.19')]));
      const notExists = script(compileFilterRulesToScript([builder('NOT_EXISTS', [], 'PID.19')]));
      expect(await runFilter(exists, ADT)).toBe(false);
      expect(await runFilter(notExists, ADT)).toBe(true);
    });

    it('compares text, so an identifier keeps its leading zeros', async () => {
      const code = script(compileFilterRulesToScript([builder('EQUALS', ['000123'], 'PID.3')]));
      expect(await runFilter(code, ADT)).toBe(true);
      const numeric = script(compileFilterRulesToScript([builder('EQUALS', ['123'], 'PID.3')]));
      expect(await runFilter(numeric, ADT)).toBe(false);
    });

    it('reads a dotted path from a JSON message', async () => {
      const code = script(compileFilterRulesToScript([builder('EQUALS', ['final'], 'report.status')]));
      expect(await runFilter(code, { report: { status: 'final' } })).toBe(true);
      expect(await runFilter(code, { report: null })).toBe(false);
      expect(await runFilter(code, {})).toBe(false);
    });

    it('cannot be used to inject code through the field or values', async () => {
      const evil = '"); globalThis.hacked = true; ("';
      const code = script(compileFilterRulesToScript([builder('EQUALS', [evil], evil)]));
      expect(await runFilter(`${code!.replace(/^return /, 'var verdict = ')} return [verdict, typeof hacked].join();`, {}))
        .toBe('false,undefined');
    });

    it('joins with a JavaScript rule', async () => {
      const rules = [
        builder('EQUALS', ['ORU']),
        { enabled: true, operator: 'OR', type: 'JAVASCRIPT', script: 'return msg.get("PID.3") === "000123";' },
      ];
      expect(await runFilter(script(compileFilterRulesToScript(rules)), ADT)).toBe(true);
    });

    it.each([
      ['no field', { ...builder('EQUALS', ['A']), field: '  ' }, 'has no field'],
      ['a null field', { ...builder('EQUALS', ['A']), field: null }, 'has no field'],
      ['an unknown condition', builder('SOUNDS_LIKE', ['A']), 'unknown condition "SOUNDS_LIKE"'],
      ['a condition named like an Object method', builder('constructor', ['A']), 'unknown condition'],
      ['a missing condition', { ...builder('EQUALS', ['A']), condition: null }, 'unknown condition'],
      ['no values', builder('EQUALS', []), 'needs at least one value'],
      ['null values', { ...builder('CONTAINS', []), values: null }, 'needs at least one value'],
      ['an invalid regular expression', builder('REGEX', ['(']), 'invalid regular expression "("'],
    ])('fails when a rule has %s', (_name, rule, message) => {
      const result = compileFilterRulesToScript([{ enabled: true, operator: 'AND', type: 'JAVASCRIPT', script: 'return true;' }, rule]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('Filter rule 2');
      expect(result.error.message).toContain(message);
    });
  });

  it('fails for an enabled rule of a type the engine cannot run', () => {
    const result = compileFilterRulesToScript([{ enabled: true, operator: 'AND', type: 'EXTERNAL_SCRIPT', script: null }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('Filter rule 1 has type EXTERNAL_SCRIPT, which this engine cannot run');
  });

  it('runs a rule of another type when it carries a script', async () => {
    const rules = [{ enabled: true, operator: 'AND', type: 'IMPORTED', script: 'return false;' }];
    expect(await runFilter(script(compileFilterRulesToScript(rules)), {})).toBe(false);
  });
});

describe('compileTransformerStepsToScript', () => {
  it('returns null for empty steps array', () => {
    expect(script(compileTransformerStepsToScript([]))).toBeNull();
  });

  it('returns null when all steps are disabled', () => {
    const steps = [
      { enabled: false, type: 'JAVASCRIPT', script: 'tmp.x = 1;' },
      { enabled: false, type: 'MAPPER', script: null },
    ];
    expect(script(compileTransformerStepsToScript(steps))).toBeNull();
  });

  it('compiles single step into script ending with return msg', () => {
    const steps = [
      { enabled: true, type: 'JAVASCRIPT', script: 'tmp.x = 1;' },
    ];
    const result = script(compileTransformerStepsToScript(steps));
    expect(result).toContain('tmp.x = 1;');
    expect(result).toContain('return msg;');
  });

  it('compiles multiple steps sequentially', () => {
    const steps = [
      { enabled: true, type: 'JAVASCRIPT', script: 'tmp.a = 1;' },
      { enabled: true, type: 'JAVASCRIPT', script: 'tmp.b = 2;' },
    ];
    const result = script(compileTransformerStepsToScript(steps));
    expect(result).toContain('tmp.a = 1;');
    expect(result).toContain('tmp.b = 2;');
    expect(result).toContain('return msg;');
  });

  it('skips disabled steps', () => {
    const steps = [
      { enabled: true, type: 'JAVASCRIPT', script: 'tmp.a = 1;' },
      { enabled: false, type: 'JAVASCRIPT', script: 'tmp.b = 2;' },
    ];
    const result = script(compileTransformerStepsToScript(steps));
    expect(result).toContain('tmp.a = 1;');
    expect(result).not.toContain('tmp.b = 2;');
  });

  it('runs a Message Builder step, which is a script', () => {
    const steps = [{ enabled: true, type: 'MESSAGE_BUILDER', script: 'tmp.built = true;' }];
    expect(script(compileTransformerStepsToScript(steps))).toContain('tmp.built = true;');
  });

  it('skips an enabled script step with nothing in it', () => {
    const steps = [
      { enabled: true, type: 'JAVASCRIPT', script: '   ' },
      { enabled: true, type: 'MESSAGE_BUILDER', script: null },
    ];
    expect(script(compileTransformerStepsToScript(steps))).toBeNull();
  });

  it('fails for an enabled Mapper step, which has no script to run', () => {
    const steps = [
      { enabled: true, type: 'JAVASCRIPT', script: 'tmp.a = 1;' },
      { enabled: true, type: 'MAPPER', script: null },
    ];
    const result = compileTransformerStepsToScript(steps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('Transformer step 2 has type MAPPER, which this engine cannot run');
  });

  it('runs a step of another type when it carries a script', () => {
    const steps = [{ enabled: true, type: 'MAPPER', script: 'tmp.mapped = msg.a;' }];
    expect(script(compileTransformerStepsToScript(steps))).toContain('tmp.mapped = msg.a;');
  });
});

describe('script cache', () => {
  it('does not reuse a script compiled with other options', async () => {
    clearScriptCache();
    const withMap = await compileScript('return 1;', { sourcemap: true, sourcefile: 'a.ts' });
    const withoutMap = await compileScript('return 1;', { sourcemap: false, sourcefile: 'a.ts' });
    const otherFile = await compileScript('return 1;', { sourcemap: true, sourcefile: 'b.ts' });
    if (!withMap.ok || !withoutMap.ok || !otherFile.ok) throw new Error('compile failed');

    expect(withMap.value.code).toContain('sourceMappingURL');
    expect(withoutMap.value.code).not.toContain('sourceMappingURL');
    expect(otherFile.value.code).not.toBe(withMap.value.code);
  });

  it('returns the cached script for the same code and options', async () => {
    clearScriptCache();
    const first = await compileScript('return 2;');
    const second = await compileScript('return 2;');
    if (!first.ok || !second.ok) throw new Error('compile failed');
    expect(second.value).toBe(first.value);
  });

  it('stops growing at its limit, dropping the oldest entries', async () => {
    clearScriptCache();
    for (let i = 0; i < SCRIPT_CACHE_LIMIT + 5; i++) {
      await compileScript(`return ${String(i)};`, { sourcemap: false });
    }
    expect(scriptCacheSize()).toBe(SCRIPT_CACHE_LIMIT);

    // The newest is still cached; the oldest was dropped and compiles afresh.
    const newest = await compileScript(`return ${String(SCRIPT_CACHE_LIMIT + 4)};`, { sourcemap: false });
    expect(scriptCacheSize()).toBe(SCRIPT_CACHE_LIMIT);
    expect(newest.ok).toBe(true);
  }, 30_000);
});

describe('compiled filter rules insist on a boolean', () => {
  async function runFilter(rules: Parameters<typeof compileFilterRulesToScript>[0]): Promise<{ ok: boolean; value?: unknown; message?: string }> {
    const compiled = compileFilterRulesToScript(rules);
    if (!compiled.ok || compiled.value === null) throw new Error('expected a script');
    const { VmSandboxExecutor } = await import('../sandbox-executor.js');
    const { createSandboxContext } = await import('../sandbox-context.js');
    const result = await new VmSandboxExecutor().execute({ code: compiled.value }, createSandboxContext({}, ''), { timeout: 2_000 });
    return result.ok ? { ok: true, value: result.value.returnValue } : { ok: false, message: result.error.message };
  }
  const js = (script: string, operator = 'AND'): { enabled: boolean; operator: string; type: string; script: string } =>
    ({ enabled: true, operator, type: 'JAVASCRIPT', script });

  it('fails with the rule number when a rule returns nothing', async () => {
    const out = await runFilter([js('return true;'), js('var x = 1;')]);

    expect(out.ok).toBe(false);
    expect(out.message).toBe('Filter rule 2 returned nothing. A filter rule must return true or false.');
  });

  it.each([
    ['null', 'return null;', 'null'],
    ['a number', 'return 1;', 'a number'],
    ['text', "return 'true';", 'a string'],
  ])('fails when a rule returns %s', async (_name, script, described) => {
    const out = await runFilter([js(script)]);

    expect(out.message).toContain(`returned ${described}`);
  });

  it('combines boolean rules as before', async () => {
    expect((await runFilter([js('return true;'), js('return false;')])).value).toBe(false);
    expect((await runFilter([js('return false;'), js('return true;', 'OR')])).value).toBe(true);
  });

  it('accepts a rule that ends in a line comment', async () => {
    expect((await runFilter([js('return true; // accept everything')])).value).toBe(true);
  });
});
