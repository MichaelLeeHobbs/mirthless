import { it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import SftpLibrary from 'ssh2-sftp-client';
import {
  SftpReceiver,
  SftpDispatcher,
  SFTP_POST_ACTION,
  clearChannelRegistry,
  createSsh2SftpClient,
  type DispatchResult,
  type SftpConnectionOptions,
  type SftpDispatcherConfig,
  type SftpReceiverConfig,
} from '../../../index.js';
import { deployChannel, teardownAll, CaptureDestination, type DeployedChannel } from '../support/e2e-harness.js';
import { mllpSource, sendMllp } from '../support/tcp-helpers.js';
import { describeSftp, requireSftp } from './gates.js';
import { freePort } from '../../../__fixtures__/free-port.js';

const TCP_PORT = await freePort();

interface RawSession {
  readonly sftp: { symlink(targetPath: string, linkPath: string, cb: (err: Error | null | undefined) => void): void };
}

interface UtimesSession {
  readonly sftp: { utimes(filePath: string, atime: number, mtime: number, cb: (err: Error | null | undefined) => void): void };
}

let deployed: DeployedChannel[] = [];
afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  clearChannelRegistry();
});

type HostKeyOptions = SftpConnectionOptions & { readonly hostKey: string };

/** The key the server shows, taken on trust here, so every test below can have checking on. */
async function serverHostKey(): Promise<string> {
  const cfg = requireSftp();
  let key = '';
  const raw = new SftpLibrary();
  await raw.connect({
    host: cfg.host, port: cfg.port, username: cfg.username, password: cfg.password,
    hostVerifier: (presented: Buffer) => { key = presented.toString('base64'); return true; },
  });
  await raw.end();
  return key;
}

let hostKey = '';

function connection(): HostKeyOptions {
  const { host, port, username, password } = requireSftp();
  return { host, port, username, password, strictHostKey: true, hostKey };
}

describeSftp('SFTP connector cascade (real SFTP server)', () => {
  beforeAll(async () => { hostKey = await serverHostKey(); });

  it('Channel A uploads via SFTP destination; Channel B\'s SFTP source picks it up', async () => {
    const cfg = requireSftp();
    const conn = connection();

    const sink = new CaptureDestination();

    const channelB = await deployChannel({
      channelId: '00000000-0000-0000-0000-connsftp000b',
      dataType: 'RAW',
      source: new SftpReceiver({
        ...conn,
        remoteDirectory: cfg.baseDir,
        filePattern: '*.hl7',
        pollingIntervalMs: 200,
        afterProcessing: SFTP_POST_ACTION.DELETE,
        moveToDirectory: '',
        minFileAgeMs: 0,
        ignoreDot: true,
      }),
      transformer: "return String(msg) + '::sftp';",
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });

    const channelA = await deployChannel({
      channelId: '00000000-0000-0000-0000-connsftp000a',
      dataType: 'RAW',
      source: mllpSource(TCP_PORT, { maxConnections: 10 }),
      destinations: [{
        metaDataId: 1,
        name: 'SFTP Out',
        connector: new SftpDispatcher({
          ...conn,
          remoteDirectory: cfg.baseDir,
          fileNameTemplate: 'msg-${messageId}.hl7',
          appendMode: false,
          tempFileEnabled: true,
        }),
      }],
    });
    deployed.push(channelA, channelB);

    await sendMllp(TCP_PORT, 'MSH|^~\\&|SFTPTEST');

    for (let i = 0; i < 300 && sink.received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(sink.received).toHaveLength(1);
    expect(sink.lastContent()).toBe('MSH|^~\\&|SFTPTEST::sftp');
  });

  it('tells a directory from a regular file and a missing path (#133)', async () => {
    const cfg = requireSftp();
    const client = createSsh2SftpClient(connection());
    const filePath = `${cfg.baseDir}/pathkind-${String(Date.now())}.txt`;
    await client.connect();
    try {
      await client.put(Buffer.from('x'), filePath);

      expect(await client.pathKind(cfg.baseDir)).toBe('directory');
      expect(await client.pathKind(filePath)).toBe('file');
      expect(await client.pathKind(`${cfg.baseDir}/no-such-entry`)).toBe('missing');
    } finally {
      await client.delete(filePath).catch(() => undefined);
      await client.end();
    }
  });

  it('treats a link to a directory as a directory, and writes through it (#133)', async () => {
    const cfg = requireSftp();
    const conn = { host: cfg.host, port: cfg.port, username: cfg.username, password: cfg.password };
    const stamp = String(Date.now());
    const realDir = `${cfg.baseDir}/real-${stamp}`;
    const linkDir = `${cfg.baseDir}/link-${stamp}`;
    // Our SftpClient cannot make links, so the raw library sets one up (relative target, inside the chroot).
    const raw = new SftpLibrary();
    await raw.connect(conn);
    const client = createSsh2SftpClient(connection());
    await client.connect();
    try {
      await raw.mkdir(realDir);
      // The library's types omit its ssh2 session; ssh2 swaps the arguments for OpenSSH servers itself.
      const session = (raw as unknown as RawSession).sftp;
      await new Promise<void>((resolve, reject) => {
        session.symlink(`real-${stamp}`, linkDir, (err) => { if (err) reject(err); else resolve(); });
      });

      expect(await client.pathKind(linkDir)).toBe('directory');
      await client.mkdir(linkDir);
      await client.put(Buffer.from('through the link'), `${linkDir}/msg.txt`);
      expect(await client.pathKind(`${realDir}/msg.txt`)).toBe('file');
    } finally {
      await raw.delete(`${realDir}/msg.txt`).catch(() => undefined);
      await raw.delete(linkDir).catch(() => undefined);
      await raw.rmdir(realDir).catch(() => undefined);
      await client.end();
      await raw.end();
    }
  });
});

describeSftp('SFTP files that change, and sources that stop (real SFTP server, #412)', () => {
  const raw = new SftpLibrary();
  let dir = '';
  let receivers: SftpReceiver[] = [];

  beforeAll(async () => { hostKey = await serverHostKey(); });

  beforeEach(async () => {
    const { host, port, username, password, baseDir } = requireSftp();
    await raw.connect({ host, port, username, password });
    dir = `${baseDir}/gg412-${randomUUID()}`;
    await raw.mkdir(dir);
    await raw.mkdir(`${dir}/archive`);
  });

  afterEach(async () => {
    for (const r of receivers) await r.onStop();
    receivers = [];
    await raw.rmdir(dir, true);
    await raw.end();
  });

  async function drop(name: string, content: string): Promise<void> {
    await raw.put(Buffer.from(content), `${dir}/${name}`);
    await age(name, 60_000);
  }

  /** SFTP v3 carries whole seconds. */
  async function age(name: string, ageMs: number): Promise<void> {
    const seconds = Math.floor((Date.now() - ageMs) / 1000);
    const session = (raw as unknown as UtimesSession).sftp;
    await new Promise<void>((resolve, reject) => {
      session.utimes(`${dir}/${name}`, seconds, seconds, (err) => { if (err) reject(err); else resolve(); });
    });
  }

  const text = async (name: string): Promise<string> => String(await raw.get(`${dir}/${name}`));
  const isThere = async (name: string): Promise<boolean> => Boolean(await raw.exists(`${dir}/${name}`));

  async function start(
    overrides: Partial<SftpReceiverConfig>, onMessage: (content: string) => Promise<DispatchResult | void> = async () => undefined,
  ): Promise<{ readonly receiver: SftpReceiver; readonly seen: string[] }> {
    const seen: string[] = [];
    const receiver = new SftpReceiver({
      ...connection(), remoteDirectory: dir, filePattern: '*.hl7', pollingIntervalMs: 200, afterProcessing: SFTP_POST_ACTION.DELETE,
      moveToDirectory: `${dir}/archive`, minFileAgeMs: 30_000, ignoreDot: true, ...overrides,
    });
    receiver.setDispatcher(async (message) => {
      seen.push(message.content);
      return { ok: true as const, value: (await onMessage(message.content)) ?? { messageId: seen.length }, error: null };
    });
    receivers.push(receiver);
    const started = await receiver.onStart();
    if (!started.ok) throw started.error;
    return { receiver, seen };
  }

  async function send(
    content: string, overrides: Partial<SftpDispatcherConfig>, signal: AbortSignal = new AbortController().signal,
  ): Promise<string> {
    const dispatcher = new SftpDispatcher({
      ...connection(), remoteDirectory: dir, fileNameTemplate: 'out.txt', appendMode: false, tempFileEnabled: true, ...overrides,
    });
    await dispatcher.onStart();
    const result = await dispatcher.send({ channelId: 'c', messageId: 1, metaDataId: 1, content, dataType: 'RAW' }, signal);
    return result.ok ? result.value.status : result.error.message;
  }

  it('reads a file rewritten while an earlier one was processed only once it is whole', async () => {
    await drop('a.hl7', 'A');
    await drop('b.hl7', 'B as it was listed');
    const { seen } = await start({}, async (content) => {
      if (content === 'A') await raw.put(Buffer.from('B first half,'), `${dir}/b.hl7`);
    });
    await vi.waitFor(async () => { expect(await isThere('a.hl7')).toBe(false); }, { timeout: 10_000 });
    await new Promise((resolve) => { setTimeout(resolve, 700); });
    expect(seen).toEqual(['A']);
    await drop('b.hl7', 'B first half, second half');
    await vi.waitFor(() => { expect(seen).toEqual(['A', 'B first half, second half']); }, { timeout: 10_000 });
    await vi.waitFor(async () => { expect(await isThere('b.hl7')).toBe(false); }, { timeout: 10_000 });
  });

  it('does not delete a file that changed while its message was processed', async () => {
    await drop('a.hl7', 'first');
    const { seen } = await start({}, async (content) => {
      if (content !== 'first') return;
      await raw.put(Buffer.from('second version'), `${dir}/a.hl7`);
      await age('a.hl7', 40_000);
    });
    await vi.waitFor(() => { expect(seen).toEqual(['first', 'second version']); }, { timeout: 10_000 });
    await vi.waitFor(async () => { expect(await isThere('a.hl7')).toBe(false); }, { timeout: 10_000 });
  });

  it('replaces nothing in the move-to folder, and does not deliver again after a redeploy', async () => {
    await raw.put(Buffer.from('yesterday'), `${dir}/archive/a.hl7`);
    await drop('a.hl7', 'today');
    const first = await start({ afterProcessing: SFTP_POST_ACTION.MOVE });
    await vi.waitFor(async () => { expect(await isThere('.galvanigraph-quarantine.json')).toBe(true); }, { timeout: 10_000 });
    await first.receiver.onStop();
    const second = await start({ afterProcessing: SFTP_POST_ACTION.MOVE });
    await new Promise((resolve) => { setTimeout(resolve, 700); });
    expect([...first.seen, ...second.seen]).toEqual(['today']);
    expect(await text('archive/a.hl7')).toBe('yesterday');
    expect(await text('a.hl7')).toBe('today');
  });

  it.each([
    ['deletes it', { messageId: 1 } as DispatchResult, false],
    ['quarantines it after an ERROR', { messageId: 1, status: 'ERROR' } as DispatchResult, true],
  ])('a source stopped while a file is processed %s before the stop ends', async (_label, result, kept) => {
    await drop('a.hl7', 'A');
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { receiver, seen } = await start({}, async () => { await gate; return result; });
    await vi.waitFor(() => { expect(seen).toEqual(['A']); }, { timeout: 10_000 });
    const stopped = receiver.onStop();
    release();
    await stopped;
    expect(await isThere('a.hl7')).toBe(kept);

    const again = await start({});
    await new Promise((resolve) => { setTimeout(resolve, 700); });
    expect(again.seen).toEqual([]);
  });

  it('never shows part of a file, replacing one that is there', async () => {
    const content = 'x'.repeat(30_000_000);
    await raw.put(Buffer.from('old'), `${dir}/out.txt`);
    let done = false;
    const sizes = new Set<number>();
    const watching = (async (): Promise<void> => {
      while (!done) for (const f of await raw.list(dir)) if (f.name === 'out.txt') sizes.add(f.size);
    })();
    expect(await send(content, {})).toBe('SENT');
    done = true;
    await watching;
    expect([...sizes].filter((size) => size !== 3 && size !== content.length)).toEqual([]);
    expect(sizes.has(3)).toBe(true);
    expect((await raw.list(dir)).map((f) => f.name).sort()).toEqual(['archive', 'out.txt']);
    expect((await raw.stat(`${dir}/out.txt`)).size).toBe(content.length);
  });

  it('leaves nothing of a send that is given up half-way', async () => {
    const abort = new AbortController();
    const sent = send('x'.repeat(30_000_000), {}, abort.signal);
    await vi.waitFor(async () => { expect((await raw.list(dir)).some((f) => f.name.endsWith('.tmp') && f.size > 0)).toBe(true); }, { timeout: 10_000, interval: 5 });
    abort.abort();
    expect(await sent).toContain('aborted');
    expect((await raw.list(dir)).map((f) => f.name)).toEqual(['archive']);
  });

  it('names the file that holds part of an append that was given up', async () => {
    const abort = new AbortController();
    const sent = send('x'.repeat(30_000_000), { appendMode: true }, abort.signal);
    await vi.waitFor(async () => { expect((await raw.list(dir)).some((f) => f.name === 'out.txt' && f.size > 0)).toBe(true); }, { timeout: 10_000, interval: 5 });
    abort.abort();
    expect(await sent).toContain(`${dir}/out.txt may hold part of this message`);
  });

  it('writes an empty message and appends to a file', async () => {
    expect(await send('', {})).toBe('SENT');
    expect(await text('out.txt')).toBe('');
    expect(await send('a', { appendMode: true })).toBe('SENT');
    expect(await send('b', { appendMode: true })).toBe('SENT');
    expect(await text('out.txt')).toBe('ab');
  });

  it('refuses a server whose key is not the one configured, in both directions', async () => {
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    await drop('a.hl7', 'A');
    await expect(start({ hostKey: other })).rejects.toThrow();
    expect(await send('M', { hostKey: other })).not.toBe('SENT');
    await expect(start({ hostKey: undefined })).rejects.toThrow();
    expect((await raw.list(dir)).map((f) => f.name).sort()).toEqual(['a.hl7', 'archive']);
  });
});
