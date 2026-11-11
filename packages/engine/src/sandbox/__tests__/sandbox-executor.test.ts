// ===========================================
// Sandbox Executor Tests
// ===========================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  VmSandboxExecutor,
  DEFAULT_EXECUTION_OPTIONS,
  type ExecutionOptions,
  type CompiledScript,
} from '../sandbox-executor.js';
import { createSandboxContext, type SandboxContext } from '../sandbox-context.js';
import { createHl7Proxy } from '../../pipeline/data-type-handler.js';
import { Hl7Message } from '@galvaniflow/core-util';

// ----- Helpers -----

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

// ----- Tests -----

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

      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.logs).toHaveLength(1);
      expect(result.value.logs[0]!.level).toBe('INFO');
      expect(result.value.logs[0]!.message).toBe('hello from sandbox');
    });

    it('captures multiple log levels', async () => {
      const script = makeScript(`
        logger.info("info msg");
        logger.warn("warn msg");
        logger.error("error msg");
        logger.debug("debug msg");
        return true;
      `);

      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.logs).toHaveLength(4);
      expect(result.value.logs[0]!.level).toBe('INFO');
      expect(result.value.logs[1]!.level).toBe('WARN');
      expect(result.value.logs[2]!.level).toBe('ERROR');
      expect(result.value.logs[3]!.level).toBe('DEBUG');
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

      // Fresh context should not see previous execution's map
      const result2 = await executor.execute(script2, makeContext(), makeOptions());
      expect(result2.ok).toBe(true);
      if (!result2.ok) return;
      expect(result2.value.returnValue).toBeUndefined();
    });
  });

  // ----- Sandbox escape hardening (CRITICAL: no host realm reachable) -----

  describe('per-script time limit', () => {
    it('stops a script waiting on slow IO at its own timeout, even when the caller passes a longer-lived signal', async () => {
      const slow = new VmSandboxExecutor({
        httpFetch: () => new Promise((resolve) => { setTimeout(() => { resolve({ status: 200, headers: {}, body: 'late' }); }, 400); }),
      });
      const script = makeScript("await httpFetch('https://example.com'); return 'finished';");
      const started = Date.now();

      const result = await slow.execute(script, makeContext(), { timeout: 50, signal: new AbortController().signal });

      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error.message).toBe('Script execution timed out');
      expect(Date.now() - started).toBeLessThan(300);
    });

    it('still stops when the caller cancels first', async () => {
      const slow = new VmSandboxExecutor({
        httpFetch: () => new Promise((resolve) => { setTimeout(() => { resolve({ status: 200, headers: {}, body: 'late' }); }, 400); }),
      });
      const script = makeScript("await httpFetch('https://example.com'); return 'finished';");

      const result = await slow.execute(script, makeContext(), { timeout: 5_000, signal: AbortSignal.timeout(30) });

      expect(result.ok).toBe(false);
    });
  });

  describe('escape prevention', () => {
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
      const script = makeScript("return logger.info.constructor('return typeof process')();");
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Would be 'object' if it resolved to the host realm's Function.
      expect(result.value.returnValue).toBe('undefined');
    });

    it('({}).constructor.constructor cannot reach host process', async () => {
      const script = makeScript("return ({}).constructor.constructor('return typeof process')();");
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('undefined');
    });

    it('the HL7 message proxy method .constructor cannot reach host process', async () => {
      const hl7 = 'MSH|^~\\&|S|F|R|F|20260329||ADT^A01|C1|P|2.5\rPID|||99999^^^MRN';
      const context = makeContext({ msg: createHl7Proxy(Hl7Message.parse(hl7)) });
      const script = makeScript("return msg.get.constructor('return typeof process')();");
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('undefined');
      // And the legitimate proxy still works.
      const legit = await executor.execute(makeScript('return msg.get("PID.3");'), context, makeOptions());
      expect(legit.ok).toBe(true);
      if (!legit.ok) return;
      expect(legit.value.returnValue).toBe('99999');
    });

    it('a thrown host-side IO error is re-thrown as a sandbox-realm Error (no host constructor leak)', async () => {
      const ioExecutor = new VmSandboxExecutor({
        httpFetch: () => Promise.reject(new Error('nope')),
      });
      const script = makeScript(
        "try { await httpFetch('https://example.com'); return 'no-throw'; }" +
        " catch (e) { return e.constructor.constructor('return typeof process')(); }",
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
      const script = makeScript(
        `try { ${body}; return 'no-throw'; }` +
        " catch (e) { return [e instanceof Error, e.constructor.constructor('return typeof process')()].join(','); }",
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

    it('a stack trace hook cannot reach host functions through call sites', async () => {
      const script = makeScript(
        "Error.prepareStackTrace = function (_e, sites) { return sites; };" +
        "var found = 'none';" +
        "try { parseHL7(123); } catch (e) { /* ignore */ }" +
        "var sites = new Error('x').stack;" +
        "for (var i = 0; i < sites.length; i++) {" +
        "  var fn = sites[i].getFunction && sites[i].getFunction();" +
        "  if (fn) { var r = fn.constructor('return typeof process')(); if (r !== 'undefined') { found = r; } }" +
        "}" +
        "return found;",
      );
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('none');
    });
  });
});
