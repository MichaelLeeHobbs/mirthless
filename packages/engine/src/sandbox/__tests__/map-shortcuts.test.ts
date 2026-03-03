// ===========================================
// Map Shortcuts Tests
// ===========================================
// Tests for $, $r, $g, $gc shorthand functions and globalMap/configMap injection.

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
  const base = createSandboxContext('test msg', 'raw data');
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

describe('Map Shortcuts', () => {
  describe('$ (cascading lookup)', () => {
    it('finds value in responseMap first', async () => {
      const context = makeContext({
        responseMap: { key: 'from-response' },
        channelMap: { key: 'from-channel' },
        globalMap: { key: 'from-global' },
      });
      const script = makeScript('return $("key");');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('from-response');
    });

    it('falls back to connectorMap when not in responseMap', async () => {
      const context = makeContext({
        connectorMap: { key: 'from-connector' },
        channelMap: { key: 'from-channel' },
      });
      const script = makeScript('return $("key");');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('from-connector');
    });

    it('falls back to channelMap when not in connectorMap', async () => {
      const context = makeContext({
        channelMap: { key: 'from-channel' },
        globalChannelMap: { key: 'from-gcm' },
      });
      const script = makeScript('return $("key");');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('from-channel');
    });

    it('falls back to globalChannelMap', async () => {
      const context = makeContext({
        globalChannelMap: { key: 'from-gcm' },
        globalMap: { key: 'from-global' },
      });
      const script = makeScript('return $("key");');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('from-gcm');
    });

    it('falls back to globalMap', async () => {
      const context = makeContext({
        globalMap: { key: 'from-global' },
        configMap: { key: 'from-config' },
      });
      const script = makeScript('return $("key");');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('from-global');
    });

    it('falls back to configMap', async () => {
      const context = makeContext({
        configMap: { key: 'from-config' },
      });
      const script = makeScript('return $("key");');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('from-config');
    });

    it('falls back to sourceMap as last resort', async () => {
      const context = makeContext({
        sourceMap: { key: 'from-source' },
      });
      const script = makeScript('return $("key");');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('from-source');
    });

    it('returns undefined when key not found in any map', async () => {
      const script = makeScript('return $("nonexistent");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBeUndefined();
    });
  });

  describe('$r (responseMap accessor)', () => {
    it('reads from responseMap with one argument', async () => {
      const context = makeContext({
        responseMap: { status: 'ok' },
      });
      const script = makeScript('return $r("status");');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('ok');
    });

    it('writes to responseMap with two arguments', async () => {
      const script = makeScript('$r("newKey", "newValue"); return $r("newKey");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('newValue');
    });

    it('returns undefined for missing key', async () => {
      const script = makeScript('return $r("missing");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBeUndefined();
    });
  });

  describe('$g (globalMap accessor)', () => {
    it('reads from globalMap with one argument', async () => {
      const context = makeContext({
        globalMap: { setting: 'enabled' },
      });
      const script = makeScript('return $g("setting");');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('enabled');
    });

    it('writes to globalMap with two arguments', async () => {
      const script = makeScript('$g("counter", 42); return $g("counter");');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe(42);
    });

    it('globalMap writes are captured in mapUpdates', async () => {
      const script = makeScript('$g("key1", "value1"); return true;');
      const result = await executor.execute(script, makeContext(), makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.mapUpdates.globalMap['key1']).toBe('value1');
    });
  });

  describe('$gc (configMap accessor)', () => {
    it('reads from configMap', async () => {
      const context = makeContext({
        configMap: { 'db.host': 'localhost' },
      });
      const script = makeScript('return $gc("db.host");');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('localhost');
    });

    it('returns undefined for missing configMap key', async () => {
      const context = makeContext({ configMap: {} });
      const script = makeScript('return $gc("nonexistent");');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBeUndefined();
    });
  });

  describe('globalMap injection', () => {
    it('exposes globalMap in sandbox', async () => {
      const context = makeContext({
        globalMap: { serverName: 'prod-01' },
      });
      const script = makeScript('return globalMap.serverName;');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('prod-01');
    });

    it('captures globalMap mutations in mapUpdates', async () => {
      const context = makeContext({
        globalMap: { existing: 'value' },
      });
      const script = makeScript('globalMap.newKey = "added"; return true;');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.mapUpdates.globalMap['newKey']).toBe('added');
      expect(result.value.mapUpdates.globalMap['existing']).toBe('value');
    });
  });

  describe('configMap injection', () => {
    it('exposes configMap as read-only in sandbox', async () => {
      const context = makeContext({
        configMap: { 'app.name': 'Mirthless' },
      });
      const script = makeScript('return configMap["app.name"];');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('Mirthless');
    });

    it('prevents writes to frozen configMap', async () => {
      const context = makeContext({
        configMap: { readonly: 'yes' },
      });
      // Strict mode in the IIFE wrapper makes writes to frozen objects throw
      const script = makeScript('try { configMap.newKey = "fail"; } catch(e) { return "blocked"; } return "written";');
      const result = await executor.execute(script, context, makeOptions());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.returnValue).toBe('blocked');
    });
  });
});
