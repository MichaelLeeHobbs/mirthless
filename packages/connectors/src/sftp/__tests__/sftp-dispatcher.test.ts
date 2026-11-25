import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConnectorMessage } from '../../base.js';
import { SftpDispatcher, type SftpDispatcherConfig } from '../sftp-dispatcher.js';
import type { SftpClient, SftpClientFactory } from '../sftp-client.js';
import { RemoteState, makeMockSftpClient, type MockFailures } from '../../__fixtures__/mock-sftp-client.js';

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
    tempFileEnabled: true,
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

describe('onDeploy', () => {
  it('refuses a file name template with a placeholder it cannot fill', async () => {
    const d = new SftpDispatcher(makeConfig({ fileNameTemplate: '${originalFilename}.hl7' }), factoryFor(new RemoteState()));
    const result = await d.onDeploy();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.message).toContain('${originalFilename}');
  });

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
    expect(state.mkdirs).toContain('/outbound');
    expect(state.endCount).toBe(1);
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
    expect(state.endCount).toBe(1);
  });
});

describe('send timeout', () => {
  it('fails with a timeout when the remote write hangs', async () => {
    vi.useFakeTimers();
    try {
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

describe('a send that cannot tell how its last step ended', () => {
  it('says the file may be in place when the rename is never answered, and how long it waits', async () => {
    vi.useFakeTimers();
    const state = new RemoteState();
    const d = new SftpDispatcher(makeConfig(), () => ({
      ...makeMockSftpClient(state),
      replace: () => new Promise<boolean>(() => { /* never answered */ }),
      delete: () => new Promise<void>(() => { /* never answered */ }),
    }));
    await d.onStart();
    const sent = d.send(makeMessage(), makeSignal());
    await vi.advanceTimersByTimeAsync(34_000);
    const result = await sent;
    expect(result.error?.message).toMatch(
      /^SFTP send timed out after 30000ms; \/outbound\/42\.dat may hold this message; the temporary file \/outbound\/\.galvanigraph-.*\.tmp may be left on the server$/,
    );
  });

  it('says the file may be in place when the connection is lost during the rename', async () => {
    const d = new SftpDispatcher(makeConfig(), () => ({
      ...makeMockSftpClient(new RemoteState()),
      replace: () => Promise.reject(Object.assign(new Error('No response from server'), { code: 'ERR_GENERIC_CLIENT' })),
    }));
    await d.onStart();
    const result = await d.send(makeMessage(), makeSignal());
    expect(result.error?.message).toBe('No response from server; /outbound/42.dat may hold this message');
  });

  it('does not delete the existing file when a refused rename had replaced it after all', async () => {
    const state = new RemoteState();
    const client = makeMockSftpClient(state);
    const d = new SftpDispatcher(makeConfig(), () => ({
      ...client,
      replace: async () => false,
      rename: async (from, to) => { await client.rename(from, to); throw Object.assign(new Error('Failure'), { code: 4 }); },
    }));
    await d.onStart();
    expect((await d.send(makeMessage({ content: 'NEW' }), makeSignal())).ok).toBe(false);
    expect(state.files.get('42.dat')?.content).toBe('NEW');
  });

  it('keeps the temporary file when it is given up while the existing file is being deleted', async () => {
    vi.useFakeTimers();
    const state = new RemoteState();
    state.addFile('42.dat', 'OLD', 0);
    const d = new SftpDispatcher(makeConfig(), () => ({
      ...makeMockSftpClient(state),
      replace: async () => false,
      rename: () => Promise.reject(Object.assign(new Error('Failure'), { code: 4 })),
      delete: () => new Promise<void>(() => { /* never answered */ }),
    }));
    await d.onStart();
    const sent = d.send(makeMessage({ content: 'NEW' }), makeSignal());
    await vi.advanceTimersByTimeAsync(34_000);
    const result = await sent;
    expect(result.error?.message).toContain('/outbound/42.dat may have been removed to be replaced');
    expect([...state.files.values()].map((f) => f.content)).toEqual(['OLD', 'NEW']);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
