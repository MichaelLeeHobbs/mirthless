// ===========================================
// JavaScript Dispatcher Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectorMessage } from '../../base.js';
import { JavaScriptDispatcher, type JavaScriptDispatcherConfig, type DestScriptRunner } from '../javascript-dispatcher.js';

// ----- Helpers -----

function makeConfig(overrides?: Partial<JavaScriptDispatcherConfig>): JavaScriptDispatcherConfig {
  return {
    script: 'return msg;',
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<ConnectorMessage>): ConnectorMessage {
  return {
    channelId: 'ch-1',
    messageId: 1,
    metaDataId: 1,
    content: 'test content',
    dataType: 'RAW',
    ...overrides,
  };
}

function makeRunner(value: unknown): DestScriptRunner {
  return async () => ({ ok: true as const, value, error: null });
}

function makeFailingRunner(message: string): DestScriptRunner {
  return async () => ({
    ok: false as const,
    value: null,
    error: { name: 'Error', message, code: 'SCRIPT_ERROR' },
  });
}

function makeSignal(aborted = false): AbortSignal {
  if (aborted) return AbortSignal.abort();
  return new AbortController().signal;
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
});

// ----- onDeploy -----

describe('JavaScriptDispatcher.onDeploy', () => {
  it('succeeds with valid config', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(true);
  });

  it('fails when script is empty', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig({ script: '' }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });
});

// ----- Lifecycle -----

describe('JavaScriptDispatcher lifecycle', () => {
  it('starts successfully', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    const result = await dispatcher.onStart();
    expect(result.ok).toBe(true);
  });

  it('stops successfully', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    await dispatcher.onStart();
    const result = await dispatcher.onStop();
    expect(result.ok).toBe(true);
  });

  it('halts successfully', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    await dispatcher.onStart();
    const result = await dispatcher.onHalt();
    expect(result.ok).toBe(true);
  });

  it('undeploys and clears references', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    const result = await dispatcher.onUndeploy();
    expect(result.ok).toBe(true);
  });
});

// ----- send -----

describe('JavaScriptDispatcher.send', () => {
  it('returns SENT with script return value as content', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    dispatcher.setScriptRunner(makeRunner('processed'));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('SENT');
      expect(result.value.content).toBe('processed');
    }
  });

  it('returns SENT with empty content when script returns null', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    dispatcher.setScriptRunner(makeRunner(null));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('SENT');
      expect(result.value.content).toBe('');
    }
  });

  it('returns SENT with empty content when script returns undefined', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    dispatcher.setScriptRunner(makeRunner(undefined));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('SENT');
      expect(result.value.content).toBe('');
    }
  });

  it('stringifies non-string return values', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    dispatcher.setScriptRunner(makeRunner(42));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toBe('42');
    }
  });

  it('returns ERROR when script runner fails', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    dispatcher.setScriptRunner(makeFailingRunner('bad script'));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ERROR');
      expect(result.value.errorMessage).toBe('bad script');
    }
  });

  it('fails when not started', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    dispatcher.setScriptRunner(makeRunner('value'));

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(false);
  });

  it('fails when signal is already aborted', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    dispatcher.setScriptRunner(makeRunner('value'));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal(true));
    expect(result.ok).toBe(false);
  });

  it('fails when script runner not set', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(false);
  });

  it('passes message content and connector message to runner', async () => {
    const runnerSpy = vi.fn(async () => ({
      ok: true as const,
      value: 'done',
      error: null,
    }));

    const dispatcher = new JavaScriptDispatcher(makeConfig({ script: 'my-script' }));
    dispatcher.setScriptRunner(runnerSpy);
    await dispatcher.onStart();

    const msg = makeMessage({ content: 'my content', channelId: 'ch-99' });
    await dispatcher.send(msg, makeSignal());

    expect(runnerSpy).toHaveBeenCalledWith('my-script', 'my content', msg);
  });

  it('cannot send after stop', async () => {
    const dispatcher = new JavaScriptDispatcher(makeConfig());
    dispatcher.setScriptRunner(makeRunner('value'));
    await dispatcher.onStart();
    await dispatcher.onStop();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(false);
  });
});
