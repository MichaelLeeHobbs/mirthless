// A server that signs a client in and does not start SFTP: no connection may be left open (#434).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SftpReceiver, SFTP_POST_ACTION } from '../sftp-receiver.js';
import { SftpDispatcher } from '../sftp-dispatcher.js';
import { createSsh2SftpClient } from '../sftp-client.js';
import { startSftpServer, type TestSftpServer } from '../../__fixtures__/sftp-server.js';

let server: TestSftpServer;

beforeEach(async () => {
  server = await startSftpServer('/in', '/out');
});

afterEach(async () => {
  vi.useRealTimers();
  await server.close();
});

/** Resolves once a signed-in client has asked for SFTP, which it never gets. */
function leaveUnanswered(): Promise<void> {
  return new Promise((resolve) => { server.rules.onSubsystem = () => { resolve(); }; });
}

async function expectNoConnections(): Promise<void> {
  await vi.waitFor(() => { expect(server.connections()).toBe(0); }, { timeout: 5_000 });
}

function makeSource(): SftpReceiver {
  const receiver = new SftpReceiver({
    ...server.options,
    remoteDirectory: '/in',
    filePattern: '*',
    pollingIntervalMs: 100,
    afterProcessing: SFTP_POST_ACTION.NONE,
    moveToDirectory: '',
    minFileAgeMs: 0,
    ignoreDot: true,
  });
  receiver.setDispatcher(async () => ({ ok: true as const, value: { messageId: 1 }, error: null }));
  return receiver;
}

async function send(signal: AbortSignal): Promise<string> {
  const dispatcher = new SftpDispatcher({
    ...server.options, remoteDirectory: '/out', fileNameTemplate: 'a.hl7', appendMode: false, tempFileEnabled: true,
  });
  expect((await dispatcher.onStart()).ok).toBe(true);
  const result = await dispatcher.send({ channelId: 'ch-1', messageId: 42, metaDataId: 1, content: 'A', dataType: 'HL7V2' }, signal);
  return result.ok ? 'sent' : result.error.message;
}

describe('an SFTP server that signs in and never answers the request for SFTP', () => {
  it('has no connection left once the client is closed', async () => {
    const asked = leaveUnanswered();
    const client = createSsh2SftpClient(server.options);
    const connecting = client.connect().catch((err: unknown) => err);
    await asked;
    expect(server.connections()).toBe(1);

    await client.end();

    await expectNoConnections();
    expect(await connecting).toBeInstanceOf(Error);
  });

  it('has no connection left when a source gives up its connect', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const asked = leaveUnanswered();
    const starting = makeSource().onStart();
    await asked;
    expect(server.connections()).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    const started = await starting;
    vi.useRealTimers();

    expect(started.ok ? '' : started.error.message).toBe('SFTP connect timed out after 30000ms');
    await expectNoConnections();
  });

  it('has no connection left when a send is given up', async () => {
    const asked = leaveUnanswered();
    const abort = new AbortController();
    const sending = send(abort.signal);
    await asked;
    expect(server.connections()).toBe(1);

    abort.abort(new Error('SFTP send given up by the test'));

    expect(await sending).toContain('given up by the test');
    await expectNoConnections();
  });
});

describe('an SFTP server that signs in and refuses to start SFTP', () => {
  beforeEach(() => {
    server.rules.onSubsystem = (refuse) => { refuse(); };
  });

  it('has no connection left when a source cannot start', async () => {
    const started = await makeSource().onStart();
    expect(started.ok ? '' : started.error.message).toContain('Unable to start subsystem: sftp');
    await expectNoConnections();
  });

  it('has no connection left when a send fails', async () => {
    expect(await send(new AbortController().signal)).toContain('Unable to start subsystem: sftp');
    await expectNoConnections();
  });
});
