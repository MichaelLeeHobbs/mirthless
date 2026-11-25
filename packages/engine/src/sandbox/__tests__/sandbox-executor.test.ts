import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  VmSandboxExecutor,
  DEFAULT_EXECUTION_OPTIONS,
  type ExecutionOptions,
  type CompiledScript,
} from '../sandbox-executor.js';
import { createSandboxContext, type SandboxContext } from '../sandbox-context.js';
import { createHl7Proxy, createX12Proxy } from '../../pipeline/data-type-handler.js';
import { MAX_SCRIPT_LOG_LATER_LINE_CHARS, MAX_SCRIPT_LOG_LINES, MAX_SCRIPT_LOG_LINE_CHARS, MAX_SCRIPT_LOG_RUN_CHARS } from '@galvanigraph/core-models';
import { Hl7Message, X12Message } from '@galvanigraph/core-util';
import type { BridgeDependencies } from '../bridge-functions.js';
import { ScriptRunLog } from '../script-run-log.js';

function makeScript(code: string): CompiledScript {
  return { code };
}

function makeOptions(overrides?: Partial<ExecutionOptions>): ExecutionOptions {
  return { ...DEFAULT_EXECUTION_OPTIONS, ...overrides };
}

function makeContext(overrides?: Partial<SandboxContext>): SandboxContext {
  const base = createSandboxContext({ field: 'value' }, 'raw HL7 data');
  return { ...base, ...overrides };
}

let executor: VmSandboxExecutor;

beforeEach(() => {
  executor = new VmSandboxExecutor();
});

afterEach(() => {
  executor.dispose();
});

describe('VmSandboxExecutor', () => {
  describe('execute', () => {
    it('executes simple script and returns value', async () => {
      const script = makeScript('return 42;');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe(42);
    });

    it('accesses msg from context', async () => {
      const script = makeScript('return msg.field;');
      const context = makeContext({ msg: { field: 'hello' } });

      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('hello');
    });

    it('accesses rawData from context', async () => {
      const script = makeScript('return rawData.length;');
      const context = makeContext({ rawData: 'MSH|^~\\&|' });

      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe(9);
    });

    it('modifies channelMap and returns updates', async () => {
      const script = makeScript('channelMap["key1"] = "value1"; return true;');

      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.mapUpdates.channelMap['key1']).toBe('value1');
    });

    it('modifies connectorMap and returns updates', async () => {
      const script = makeScript('connectorMap["destKey"] = 123; return true;');

      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.mapUpdates.connectorMap['destKey']).toBe(123);
    });

    it('captures logger.info calls', async () => {
      const script = makeScript('logger.info("hello from sandbox"); return true;');

      const log = new ScriptRunLog('Source filter');

      const result = await executor.execute(script, makeContext(), { ...makeOptions(), log });

      expect(result.ok).toBe(true);
      expect(log.run()).toEqual({ script: 'Source filter', lines: [{ level: 'INFO', time: expect.stringMatching(/^\d{4}-.*Z$/) as string, text: 'hello from sandbox' }], leftOut: 0 });
    });

    it('captures multiple log levels', async () => {
      const script = makeScript(`
        logger.info("info msg");
        logger.warn("warn msg");
        logger.error("error msg");
        logger.debug("debug msg");
        return true;
      `);

      const log = new ScriptRunLog('Source filter');

      await executor.execute(script, makeContext(), { ...makeOptions(), log });

      expect(log.run()?.lines.map((l) => [l.level, l.text])).toEqual([['INFO', 'info msg'], ['WARN', 'warn msg'], ['ERROR', 'error msg'], ['DEBUG', 'debug msg']]);
    });

    it('has no run of a script that wrote nothing', async () => {
      const log = new ScriptRunLog('Source filter');

      await executor.execute(makeScript('return true;'), makeContext(), { ...makeOptions(), log });

      expect(log.run()).toBeNull();
    });

    it.each([
      ['throws', 'throw new Error("broke");'],
      ['runs out of time', 'while (true) { /* never ends */ }'],
      ['has a result that cannot be read', 'return { get x() { logger.warn("in a getter"); throw new Error("unreadable"); } };'],
    ])('keeps what a script wrote before it %s', async (_case, rest) => {
      const log = new ScriptRunLog('Source filter');

      const result = await executor.execute(makeScript(`logger.info("before"); ${rest}`), makeContext(), { ...makeOptions(), timeout: 500, log });

      expect(result.ok).toBe(false);
      expect(log.run()?.lines[0]).toMatchObject({ level: 'INFO', text: 'before' });
    });

    it.each([
      ['as many lines as are kept', MAX_SCRIPT_LOG_LINES, 0],
      ['one line more', MAX_SCRIPT_LOG_LINES + 1, 1],
      ['many more lines', 5_000, 5_000 - MAX_SCRIPT_LOG_LINES],
    ])('keeps the first lines of a run and counts the rest: %s', async (_case, count, leftOut) => {
      const log = new ScriptRunLog('Source filter');

      await executor.execute(makeScript(`for (let i = 1; i <= ${String(count)}; i++) logger.info(i);`), makeContext(), { ...makeOptions(), log });

      const run = log.run();
      expect(run?.lines).toHaveLength(MAX_SCRIPT_LOG_LINES);
      expect(run?.lines.at(-1)?.text).toBe(String(MAX_SCRIPT_LOG_LINES));
      expect(run?.leftOut).toBe(leftOut);
    });

    it('counts the lines left out of a run that fails', async () => {
      const log = new ScriptRunLog('Source filter');

      await executor.execute(makeScript('for (let i = 0; i < 300; i++) logger.info(i); throw new Error("broke");'), makeContext(), { ...makeOptions(), log });

      expect(log.run()).toMatchObject({ leftOut: 300 - MAX_SCRIPT_LOG_LINES });
    });

    it('cuts a line that is too long, and says by how much', async () => {
      const log = new ScriptRunLog('Source filter');

      await executor.execute(makeScript(`logger.info("x".repeat(${String(MAX_SCRIPT_LOG_LINE_CHARS)})); logger.info("x".repeat(${String(MAX_SCRIPT_LOG_LINE_CHARS + 7)}));`), makeContext(), { ...makeOptions(), log });

      const texts = log.run()?.lines.map((l) => l.text);
      expect(texts?.[0]).toBe('x'.repeat(MAX_SCRIPT_LOG_LINE_CHARS));
      expect(texts?.[1]).toBe(`${'x'.repeat(MAX_SCRIPT_LOG_LINE_CHARS)}... (7 more characters)`);
    });

    it('keeps all of the first lines of a run, and less of each once they hold much', async () => {
      const log = new ScriptRunLog('Source filter');
      const long = String(MAX_SCRIPT_LOG_LINE_CHARS);
      const full = MAX_SCRIPT_LOG_RUN_CHARS / MAX_SCRIPT_LOG_LINE_CHARS;

      await executor.execute(makeScript(`for (let i = 0; i < 210; i++) logger.info("x".repeat(${long}));`), makeContext(), { ...makeOptions(), log });

      const texts = log.run()?.lines.map((l) => l.text) ?? [];
      expect(texts).toHaveLength(MAX_SCRIPT_LOG_LINES);
      expect(texts.slice(0, full)).toEqual(Array<string>(full).fill('x'.repeat(MAX_SCRIPT_LOG_LINE_CHARS)));
      const cut = `${'x'.repeat(MAX_SCRIPT_LOG_LATER_LINE_CHARS)}... (${String(MAX_SCRIPT_LOG_LINE_CHARS - MAX_SCRIPT_LOG_LATER_LINE_CHARS)} more characters)`;
      expect(new Set(texts.slice(full))).toEqual(new Set([cut]));
      expect(log.run()?.leftOut).toBe(10);
    });

    it('keeps the first lines of a run whole whose one line is very long', async () => {
      const log = new ScriptRunLog('Source filter');

      await executor.execute(makeScript('logger.info("x".repeat(5000000)); logger.info("y".repeat(500));'), makeContext(), { ...makeOptions(), log });

      expect(log.run()?.lines.map((l) => l.text.length)).toEqual([MAX_SCRIPT_LOG_LINE_CHARS + '... (4990000 more characters)'.length, 500]);
    });

    it('keeps text as it is, lone surrogates and U+0000 too', async () => {
      const log = new ScriptRunLog('Source filter');
      await executor.execute(makeScript('logger.info("a\\u0000b\\ud800c \\u{1f600}");'), makeContext(), { ...makeOptions(), log });
      expect(log.run()?.lines[0]?.text).toBe('a\u0000b\ud800c \u{1f600}');
    });

    it('passes each line on as it is written, and the count at the end', async () => {
      const seen: unknown[] = [];
      const log = new ScriptRunLog('Source filter', { line: (l) => { seen.push(l.text); }, leftOut: (count) => { seen.push(count); } });

      await executor.execute(makeScript(`for (let i = 1; i <= ${String(MAX_SCRIPT_LOG_LINES + 2)}; i++) logger.info(i);`), makeContext(), { ...makeOptions(), log });

      expect(seen).toEqual([...Array.from({ length: MAX_SCRIPT_LOG_LINES }, (_, i) => String(i + 1)), 2]);
    });

    it('enforces timeout on long-running script', async () => {
      const script = makeScript('while(true) {}');
      const options = makeOptions({ timeout: 50 });

      const result = await executor.execute(script, makeContext(), options);

      expect(result.ok).toBe(false);
    });

    it('returns error for script with syntax error', async () => {
      const script = makeScript('return {{{;');

      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(false);
    });

    it('returns error for script that throws', async () => {
      const script = makeScript('throw new Error("script failure");');

      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(false);
    });

    it('returns error when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const options = makeOptions({ signal: controller.signal });
      const script = makeScript('return 1;');

      const result = await executor.execute(script, makeContext(), options);

      expect(result.ok).toBe(false);
    });

    it('executes filter script returning boolean true', async () => {
      const script = makeScript('return msg.type === "ADT";');
      const context = makeContext({ msg: { type: 'ADT' } });

      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe(true);
    });

    it('executes filter script returning boolean false', async () => {
      const script = makeScript('return msg.type === "ADT";');
      const context = makeContext({ msg: { type: 'ORM' } });

      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe(false);
    });

    it('executes transformer script that modifies tmp', async () => {
      const script = makeScript('tmp.newField = "added"; return tmp;');
      const context = makeContext({ tmp: { existing: 'data' } });

      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const returned = result.value.returnValue as Record<string, unknown>;
      expect(returned['newField']).toBe('added');
      expect(returned['existing']).toBe('data');
    });

    it('isolates context between executions', async () => {
      const script1 = makeScript('channelMap["counter"] = 1; return true;');
      const script2 = makeScript('return channelMap["counter"];');

      const result1 = await executor.execute(script1, makeContext(), makeOptions());
      expect(result1.ok).toBe(true);

      const result2 = await executor.execute(script2, makeContext(), makeOptions());
      expect(result2.ok).toBe(true);
      if (!result2.ok) return;
      expect(result2.value.returnValue).toBeUndefined();
    });
  });

  describe('per-script time limit', () => {
    it('stops a script waiting on slow IO at its own timeout, even when the caller passes a longer-lived signal', async () => {
      let answered = false;
      const slow = new VmSandboxExecutor({
        httpFetch: () => new Promise((resolve) => {
          setTimeout(() => { answered = true; resolve({ status: 200, statusText: 'OK', headers: {}, body: 'late' }); }, 400);
        }),
      });
      const script = makeScript("await httpFetch('https://example.com'); return 'finished';");

      const result = await slow.execute(script, makeContext(), { timeout: 50, signal: new AbortController().signal });

      expect(result.ok).toBe(false);
      // Whichever timer stops it, the error names the script's own limit (#125, #188).
      expect(result.ok ? '' : result.error.message).toBe('Script execution timed out after 50ms');
      // The 50ms limit's timer was set before the 400ms one, so it always fires first: the run
      // ended without waiting for the IO. Checking this, not the elapsed time, keeps the test off the clock.
      expect(answered).toBe(false);
    });

    it('returns the result of a script that finished in time, even when collecting it starts after the limit (#188)', async () => {
      // The script's last act moves the host clock far past the deadline, as a
      // descheduled host thread would between the script's end and the collection.
      // The limit is the generous one for a script that finishes (D-290): only the
      // clock jump puts the collection after the deadline, not the machine's speed.
      const realNow = Date.now.bind(Date);
      let skew = 0;
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
      try {
        const context = makeContext({ extras: { destinationSet: { removeAll: () => { skew = 60_000; } } } });
        const result = await executor.execute(makeScript("destinationSet.removeAll(); return 'done';"), context, { timeout: 10_000 });
        expect(result.ok ? result.value.returnValue : result.error.message).toBe('done');
      } finally {
        clock.mockRestore();
      }
    });

    it('still stops when the caller cancels first', async () => {
      const slow = new VmSandboxExecutor({
        httpFetch: () => new Promise((resolve) => { setTimeout(() => { resolve({ status: 200, statusText: 'OK', headers: {}, body: 'late' }); }, 400); }),
      });
      const script = makeScript("await httpFetch('https://example.com'); return 'finished';");

      const result = await slow.execute(script, makeContext(), { timeout: 5_000, signal: AbortSignal.timeout(30) });

      expect(result.ok).toBe(false);
    });
  });

  // Error.prototype.code is defined before the script runs, so that no script can put a setter there.
  describe("a script's own error codes", () => {
    it.each([
      ['assigned to an error', "var e = new Error('x'); e.code = 'OWN'; return e.code;"],
      ['assigned to a TypeError', "var e = new TypeError('x'); e.code = 'OWN'; return e.code;"],
      ['assigned in a subclass constructor', "class E extends Error { constructor(m) { super(m); this.code = 'OWN'; } } return new E('x').code;"],
      ['set by a class field', "class E extends Error { code = 'OWN'; } return new E('x').code;"],
      ['set by a getter in a subclass', "class E extends Error { get code() { return 'OWN'; } } return new E('x').code;"],
      ['set by a subclass accessor pair', "class E extends Error { set code(v) { this.kept = v; } get code() { return this.kept; } } var e = new E('x'); e.code = 'OWN'; return e.code;"],
      ['copied with Object.assign', "return Object.assign(new Error('x'), { code: 'OWN' }).code;"],
      ['defined as a property', "var e = new Error('x'); Object.defineProperty(e, 'code', { get: function () { return 'OWN'; } }); return e.code;"],
      ['assigned to Error.prototype', "Error.prototype.code = 'OWN'; return new Error('x').code;"],
      ['read back after a throw', "try { throw Object.assign(new Error('x'), { code: 'OWN' }); } catch (e) { return e.code; }"],
    ])('%s still work', async (_name, code) => {
      const result = await executor.execute(makeScript(code), makeContext(), makeOptions());

      expect(result.ok && result.value.returnValue).toBe('OWN');
    });

    it('are undefined when none is set, and an assigned one is an ordinary own property', async () => {
      const result = await executor.execute(
        makeScript("var e = new Error('x'); var before = e.code === undefined && !Object.hasOwn(e, 'code'); e.code = 'OWN'; return [before, Object.keys(e)];"),
        makeContext(), makeOptions(),
      );

      expect(result.ok && result.value.returnValue).toEqual([true, ['code']]);
    });
  });

  describe('escape prevention', () => {
    /** 'undefined' from the sandbox's Function, which may not compile text; 'object' from the host's. */
    const REACH = "function reach(make) { try { return make('return typeof process')(); } catch (e) { return e instanceof EvalError ? 'undefined' : 'foreign error'; } }\n";

    function escapeScript(code: string): CompiledScript {
      return makeScript(REACH + code);
    }

    async function returned(code: string, deps?: BridgeDependencies): Promise<unknown> {
      const result = await new VmSandboxExecutor(deps).execute(escapeScript(code), makeContext(), makeOptions());
      return result.ok ? result.value.returnValue : `error: ${result.error.message}`;
    }

    it.each(Object.getOwnPropertyNames(Object.prototype))('the global has no %s of the host', async (name) => {
      expect(await returned(`var v = globalThis[${JSON.stringify(name)}]; return reach(v.constructor.constructor);`)).toBe('undefined');
      expect(await returned(`return reach(${name}.constructor.constructor);`)).toBe('undefined');
    });

    const ALL_BRIDGES: BridgeDependencies = {
      httpFetch: async () => ({ status: 200, statusText: '', headers: {}, body: '' }),
      dbQuery: async () => [],
      routeMessage: async () => ({ success: true }),
      getResource: async () => null,
      collections: { store: vi.fn(), find: vi.fn(), update: vi.fn(), delete: vi.fn() },
    };

    it.each([['no bridges', undefined], ['every bridge', ALL_BRIDGES]])('everything reachable from the global belongs to the sandbox (%s)', async (_name, deps) => {
      const found = await returned(`
        var queue = [[globalThis, 'globalThis']]; var known = new Set(); var foreign = []; var i = 0;
        function root(o) { for (;;) { var p = Object.getPrototypeOf(o); if (p === null) { return o; } o = p; } }
        while (i < queue.length) {
          var o = queue[i][0]; var path = queue[i][1]; i += 1;
          if (known.has(o)) { continue; }
          known.add(o);
          var top = root(o);
          if (top !== Object.prototype && top !== o) { foreign.push(path); }
          var next = [[Object.getPrototypeOf(o), path + '.__proto__']];
          Reflect.ownKeys(o).forEach(function (k) {
            var d = Object.getOwnPropertyDescriptor(o, k);
            [d.value, d.get, d.set].forEach(function (v) { next.push([v, path + '.' + String(k)]); });
          });
          next.forEach(function (n) { if ((typeof n[0] === 'object' && n[0] !== null) || typeof n[0] === 'function') { queue.push(n); } });
        }
        return [known.size > 500, foreign.join(' ')].join('|');`, deps);

      expect(found).toBe('true|');
    });

    it.each([
      "import('node:fs');",
      "import /* x */ ('node:fs');",
      "import\n('node:fs');",
      "import.source('node:fs');",
      "`${import('node:fs')}`;",
      "if (false) { import('node:fs'); }",
      "\\u0069mport('node:fs');",
      "<!-- x\nimport('node:fs');",
    ])('a script cannot run %s', async (code) => {
      for (const deps of [undefined, ALL_BRIDGES]) {
        const result = await new VmSandboxExecutor(deps).execute(makeScript(code), makeContext(), makeOptions());
        expect(result.ok ? 'ran' : result.error.message).toBe('Keyword must not contain escaped characters');
      }
    });

    it.each(["\\import('node:fs');", "\\\\import('node:fs');", "\\u{69}mport('node:fs');"])('a script cannot run %s either', async (code) => {
      const result = await executor.execute(makeScript(code), makeContext(), makeOptions());
      expect(result.ok ? 'ran' : result.error.message).toMatch(/Invalid Unicode escape|Invalid or unexpected token|Keyword must not/);
    });

    it.each([
      ['a string', "return 'import (x)';", 'import (x)'],
      ['a string with a path', "return 'C:\\\\import\\\\f';", 'C:\\import\\f'],
      ['a string with a needless escape', "return '\\import';", 'import'],
      ['a template', 'return `import (${1 + 1})`;', 'import (2)'],
      ['a regular expression', "return /^import$/.test('import');", true],
      ['a group name', "return /(?<import>x)/.exec('x').groups.import;", 'x'],
      ['a property and a method', 'var o = { import: 1, reimport() { return this.import + 1; } }; return o.reimport();', 2],
      ['raw text', 'return String.raw`C:\\import\\x${1}import` + String.raw({ raw: [\'a\', \'b\'] }, 1);', 'C:\\import\\x1importa1b'],
      ['a control escape', "return /^\\cimport$/.test('\\tmport');", true],
      ['a longer name', 'function importPatients() { return 3; } return importPatients();', 3],
      ['a private name', 'class Q { #import = 4; get() { return this.#import; } } return new Q().get();', 4],
      ['JSON', `return JSON.parse('{"import":5}').import;`, 5],
    ])('the word import in %s means what it says', async (_where, code, value) => {
      expect(await returned(code)).toBe(value);
    });

    it.each([
      "eval('1')",
      "(0, eval)('1')",
      "new Function('return 1')",
      "(async function () {}).constructor('return 1')",
      "(function* () {}).constructor('return 1')",
      "(async function* () {}).constructor('return 1')",
    ])('a script cannot compile text with %s', async (code) => {
      expect(await returned(`try { ${code}; return 'compiled'; } catch (e) { return e instanceof EvalError; }`)).toBe(true);
    });

    it('an error has no stack, and its formatter is never called', async () => {
      const code = `
        var formatted = 0;
        Error.prepareStackTrace = function () { formatted += 1; return 'x'; };
        class Own extends Error {}
        var errors = [new Error('a'), new Own('b')];
        try { parseHL7(123); } catch (e) { errors.push(e); }
        try { null.x; } catch (e) { errors.push(e); }
        var o = {}; Error.captureStackTrace(o); errors.push(o);
        return errors.map(function (e) { return String(e.stack); }).join(',') + ' ' + formatted + ' ' + errors[0].message;`;
      expect(await returned(code)).toBe('undefined,undefined,undefined,undefined,undefined 0 a');
    });

    it('then gives a plain promise, whatever the promise says its constructor is', async () => {
      const code = `
        class Own extends Promise {}
        var p = Own.resolve(1);
        var chained = p.then(function (v) { return v + 1; });
        var caught = Own.reject(new Error('no')).catch(function (e) { return e.message; });
        var last = Own.resolve(1).finally(function () {});
        return [await chained, await caught, await last, chained.constructor === Promise, p instanceof Own, Promise.prototype.then.name, Promise.prototype.then.length].join(',');`;
      expect(await returned(code, ALL_BRIDGES)).toBe('2,no,1,true,true,then,2');
    });

    it('then refuses a promise that cannot be given a plain constructor', async () => {
      expect(await returned("var p = Promise.resolve(1); Object.defineProperty(p, 'constructor', { value: 1 }); try { p.then(function () {}); } catch (e) { return e instanceof TypeError; }")).toBe(true);
    });

    it('does not expose host process/require/module/globalThis', async () => {
      const script = makeScript(
        'return [typeof process, typeof require, typeof module, typeof global].join(",");',
      );
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('undefined,undefined,undefined,undefined');
    });

    it('logger.info.constructor cannot reach host process (the reported RCE)', async () => {
      const script = escapeScript("return reach(logger.info.constructor);");
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Would be 'object' if it resolved to the host realm's Function.
      expect(result.value.returnValue).toBe('undefined');
    });

    it('({}).constructor.constructor cannot reach host process', async () => {
      const script = escapeScript("return reach(({}).constructor.constructor);");
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('undefined');
    });

    it('the HL7 message proxy method .constructor cannot reach host process', async () => {
      const hl7 = 'MSH|^~\\&|S|F|R|F|20260329||ADT^A01|C1|P|2.5\rPID|||99999^^^MRN';
      const context = makeContext({ msg: createHl7Proxy(Hl7Message.parse(hl7)) });
      const script = escapeScript("return reach(msg.get.constructor);");
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('undefined');
      const legit = await executor.execute(makeScript('return msg.get("PID.3");'), context, makeOptions());
      expect(legit.ok).toBe(true);
      if (!legit.ok) return;
      expect(legit.value.returnValue).toBe('99999');
    });

    it('an X12 msg reads and edits through host calls, comes back as the host message, and leaks nothing', async () => {
      const isa = 'ISA*00*          *00*          *ZZ*SUBMITTER      *ZZ*RECEIVER       *261110*1200*^*00501*000000020*0*P*:~';
      const proxy = createX12Proxy(X12Message.parse(`${isa}NM1*IL*1*DOE*JANE****MI*MEMBER123~`));
      const script = escapeScript([
        "msg.set('NM1.9', msg.get('NM1.9') + 'X');",
        "channelMap.copy = msg;",
        "var leak = reach(msg.get.constructor);",
        "var thrown; try { msg.set('CLM.1', 'x'); } catch (e) { thrown = [e instanceof Error, reach(e.constructor.constructor)].join(','); }",
        "return [msg.getSegmentCount('NM1'), leak, thrown].join('|');",
      ].join('\n'));
      const result = await executor.execute(script, makeContext({ msg: proxy }), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('1|undefined|true,undefined');
      expect(result.value.msg).toBe(proxy);
      expect(proxy.get('NM1.9')).toBe('MEMBER123X');
      // A message put in a map is stored as its text.
      expect(result.value.mapUpdates.channelMap['copy']).toBe(`${isa}NM1*IL*1*DOE*JANE****MI*MEMBER123X~`);
    });

    it('a forged X12 handle reaches no host message', async () => {
      const script = makeScript("msg = { __x12Proxy: true, __handle: 999 }; return 'set';");
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.msg).toBeUndefined();
    });

    it('a thrown host-side IO error is re-thrown as a sandbox-realm Error (no host constructor leak)', async () => {
      const ioExecutor = new VmSandboxExecutor({
        httpFetch: () => Promise.reject(new Error('nope')),
      });
      const script = escapeScript(
        "try { await httpFetch('https://example.com'); return 'no-throw'; }" +
        " catch (e) { return reach(e.constructor.constructor); }",
      );
      const result = await ioExecutor.execute(script, makeContext(), makeOptions());
      ioExecutor.dispose();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('undefined');
    });

    // Every synchronous bridge that can fail on the host. Each script makes the
    // bridge throw, then tries to climb from the caught error to the host Function.
    const SYNC_THROWERS: ReadonlyArray<readonly [string, string]> = [
      ['parseHL7 with a non-string', 'parseHL7(123)'],
      ['parseHL7 with invalid HL7', "parseHL7('not hl7')"],
      ['createACK with invalid HL7', "createACK('not hl7', 'AA')"],
      ['an HL7 get with no path', 'msg.get()'],
      ['an HL7 set with an empty path', "msg.set('', 'x')"],
    ];

    it.each(SYNC_THROWERS)('a host error thrown by %s cannot leak the host Function', async (_name, body) => {
      const hl7 = Hl7Message.parse('MSH|^~\\&|A|B|C|D|20260101||ADT^A01|1|P|2.5\rPID|1||99999');
      const context = makeContext({ msg: createHl7Proxy(hl7) });
      const script = escapeScript(
        `try { ${body}; return 'no-throw'; }` +
        " catch (e) { return [e instanceof Error, reach(e.constructor.constructor)].join(','); }",
      );
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('true,undefined');
    });

    it('reports the host error message to the script', async () => {
      const script = makeScript("try { parseHL7(123); return 'no-throw'; } catch (e) { return e.message; }");
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('parseHL7 expects a string or HL7 message proxy');
    });

    it('an uncaught bridge error still fails the script with its message', async () => {
      const result = await executor.execute(makeScript('parseHL7(123);'), makeContext(), makeOptions());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('parseHL7 expects a string');
    });
  });
});

describe('HL7 message in scripts', () => {
  const HL7 = 'MSH|^~\\&|S|F|R|F|20260329||ADT^A01|C1|P|2.5\rOBX|1|TX|NOTE||Smith \\T\\ Sons';
  let hl7Executor: VmSandboxExecutor;

  beforeEach(() => { hl7Executor = new VmSandboxExecutor(); });
  afterEach(() => { hl7Executor.dispose(); });

  async function run(body: string): Promise<unknown> {
    const context = makeContext({ msg: createHl7Proxy(Hl7Message.parse(HL7)) });
    const result = await hl7Executor.execute(makeScript(body), context, makeOptions());
    if (!result.ok) throw new Error(result.error.message);
    return result.value.returnValue;
  }

  it('messageType and messageControlId follow edits made by the script', async () => {
    expect(await run(
      "msg.set('MSH.9', 'ORU'); msg.set('MSH.10', 'NEW1'); return msg.messageType + '|' + msg.messageControlId;",
    )).toBe('ORU|NEW1');
  });

  it('getText decodes escape sequences and get does not', async () => {
    expect(await run("return msg.getText('OBX.5') + ' / ' + msg.get('OBX.5');")).toBe('Smith & Sons / Smith \\T\\ Sons');
  });

  it('setText stores text with delimiters as one value', async () => {
    expect(await run(
      "msg.setText('OBX.5', 'a|b^c'); return msg.getText('OBX.5') + ' ' + msg.toString().split('\\r')[1].split('|').length;",
    )).toBe('a|b^c 6');
  });
});
