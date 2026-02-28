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
});
