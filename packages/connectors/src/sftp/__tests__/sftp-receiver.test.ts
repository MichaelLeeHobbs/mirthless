// ===========================================
// SFTP Receiver Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawMessage, DispatchResult } from '../../base.js';
import type { Result } from '@mirthless/core-util';
import { SftpReceiver, joinRemote, SFTP_POST_ACTION, type SftpReceiverConfig } from '../sftp-receiver.js';
import type { SftpClientFactory } from '../sftp-client.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';
import { RemoteState, makeMockSftpClient, type MockFailures } from '../../__fixtures__/mock-sftp-client.js';

// ----- Helpers -----

function makeConfig(overrides?: Partial<SftpReceiverConfig>): SftpReceiverConfig {
  return {
    host: 'sftp.hospital.org',
    port: 22,
    username: 'labuser',
    password: 'secret',
    strictHostKey: false,
    remoteDirectory: '/inbound',
    filePattern: '*.hl7',
    pollingIntervalMs: 5_000,
    afterProcessing: SFTP_POST_ACTION.DELETE,
    moveToDirectory: '',
    minFileAgeMs: 1_000,
    ...overrides,
  };
}

function makeDispatcher(
  handler?: (raw: RawMessage) => DispatchResult,
): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async (raw) => ({
    ok: true as const,
    value: handler ? handler(raw) : { messageId: 1 },
    error: null,
  });
}

function factoryFor(state: RemoteState, failures?: MockFailures): SftpClientFactory {
  return () => makeMockSftpClient(state, failures ?? {});
}

// ----- Lifecycle -----

let receiver: SftpReceiver | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  if (receiver) {
    await receiver.onStop();
    await receiver.onUndeploy();
    receiver = null;
  }
});

// ----- joinRemote -----

describe('joinRemote', () => {
  it('joins with a single slash', () => {
    expect(joinRemote('/inbound', 'a.hl7')).toBe('/inbound/a.hl7');
  });

  it('collapses a trailing slash on the directory', () => {
    expect(joinRemote('/inbound/', 'a.hl7')).toBe('/inbound/a.hl7');
  });
});

// ----- onDeploy -----

describe('onDeploy', () => {
  it('validates host is required', async () => {
    receiver = new SftpReceiver(makeConfig({ host: '' }), factoryFor(new RemoteState()));
    expect((await receiver.onDeploy()).ok).toBe(false);
  });

  it('validates port range', async () => {
    receiver = new SftpReceiver(makeConfig({ port: 0 }), factoryFor(new RemoteState()));
    expect((await receiver.onDeploy()).ok).toBe(false);
  });

  it('validates username is required', async () => {
    receiver = new SftpReceiver(makeConfig({ username: '' }), factoryFor(new RemoteState()));
    expect((await receiver.onDeploy()).ok).toBe(false);
  });

  it('fails when neither password nor privateKey is provided', async () => {
    receiver = new SftpReceiver(
      makeConfig({ password: undefined, privateKey: undefined }),
      factoryFor(new RemoteState()),
    );
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('validates remoteDirectory is required', async () => {
    receiver = new SftpReceiver(makeConfig({ remoteDirectory: '' }), factoryFor(new RemoteState()));
    expect((await receiver.onDeploy()).ok).toBe(false);
  });

  it('validates filePattern is required', async () => {
    receiver = new SftpReceiver(makeConfig({ filePattern: '' }), factoryFor(new RemoteState()));
    expect((await receiver.onDeploy()).ok).toBe(false);
  });

  it('validates polling interval minimum', async () => {
    receiver = new SftpReceiver(makeConfig({ pollingIntervalMs: 50 }), factoryFor(new RemoteState()));
    expect((await receiver.onDeploy()).ok).toBe(false);
  });

  it('validates moveToDirectory required when afterProcessing is MOVE', async () => {
    receiver = new SftpReceiver(
      makeConfig({ afterProcessing: SFTP_POST_ACTION.MOVE, moveToDirectory: '' }),
      factoryFor(new RemoteState()),
    );
    expect((await receiver.onDeploy()).ok).toBe(false);
  });

  it('deploys with valid config (privateKey auth)', async () => {
    receiver = new SftpReceiver(
      makeConfig({ password: undefined, privateKey: '-----BEGIN KEY-----' }),
      factoryFor(new RemoteState()),
    );
    expect((await receiver.onDeploy()).ok).toBe(true);
  });
});

// ----- onStart -----

describe('onStart', () => {
  it('errors if dispatcher not set', async () => {
    receiver = new SftpReceiver(makeConfig(), factoryFor(new RemoteState()));
    expect((await receiver.onStart()).ok).toBe(false);
  });

  it('connects on start', async () => {
    const state = new RemoteState();
    receiver = new SftpReceiver(makeConfig(), factoryFor(state));
    receiver.setDispatcher(makeDispatcher());
    const result = await receiver.onStart();
    expect(result.ok).toBe(true);
    expect(state.connectCount).toBe(1);
  });
});

// ----- Poll cycle -----

describe('poll cycle', () => {
  it('downloads and dispatches files matching the glob', async () => {
    const state = new RemoteState();
    const old = Date.now() - 10_000;
    state.addFile('patient.hl7', 'MSH|^~\\&|A', old);
    state.addFile('data.txt', 'ignore', old);
    state.addFile('lab.hl7', 'MSH|^~\\&|B', old);

    const captured: RawMessage[] = [];
    receiver = new SftpReceiver(makeConfig(), factoryFor(state));
    receiver.setDispatcher(makeDispatcher((raw) => { captured.push(raw); return { messageId: captured.length }; }));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(captured).toHaveLength(2);
    const names = captured.map((r) => r.sourceMap['originalFilename']);
    expect(names).toEqual(['lab.hl7', 'patient.hl7']); // sorted by name
    expect(captured[0]!.content).toBe('MSH|^~\\&|B');
  });

  it('skips files younger than minFileAgeMs (still being written)', async () => {
    const state = new RemoteState();
    const pollTime = Date.now() + 5_000;
    state.addFile('old.hl7', 'aged', pollTime - 5_000);   // passes 1s threshold
    state.addFile('fresh.hl7', 'writing', pollTime - 200); // fails threshold

    const captured: RawMessage[] = [];
    receiver = new SftpReceiver(makeConfig({ minFileAgeMs: 1_000 }), factoryFor(state));
    receiver.setDispatcher(makeDispatcher((raw) => { captured.push(raw); return { messageId: 1 }; }));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(captured).toHaveLength(1);
    expect(captured[0]!.sourceMap['originalFilename']).toBe('old.hl7');
  });

  it('never dispatches the quarantine ledger sidecar', async () => {
    const state = new RemoteState();
    state.ledger = '[]';
    state.addFile('a.hl7', 'X', Date.now() - 10_000);

    const captured: RawMessage[] = [];
    receiver = new SftpReceiver(makeConfig(), factoryFor(state));
    receiver.setDispatcher(makeDispatcher((raw) => { captured.push(raw); return { messageId: 1 }; }));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(captured).toHaveLength(1);
    expect(captured[0]!.sourceMap['originalFilename']).toBe('a.hl7');
  });

  it('populates sourceMap with file metadata', async () => {
    const state = new RemoteState();
    const mtime = Date.now() - 10_000;
    state.addFile('patient.hl7', 'MSH', mtime);

    let capturedRaw: RawMessage | null = null;
    receiver = new SftpReceiver(makeConfig(), factoryFor(state));
    receiver.setDispatcher(makeDispatcher((raw) => { capturedRaw = raw; return { messageId: 1 }; }));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(capturedRaw).not.toBeNull();
    expect(capturedRaw!.sourceMap['originalFilename']).toBe('patient.hl7');
    expect(capturedRaw!.sourceMap['remoteDirectory']).toBe('/inbound');
    expect(capturedRaw!.sourceMap['lastModified']).toBe(mtime);
  });
});

// ----- Post-processing -----

describe('post-processing', () => {
  it('deletes the file when afterProcessing is DELETE', async () => {
    const state = new RemoteState();
    state.addFile('a.hl7', 'X', Date.now() - 10_000);
    receiver = new SftpReceiver(makeConfig({ afterProcessing: SFTP_POST_ACTION.DELETE }), factoryFor(state));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(state.deleted).toContain('a.hl7');
    expect(state.files.has('a.hl7')).toBe(false);
  });

  it('moves the file when afterProcessing is MOVE', async () => {
    const state = new RemoteState();
    state.addFile('a.hl7', 'X', Date.now() - 10_000);
    receiver = new SftpReceiver(
      makeConfig({ afterProcessing: SFTP_POST_ACTION.MOVE, moveToDirectory: '/processed' }),
      factoryFor(state),
    );
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(state.mkdirs).toContain('/processed');
    expect(state.renamed).toContainEqual(['/inbound/a.hl7', '/processed/a.hl7']);
  });

  it('leaves the file when afterProcessing is NONE', async () => {
    const state = new RemoteState();
    state.addFile('a.hl7', 'X', Date.now() - 10_000);
    receiver = new SftpReceiver(makeConfig({ afterProcessing: SFTP_POST_ACTION.NONE }), factoryFor(state));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(state.deleted).toHaveLength(0);
    expect(state.renamed).toHaveLength(0);
    expect(state.files.has('a.hl7')).toBe(true);
  });

  it('does not post-process when dispatch fails', async () => {
    const state = new RemoteState();
    state.addFile('a.hl7', 'X', Date.now() - 10_000);
    const failDispatcher = async (): Promise<Result<DispatchResult>> => ({
      ok: false as const,
      value: null,
      error: { name: 'Error', code: 'DISPATCH_FAILED', message: 'dispatch failed' },
    });
    receiver = new SftpReceiver(makeConfig(), factoryFor(state));
    receiver.setDispatcher(failDispatcher);
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(state.deleted).toHaveLength(0);
    expect(state.files.has('a.hl7')).toBe(true);
  });
});

// ----- Quarantine (durable, no re-dispatch) -----

describe('durable quarantine', () => {
  it('quarantines a file whose post-action fails and does not re-dispatch it', async () => {
    const state = new RemoteState();
    state.addFile('a.hl7', 'X', Date.now() - 10_000);
    const { logger, errors } = makeMockLogger();

    let dispatchCount = 0;
    // delete fails → post-action fails after successful dispatch.
    receiver = new SftpReceiver(makeConfig(), factoryFor(state, { delete: true }), logger);
    receiver.setDispatcher(makeDispatcher(() => { dispatchCount++; return { messageId: dispatchCount }; }));
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(5_000); // cycle 1: dispatch + failed delete → quarantine
    await vi.advanceTimersByTimeAsync(5_000); // cycle 2: same file present, must not re-dispatch

    expect(dispatchCount).toBe(1);
    expect(errors.some((e) => e.msg.includes('quarantining'))).toBe(true);
  });

  it('persists the quarantine to the remote sidecar ledger', async () => {
    const state = new RemoteState();
    const mtime = Date.now() - 10_000;
    state.addFile('a.hl7', 'X', mtime);
    receiver = new SftpReceiver(makeConfig(), factoryFor(state, { delete: true }));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(state.ledger).not.toBeNull();
    expect(state.ledger!).toContain(`a.hl7:${String(mtime)}`);
  });

  it('durable quarantine survives a restart: a new receiver loads the ledger and does not re-dispatch', async () => {
    const state = new RemoteState();
    const mtime = Date.now() - 10_000;
    state.addFile('a.hl7', 'X', mtime);
    state.ledger = JSON.stringify([`a.hl7:${String(mtime)}`]);

    let dispatchCount = 0;
    receiver = new SftpReceiver(makeConfig(), factoryFor(state));
    receiver.setDispatcher(makeDispatcher(() => { dispatchCount++; return { messageId: dispatchCount }; }));
    await receiver.onStart(); // loads ledger → key already quarantined
    await vi.advanceTimersByTimeAsync(5_000);

    expect(dispatchCount).toBe(0);
  });

  it('treats a corrupt ledger as empty (does not crash) and logs it', async () => {
    const state = new RemoteState();
    state.ledger = '[not valid json';
    state.addFile('a.hl7', 'X', Date.now() - 10_000);
    const { logger, errors } = makeMockLogger();

    let dispatchCount = 0;
    receiver = new SftpReceiver(makeConfig({ afterProcessing: SFTP_POST_ACTION.NONE }), factoryFor(state), logger);
    receiver.setDispatcher(makeDispatcher(() => { dispatchCount++; return { messageId: 1 }; }));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(dispatchCount).toBe(1); // ledger ignored, file still dispatched
    expect(errors.some((e) => e.msg.includes('corrupt'))).toBe(true);
  });
});

// ----- Connection loss / reconnect -----

describe('connection loss', () => {
  it('logs the poll-cycle failure and reconnects on the next cycle', async () => {
    const state = new RemoteState();
    state.addFile('a.hl7', 'X', Date.now() - 10_000);
    const { logger, errors } = makeMockLogger();

    // First list fails (dropped connection), subsequent clients succeed.
    let clientIdx = 0;
    const factory: SftpClientFactory = () => {
      clientIdx++;
      return makeMockSftpClient(state, clientIdx === 1 ? { list: true } : {});
    };

    const captured: RawMessage[] = [];
    receiver = new SftpReceiver(makeConfig(), factory, logger);
    receiver.setDispatcher(makeDispatcher((raw) => { captured.push(raw); return { messageId: 1 }; }));
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(5_000); // cycle 1: list fails → logged, client dropped
    expect(captured).toHaveLength(0);
    expect(errors.some((e) => e.msg.includes('poll cycle failed'))).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000); // cycle 2: reconnect, succeeds
    expect(captured).toHaveLength(1);
  });
});

// ----- Lifecycle -----

describe('lifecycle', () => {
  it('stops and clears the interval and disconnects', async () => {
    const state = new RemoteState();
    receiver = new SftpReceiver(makeConfig(), factoryFor(state));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    expect((await receiver.onStop()).ok).toBe(true);
    expect(state.endCount).toBeGreaterThanOrEqual(1);
    receiver = null;
  });

  it('halt clears the interval', async () => {
    const state = new RemoteState();
    receiver = new SftpReceiver(makeConfig(), factoryFor(state));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    expect((await receiver.onHalt()).ok).toBe(true);
    receiver = null;
  });
});
