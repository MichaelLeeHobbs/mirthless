// The engine injects the ScriptRunner, so these tests wire a real sandbox-backed one as it does.

import { describe, it, expect, afterEach } from 'vitest';
import {
  JavaScriptReceiver,
  JavaScriptDispatcher,
  clearChannelRegistry,
  type ConnectorMessage,
} from '../../index.js';
import type { Result } from '@galvanigraph/core-util';
import { VmSandboxExecutor, compileScript, DEFAULT_EXECUTION_OPTIONS, createSandboxContext } from '@galvanigraph/engine';
import { deployChannel, teardownAll, CaptureDestination, type DeployedChannel } from './support/e2e-harness.js';
import { mllpSource, sendMllp } from './support/tcp-helpers.js';
import { freePort } from '../../__fixtures__/free-port.js';

let deployed: DeployedChannel[] = [];
const sandbox = new VmSandboxExecutor();

afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  clearChannelRegistry();
});

async function compile(source: string): Promise<{ code: string }> {
  const r = await compileScript(source, { sourcefile: 'js-connector.js' });
  if (!r.ok) throw new Error(`compile failed: ${r.error.message}`);
  return r.value;
}

describe('JavaScript source connector (a polling script generates messages)', () => {
  it('runs the source script and delivers its generated message to the destination', async () => {
    const compiled = await compile("return 'HEARTBEAT|' + msg;");
    const source = new JavaScriptReceiver({ script: 'ignored', pollingIntervalMs: 100 });

    // Exactly one message, so the polling source is deterministic.
    let calls = 0;
    source.setScriptRunner(async (): Promise<Result<unknown>> => {
      calls += 1;
      if (calls > 1) return { ok: true, value: null, error: null } as Result<unknown>;
      const exec = await sandbox.execute(compiled, createSandboxContext('OK', 'OK'), DEFAULT_EXECUTION_OPTIONS);
      if (!exec.ok) return exec;
      return { ok: true, value: exec.value.returnValue, error: null } as Result<unknown>;
    });

    const sink = new CaptureDestination();
    const channel = await deployChannel({
      channelId: '00000000-0000-0000-0000-connjs00src1',
      dataType: 'RAW',
      source,
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });
    deployed.push(channel);

    for (let i = 0; i < 200 && sink.received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(sink.received.length).toBeGreaterThanOrEqual(1);
    expect(sink.lastContent()).toBe('HEARTBEAT|OK');
  });

  it.each([
    ['an array of text, objects and parsed messages', "const m = parseHL7('MSH|^~\\\\&|A|B'); return ['text', { id: 7 }, 42, m, null];", ['text', '{"id":7}', '42', 'MSH|^~\\&|A|B']],
    ['a parsed message', "return parseHL7('MSH|^~\\\\&|A|B');", ['MSH|^~\\&|A|B']],
    ['an object', 'return { id: 7 };', ['{"id":7}']],
  ])('sends every item a real sandbox hands back: %s (#415)', async (_name, script, expected) => {
    const compiled = await compile(script);
    const source = new JavaScriptReceiver({ script: 'ignored', pollingIntervalMs: 100 });
    let calls = 0;
    source.setScriptRunner(async (): Promise<Result<unknown>> => {
      calls += 1;
      if (calls > 1) return { ok: true, value: null, error: null } as Result<unknown>;
      const exec = await sandbox.execute(compiled, createSandboxContext('', ''), DEFAULT_EXECUTION_OPTIONS);
      return exec.ok ? { ok: true, value: exec.value.returnValue, error: null } as Result<unknown> : exec;
    });
    const contents: string[] = [];
    source.setDispatcher(async (raw) => {
      contents.push(raw.content);
      return { ok: true, value: { messageId: contents.length }, error: null };
    });

    await source.onStart();
    try {
      await expect.poll(() => contents, { timeout: 10_000 }).toEqual(expected);
    } finally {
      await source.onStop();
    }
  });
});

describe('JavaScript destination connector (a script transforms the message)', () => {
  it('runs the destination script against the message and returns its result', async () => {
    const compiled = await compile('return String(msg).toUpperCase();');
    const dispatcher = new JavaScriptDispatcher({ script: 'ignored' });

    const seen: { input: string; output: unknown }[] = [];
    dispatcher.setScriptRunner(async (_script: string, content: string, _cm: ConnectorMessage): Promise<Result<unknown>> => {
      const exec = await sandbox.execute(compiled, createSandboxContext(content, content), DEFAULT_EXECUTION_OPTIONS);
      const output = exec.ok ? exec.value.returnValue : null;
      seen.push({ input: content, output });
      if (!exec.ok) return exec;
      return { ok: true, value: output, error: null } as Result<unknown>;
    });

    const port = await freePort();
    const channel = await deployChannel({
      channelId: '00000000-0000-0000-0000-connjs0dst01',
      dataType: 'RAW',
      source: mllpSource(port, { maxConnections: 10 }),
      destinations: [{ metaDataId: 1, name: 'JS Dest', connector: dispatcher }],
    });
    deployed.push(channel);

    await sendMllp(port, 'MSH|^~\\&|abc');
    for (let i = 0; i < 200 && seen.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]?.input).toBe('MSH|^~\\&|abc');
    expect(seen[0]?.output).toBe('MSH|^~\\&|ABC');
    expect(channel.store.messageCount()).toBe(1);
  });
});
