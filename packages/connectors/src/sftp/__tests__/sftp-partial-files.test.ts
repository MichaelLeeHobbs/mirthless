// The SFTP connectors against a server in this process, over a real connection with host key checking on (#412).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConnectorMessage, DispatchResult, RawMessage } from '../../base.js';
import { SftpReceiver, SFTP_POST_ACTION, type SftpReceiverConfig } from '../sftp-receiver.js';
import { SftpDispatcher, type SftpDispatcherConfig } from '../sftp-dispatcher.js';
import { makeMockLogger, type MockLogger } from '../../__fixtures__/mock-logger.js';
import { startSftpServer, type TestSftpServer } from '../../__fixtures__/sftp-server.js';

const POLL_MS = 100;
const LEDGER = '/in/.galvanigraph-quarantine.json';

let server: TestSftpServer;
let receivers: SftpReceiver[] = [];

beforeEach(async () => {
  server = await startSftpServer('/in', '/out', '/archive');
});

afterEach(async () => {
  for (const r of receivers) await r.onStop();
  receivers = [];
  await server.close();
});

function sourceConfig(overrides?: Partial<SftpReceiverConfig>): SftpReceiverConfig {
  return {
    ...server.options,
    remoteDirectory: '/in',
    filePattern: '*',
    pollingIntervalMs: POLL_MS,
    afterProcessing: SFTP_POST_ACTION.DELETE,
    moveToDirectory: '/archive',
    // Long, so a loaded machine cannot age a file by itself; the tests age it.
    minFileAgeMs: 30_000,
    ignoreDot: true,
    ...overrides,
  };
}

interface Started {
  readonly seen: string[];
  readonly log: MockLogger;
  readonly receiver: SftpReceiver;
}

async function start(
  overrides: Partial<SftpReceiverConfig>,
  onMessage: (raw: RawMessage) => Promise<DispatchResult | void> = async () => undefined,
): Promise<Started> {
  const seen: string[] = [];
  const log = makeMockLogger();
  const r = new SftpReceiver(sourceConfig(overrides), undefined, log.logger);
  r.setDispatcher(async (raw) => {
    seen.push(raw.content);
    return { ok: true as const, value: (await onMessage(raw)) ?? { messageId: seen.length }, error: null };
  });
  receivers.push(r);
  expect((await r.onDeploy()).ok).toBe(true);
  expect((await r.onStart()).ok).toBe(true);
  return { seen, log, receiver: r };
}

const pollsPass = (count: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, count * POLL_MS + 50); });

const aged = (): number => Date.now() - 45_000;

describe('a file that changes under an SFTP source', () => {
  it('reads a file rewritten while an earlier file was processed only once it is whole', async () => {
    server.put('/in/a.hl7', 'A');
    server.put('/in/b.hl7', 'B as it was listed');
    const { seen } = await start({}, async (raw) => {
      if (raw.content === 'A') server.put('/in/b.hl7', 'B first half,', Date.now());
    });

    await vi.waitFor(() => { expect(server.text('/in/a.hl7')).toBeUndefined(); });
    await pollsPass(2);
    expect(seen).toEqual(['A']);
    server.put('/in/b.hl7', 'B first half, second half', aged());

    await vi.waitFor(() => { expect(seen).toEqual(['A', 'B first half, second half']); }, { timeout: 5_000 });
    await vi.waitFor(() => { expect(server.text('/in/b.hl7')).toBeUndefined(); });
  });

  it('does not delete a file that changed while its message was processed, and reads the new content', async () => {
    server.put('/in/a.hl7', 'first');
    const { seen, log } = await start({}, async (raw) => {
      if (raw.content === 'first') server.put('/in/a.hl7', 'second version', aged());
    });

    await vi.waitFor(() => { expect(seen).toEqual(['first', 'second version']); }, { timeout: 5_000 });
    await vi.waitFor(() => { expect(server.text('/in/a.hl7')).toBeUndefined(); });
    expect(log.warnings.some((w) => w.obj['file'] === 'a.hl7' && w.msg.includes('changed'))).toBe(true);
    expect(server.text(LEDGER)).toBeUndefined();
  });
});

describe('an SFTP source that moves what it read', () => {
  it('puts the file in the target folder with its content', async () => {
    server.put('/in/a.hl7', 'MSH|^~\\&|A');
    await start({ afterProcessing: SFTP_POST_ACTION.MOVE });
    await vi.waitFor(() => { expect(server.text('/archive/a.hl7')).toBe('MSH|^~\\&|A'); });
    expect(server.text('/in/a.hl7')).toBeUndefined();
  });

  it.each([false, true])('replaces nothing in the target folder and does not deliver again (a rename there replaces: %s)', async (renameReplaces) => {
    server.rules.renameReplaces = renameReplaces;
    server.put('/archive/a.hl7', 'yesterday');
    server.put('/in/a.hl7', 'today');
    const first = await start({ afterProcessing: SFTP_POST_ACTION.MOVE });
    await vi.waitFor(() => { expect(first.log.errors.some((e) => e.msg.includes('quarantining'))).toBe(true); });
    const error = first.log.errors.find((e) => e.msg.includes('quarantining'))!;
    expect(String(error.obj['errMsg'])).toContain('/archive/a.hl7');
    await first.receiver.onStop();

    const second = await start({ afterProcessing: SFTP_POST_ACTION.MOVE });
    await pollsPass(3);
    expect([...first.seen, ...second.seen]).toEqual(['today']);
    expect(server.text('/archive/a.hl7')).toBe('yesterday');
    expect(server.text('/in/a.hl7')).toBe('today');
  });
});

describe('an SFTP source stopped while a message is processed', () => {
  async function stopDuring(
    how: 'onStop' | 'onHalt', result: DispatchResult, overrides?: Partial<SftpReceiverConfig>,
  ): Promise<{ readonly started: Started; readonly stopped: Promise<unknown>; readonly release: () => void }> {
    server.put('/in/a.hl7', 'A');
    server.put('/in/b.hl7', 'B');
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = await start(overrides ?? {}, async () => { await gate; return result; });
    await vi.waitFor(() => { expect(started.seen).toEqual(['A']); });
    return { started, stopped: started.receiver[how](), release };
  }

  it('deletes the file before the stop ends, and takes no other', async () => {
    const { started, stopped, release } = await stopDuring('onStop', { messageId: 1 });
    let ended = false;
    void stopped.then(() => { ended = true; });
    await pollsPass(1);
    expect(ended).toBe(false);

    release();
    await stopped;
    expect(server.text('/in/a.hl7')).toBeUndefined();
    expect(started.seen).toEqual(['A']);
    expect(server.text('/in/b.hl7')).toBe('B');
  });

  it('moves the file before the stop ends', async () => {
    const { stopped, release } = await stopDuring('onStop', { messageId: 1 }, { afterProcessing: SFTP_POST_ACTION.MOVE });
    release();
    await stopped;
    expect(server.text('/archive/a.hl7')).toBe('A');
    expect(server.text('/in/a.hl7')).toBeUndefined();
  });

  it('quarantines a file recorded with an ERROR, so a redeploy does not take it again', async () => {
    const { stopped, release } = await stopDuring('onStop', { messageId: 1, status: 'ERROR' });
    release();
    await stopped;

    const again = await start({});
    await vi.waitFor(() => { expect(again.seen).toEqual(['B']); });
    await pollsPass(2);
    expect(again.seen).toEqual(['B']);
    expect(server.text('/in/a.hl7')).toBe('A');
  });

  it.each([
    ['deletes', { messageId: 1 } as DispatchResult],
    ['quarantines', { messageId: 1, status: 'ERROR' } as DispatchResult],
  ])('a halt does not wait, and the file in flight is settled after it (%s)', async (_label, result) => {
    const { started, stopped, release } = await stopDuring('onHalt', result);
    await stopped;
    release();
    await vi.waitFor(() => { expect(server.text('/in/a.hl7') === undefined || server.text(LEDGER) !== undefined).toBe(true); });
    await pollsPass(2);
    expect(started.seen).toEqual(['A']);
    await vi.waitFor(() => { expect(server.connections()).toBe(0); });
  });

  it('a start after a halt takes the next file on a connection of its own, once the one in flight is settled', async () => {
    const { started, stopped, release } = await stopDuring('onHalt', { messageId: 1 });
    await stopped;
    expect((await started.receiver.onStart()).ok).toBe(true);
    await vi.waitFor(() => { expect(server.connections()).toBe(2); });
    await pollsPass(2);
    expect(started.seen).toEqual(['A']);

    release();
    await vi.waitFor(() => { expect(started.seen).toEqual(['A', 'B']); });
    await vi.waitFor(() => { expect(server.list('/in')).toEqual([]); });
    await vi.waitFor(() => { expect(server.connections()).toBe(1); });
  });
});

function destinationConfig(overrides?: Partial<SftpDispatcherConfig>): SftpDispatcherConfig {
  return {
    ...server.options,
    remoteDirectory: '/out',
    fileNameTemplate: 'latest.hl7',
    appendMode: false,
    tempFileEnabled: true,
    ...overrides,
  };
}

function makeMessage(content: string): ConnectorMessage {
  return { channelId: 'ch-1', messageId: 42, metaDataId: 1, content, dataType: 'HL7V2' };
}

async function send(
  content: string, overrides?: Partial<SftpDispatcherConfig>, signal: AbortSignal = new AbortController().signal,
): Promise<{ readonly ok: boolean; readonly error: string }> {
  const d = new SftpDispatcher(destinationConfig(overrides));
  expect((await d.onStart()).ok).toBe(true);
  const result = await d.send(makeMessage(content), signal);
  return { ok: result.ok, error: result.ok ? '' : result.error.message };
}

const BIG = 'x'.repeat(300_000);
const TEMP_NAME = /^\.galvanigraph-[0-9a-f-]{36}\.tmp$/;

describe('an SFTP destination writes under a temporary name', () => {
  it('never shows part of a file under its final name', async () => {
    const during: string[][] = [];
    server.rules.onWrite = () => { during.push(server.list('/out')); };
    expect(await send(BIG)).toEqual({ ok: true, error: '' });

    expect(during.length).toBeGreaterThan(1);
    for (const names of during) {
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(TEMP_NAME);
    }
    expect(server.list('/out')).toEqual(['latest.hl7']);
    expect(server.text('/out/latest.hl7')).toBe(BIG);
  });

  it('writes an empty message', async () => {
    expect((await send('')).ok).toBe(true);
    expect(server.text('/out/latest.hl7')).toBe('');
  });

  it('puts the temporary file in the folder the name template points to', async () => {
    const during: string[] = [];
    server.rules.onWrite = (file) => { during.push(file); };
    expect((await send('M', { remoteDirectory: '/', fileNameTemplate: 'out/a.hl7' })).ok).toBe(true);
    expect(during[0]).toMatch(/^\/out\/\.galvanigraph-/);
    expect(server.text('/out/a.hl7')).toBe('M');
  });

  it.each([false, true])('replaces an existing file on a server with no posix-rename (a rename there replaces: %s)', async (renameReplaces) => {
    server.rules.renameReplaces = renameReplaces;
    server.put('/out/latest.hl7', 'old');
    expect((await send('new')).ok).toBe(true);
    expect(server.text('/out/latest.hl7')).toBe('new');
    expect(server.list('/out')).toEqual(['latest.hl7']);
  });

  it('fails, keeping the existing file and leaving nothing else, when the server refuses the rename', async () => {
    server.rules.denyRename = true;
    server.put('/out/latest.hl7', 'old');
    const { ok, error } = await send('new');
    expect(ok).toBe(false);
    expect(error).toContain('tempFileEnabled');
    expect(server.text('/out/latest.hl7')).toBe('old');
    expect(server.list('/out')).toEqual(['latest.hl7']);
  });

  it('names the temporary file when it cannot be removed', async () => {
    server.rules.denyRename = true;
    server.rules.denyDelete = true;
    const { ok, error } = await send('new');
    expect(ok).toBe(false);
    const [left] = server.list('/out');
    expect(left).toMatch(TEMP_NAME);
    expect(error).toContain(`/out/${left!}`);
  });

  it('fails when the server stops taking the write part-way, and leaves nothing', async () => {
    server.rules.failWritesAfter = { matches: () => true, bytes: 100_000 };
    const { ok } = await send(BIG);
    expect(ok).toBe(false);
    expect(server.list('/out')).toEqual([]);
  });

  it('does not bring the file into place after the send was given up', async () => {
    const abort = new AbortController();
    const renames: string[] = [];
    server.rules.onRename = (_from, to) => { renames.push(to); };
    server.rules.onWrite = () => { abort.abort(); };
    expect((await send('M', {}, abort.signal)).ok).toBe(false);
    await pollsPass(2);
    expect(renames).toEqual([]);
    expect(server.list('/out')).toEqual([]);
  });

  it('is sent when it is given up during the rename and the rename then ends well', async () => {
    const abort = new AbortController();
    server.rules.onRename = async () => { abort.abort(); await pollsPass(1); };
    expect((await send('M', {}, abort.signal)).ok).toBe(true);
    expect(server.text('/out/latest.hl7')).toBe('M');
  });

  it('keeps the existing file when it is given up before that is deleted to make room', async () => {
    const abort = new AbortController();
    server.put('/out/latest.hl7', 'old');
    server.rules.onRename = async () => { abort.abort(); await pollsPass(1); };
    expect((await send('new', {}, abort.signal)).ok).toBe(false);
    expect(server.text('/out/latest.hl7')).toBe('old');
    expect(server.list('/out')).toEqual(['latest.hl7']);
  });

  it('keeps the existing file when the server lets it neither be replaced nor deleted', async () => {
    server.put('/out/latest.hl7', 'old');
    server.rules.denyDelete = true;
    expect((await send('new')).ok).toBe(false);
    expect(server.text('/out/latest.hl7')).toBe('old');
  });

  it('names the temporary file as the only copy when the rename fails after the existing file was deleted', async () => {
    server.put('/out/latest.hl7', 'old');
    let renames = 0;
    server.rules.onRename = () => { if (++renames === 2) server.rules.denyRename = true; };
    const { ok, error } = await send('new');
    expect(ok).toBe(false);
    const [left] = server.list('/out');
    expect(server.text(`/out/${left!}`)).toBe('new');
    expect(error).toContain(`/out/${left!} holds this message`);
  });

  it('writes under the final name at once when temporary files are off', async () => {
    server.rules.denyRename = true;
    server.rules.denyDelete = true;
    expect((await send('M', { tempFileEnabled: false })).ok).toBe(true);
    expect(server.text('/out/latest.hl7')).toBe('M');
  });

  it('names the file that may hold part of the message when a direct write stops part-way', async () => {
    server.rules.failWritesAfter = { matches: () => true, bytes: 100_000 };
    const { ok, error } = await send(BIG, { tempFileEnabled: false });
    expect(ok).toBe(false);
    expect(error).toContain('/out/latest.hl7 may hold part of this message');
  });

  it('is not read by an SFTP source, even one that reads dotfiles', async () => {
    const inbound = { remoteDirectory: '/out', ignoreDot: false, minFileAgeMs: 0, afterProcessing: SFTP_POST_ACTION.NONE };
    const { seen } = await start(inbound);
    server.rules.onWrite = () => pollsPass(2);
    expect((await send('whole')).ok).toBe(true);
    await vi.waitFor(() => { expect(seen).toContain('whole'); });
    expect(new Set(seen)).toEqual(new Set(['whole']));
  });
});

describe('an SFTP append that is cut off', () => {
  it.each([
    ['the server stops taking the write', (): AbortSignal => { server.rules.failWritesAfter = { matches: () => true, bytes: 100_000 }; return new AbortController().signal; }],
    ['the send is given up', (): AbortSignal => { const c = new AbortController(); server.rules.onWrite = () => { c.abort(); }; return c.signal; }],
  ])('names the file that may hold part of the message (%s)', async (_label, cutOff) => {
    server.put('/out/latest.hl7', 'earlier\n');
    const { ok, error } = await send(BIG, { appendMode: true }, cutOff());
    expect(ok).toBe(false);
    expect(error).toContain('/out/latest.hl7 may hold part of this message');
  });

  it('appends under the final name', async () => {
    server.put('/out/latest.hl7', 'earlier\n');
    expect((await send('new', { appendMode: true })).ok).toBe(true);
    expect(server.text('/out/latest.hl7')).toBe('earlier\nnew');
  });

  it('names no file when nothing could be written', async () => {
    const { ok, error } = await send('M', { appendMode: true, port: 1 });
    expect(ok).toBe(false);
    expect(error).not.toContain('may hold');
  });
});

describe('host key checking', () => {
  it('refuses a server with another key', async () => {
    const other = await startSftpServer('/out');
    try {
      const { ok } = await send('M', { hostKey: other.options.hostKey });
      expect(ok).toBe(false);
      expect(server.list('/out')).toEqual([]);

      const r = new SftpReceiver(sourceConfig({ hostKey: other.options.hostKey }));
      r.setDispatcher(async () => ({ ok: true as const, value: { messageId: 1 }, error: null }));
      expect((await r.onStart()).ok).toBe(false);
    } finally {
      await other.close();
    }
  });
});
