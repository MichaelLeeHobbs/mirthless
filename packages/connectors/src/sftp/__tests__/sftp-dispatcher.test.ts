// ===========================================
// SFTP Dispatcher Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConnectorMessage } from '../../base.js';
import { SftpDispatcher, type SftpDispatcherConfig } from '../sftp-dispatcher.js';
import type { SftpClient, SftpClientFactory } from '../sftp-client.js';
import { RemoteState, makeMockSftpClient, type MockFailures } from '../../__fixtures__/mock-sftp-client.js';

// ----- Helpers -----

function makeConfig(overrides?: Partial<SftpDispatcherConfig>): SftpDispatcherConfig {
  return {
    host: 'sftp.hospital.org',
    port: 22,
    username: 'labuser',
    password: 'secret',
    strictHostKey: false,
    remoteDirectory: '/outbound',
    fileNameTemplate: '${messageId}.dat',
    appendMode: false,
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<ConnectorMessage>): ConnectorMessage {
  return {
    channelId: 'ch-1',
    messageId: 42,
    metaDataId: 1,
    content: 'MSH|^~\\&|LAB',
    dataType: 'HL7V2',
    ...overrides,
  };
}

function makeSignal(aborted = false): AbortSignal {
  return aborted ? AbortSignal.abort() : new AbortController().signal;
}

function factoryFor(state: RemoteState, failures?: MockFailures): SftpClientFactory {
  return () => makeMockSftpClient(state, failures ?? {});
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ----- onDeploy -----

describe('onDeploy', () => {
  it('validates host is required', async () => {
    const d = new SftpDispatcher(makeConfig({ host: '' }), factoryFor(new RemoteState()));
    expect((await d.onDeploy()).ok).toBe(false);
  });

  it('validates port range', async () => {
    const d = new SftpDispatcher(makeConfig({ port: 70_000 }), factoryFor(new RemoteState()));
    expect((await d.onDeploy()).ok).toBe(false);
  });

  it('validates username is required', async () => {
    const d = new SftpDispatcher(makeConfig({ username: '' }), factoryFor(new RemoteState()));
    expect((await d.onDeploy()).ok).toBe(false);
  });

  it('fails when neither password nor privateKey is provided', async () => {
    const d = new SftpDispatcher(
      makeConfig({ password: undefined, privateKey: undefined }),
      factoryFor(new RemoteState()),
    );
    expect((await d.onDeploy()).ok).toBe(false);
  });

  it('validates remoteDirectory is required', async () => {
    const d = new SftpDispatcher(makeConfig({ remoteDirectory: '' }), factoryFor(new RemoteState()));
    expect((await d.onDeploy()).ok).toBe(false);
  });

  it('validates fileNameTemplate is required', async () => {
    const d = new SftpDispatcher(makeConfig({ fileNameTemplate: '' }), factoryFor(new RemoteState()));
    expect((await d.onDeploy()).ok).toBe(false);
  });

  it('deploys with valid config (privateKey auth)', async () => {
    const d = new SftpDispatcher(
      makeConfig({ password: undefined, privateKey: '-----BEGIN KEY-----' }),
      factoryFor(new RemoteState()),
    );
    expect((await d.onDeploy()).ok).toBe(true);
  });
});

// ----- send: happy path -----

describe('send', () => {
  it('errors when not started', async () => {
    const d = new SftpDispatcher(makeConfig(), factoryFor(new RemoteState()));
    const result = await d.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(false);
  });

  it('errors when the signal is already aborted', async () => {
    const d = new SftpDispatcher(makeConfig(), factoryFor(new RemoteState()));
    await d.onStart();
    const result = await d.send(makeMessage(), makeSignal(true));
    expect(result.ok).toBe(false);
  });

  it('writes (overwrites) the file with the templated name', async () => {
    const state = new RemoteState();
    const d = new SftpDispatcher(makeConfig(), factoryFor(state));
    await d.onStart();

    const result = await d.send(makeMessage({ messageId: 99, content: 'BODY' }), makeSignal());

    expect(result.ok).toBe(true);
    expect(result.value!.content).toBe('/outbound/99.dat');
    expect(state.files.get('99.dat')?.content).toBe('BODY');
    expect(state.mkdirs).toContain('/outbound'); // ensured the directory
    expect(state.endCount).toBe(1); // connection torn down
  });

  it('substitutes ${timestamp} in the filename template', async () => {
    const state = new RemoteState();
    const d = new SftpDispatcher(makeConfig({ fileNameTemplate: 'msg-${timestamp}.hl7' }), factoryFor(state));
    await d.onStart();

    const result = await d.send(makeMessage(), makeSignal());

    expect(result.ok).toBe(true);
    expect(result.value!.content).toMatch(/^\/outbound\/msg-\d+\.hl7$/);
  });

  it('appends when appendMode is true', async () => {
    const state = new RemoteState();
    state.addFile('42.dat', 'EXISTING\n', Date.now());
    const d = new SftpDispatcher(makeConfig({ appendMode: true }), factoryFor(state));
    await d.onStart();

    const result = await d.send(makeMessage({ content: 'NEW' }), makeSignal());

    expect(result.ok).toBe(true);
    expect(state.files.get('42.dat')?.content).toBe('EXISTING\nNEW');
  });

  it('overwrites (does not append) when appendMode is false', async () => {
    const state = new RemoteState();
    state.addFile('42.dat', 'OLD', Date.now());
    const d = new SftpDispatcher(makeConfig({ appendMode: false }), factoryFor(state));
    await d.onStart();

    await d.send(makeMessage({ content: 'REPLACED' }), makeSignal());

    expect(state.files.get('42.dat')?.content).toBe('REPLACED');
  });

  it('returns ERROR result when the remote write fails', async () => {
    const state = new RemoteState();
    const d = new SftpDispatcher(makeConfig(), factoryFor(state, { put: true }));
    await d.onStart();

    const result = await d.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(false);
    expect(state.endCount).toBe(1); // still torn down in finally
  });
});

// ----- send: timeout -----

describe('send timeout', () => {
  it('fails with a timeout when the remote write hangs', async () => {
    vi.useFakeTimers();
    try {
      // A client whose put never resolves simulates a hung server.
      const hangingClient: SftpClient = {
        ...makeMockSftpClient(new RemoteState()),
        put: () => new Promise<void>(() => { /* never resolves */ }),
      };
      const factory: SftpClientFactory = () => hangingClient;

      const d = new SftpDispatcher(makeConfig(), factory);
      await d.onStart();

      const sendPromise = d.send(makeMessage(), makeSignal());
      await vi.advanceTimersByTimeAsync(30_000); // exceed SEND_TIMEOUT_MS
      const result = await sendPromise;

      expect(result.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});
