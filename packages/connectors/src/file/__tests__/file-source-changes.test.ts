// A File source on a real folder: what it reads, deletes and moves when the folder changes under it (#412).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { DispatchResult, RawMessage } from '../../base.js';
import { FileReceiver, FILE_POST_ACTION, FILE_SORT_BY, type FileReceiverConfig } from '../file-receiver.js';
import { tempFileName } from '../../temp-file.js';
import { makeMockLogger, type MockLogger } from '../../__fixtures__/mock-logger.js';

vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>();
  return { ...real, link: vi.fn(real.link), unlink: vi.fn(real.unlink) };
});

const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

const LEDGER = '.galvanigraph-quarantine.json';
const POLL_MS = 100;

let root: string;
let inbound: string;
let archive: string;
let receiver: FileReceiver | null = null;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'gg-file-source-')));
  inbound = path.join(root, 'in');
  archive = path.join(root, 'archive');
  await fs.mkdir(inbound);
});

afterEach(async () => {
  await receiver?.onStop();
  receiver = null;
  vi.mocked(fs.link).mockReset().mockImplementation(realFs.link);
  vi.mocked(fs.unlink).mockReset().mockImplementation(realFs.unlink);
  await fs.rm(root, { recursive: true, force: true });
});

function makeConfig(overrides?: Partial<FileReceiverConfig>): FileReceiverConfig {
  return {
    directory: inbound,
    fileFilter: '*',
    pollingIntervalMs: POLL_MS,
    sortBy: FILE_SORT_BY.NAME,
    charset: 'utf-8',
    binary: false,
    checkFileAge: true,
    // Long, so a loaded machine cannot age a file by itself; the tests age it.
    fileAgeMs: 30_000,
    postAction: FILE_POST_ACTION.DELETE,
    moveToDirectory: archive,
    ignoreDot: true,
    roots: { allowed: [root], denied: [] },
    ...overrides,
  };
}

async function age(file: string, ageMs: number): Promise<void> {
  const time = new Date(Date.now() - ageMs);
  await fs.utimes(file, time, time);
}

/** A file old enough to read. */
async function drop(name: string, content: string, dir = inbound): Promise<void> {
  const file = path.join(dir, name);
  await fs.writeFile(file, content);
  await age(file, 60_000);
}

interface Started {
  readonly seen: string[];
  readonly log: MockLogger;
  readonly receiver: FileReceiver;
}

async function start(
  overrides: Partial<FileReceiverConfig>,
  onMessage: (raw: RawMessage) => Promise<DispatchResult | void> = async () => undefined,
): Promise<Started> {
  const seen: string[] = [];
  const log = makeMockLogger();
  const r = new FileReceiver(makeConfig(overrides), log.logger);
  r.setDispatcher(async (raw) => {
    seen.push(raw.content);
    return { ok: true as const, value: (await onMessage(raw)) ?? { messageId: seen.length }, error: null };
  });
  receiver = r;
  expect((await r.onDeploy()).ok).toBe(true);
  expect((await r.onStart()).ok).toBe(true);
  return { seen, log, receiver: r };
}

const pollsPass = (count: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, count * POLL_MS + 50); });

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

/** A wait long enough for a loaded machine; it ends as soon as the condition holds. */
const soon = (check: () => void | Promise<void>): Promise<void> => vi.waitFor(check, { timeout: 10_000 });

describe('a file that changes under a File source (#412)', () => {
  it('reads a file rewritten while an earlier file was processed only once it is whole', async () => {
    await drop('a.hl7', 'A');
    await drop('b.hl7', 'B as it was listed');
    const b = path.join(inbound, 'b.hl7');
    const { seen } = await start({}, async (raw) => {
      if (raw.content === 'A') await fs.writeFile(b, 'B first half,');
    });

    await soon(() => { expect(seen).toEqual(['A']); });
    await pollsPass(2);
    expect(seen).toEqual(['A']);
    await fs.appendFile(b, ' second half');
    await age(b, 40_000);

    await soon(() => { expect(seen).toEqual(['A', 'B first half, second half']); });
    await soon(async () => { expect(await exists(b)).toBe(false); });
  });

  it('does not delete a file that changed while its message was processed, and reads the new content', async () => {
    await drop('a.hl7', 'first');
    const a = path.join(inbound, 'a.hl7');
    const { seen, log } = await start({}, async (raw) => {
      if (raw.content !== 'first') return;
      await fs.writeFile(a, 'second version');
      await age(a, 40_000);
    });

    await soon(() => { expect(seen).toEqual(['first', 'second version']); });
    await soon(async () => { expect(await exists(a)).toBe(false); });
    expect(log.warnings.some((w) => w.obj['file'] === a && w.msg.includes('changed'))).toBe(true);
    expect(await exists(path.join(inbound, LEDGER))).toBe(false);
  });

  it('does not move a file that changed while its message was processed', async () => {
    await drop('a.hl7', 'first');
    const a = path.join(inbound, 'a.hl7');
    const { seen } = await start({ postAction: FILE_POST_ACTION.MOVE }, async () => {
      await fs.writeFile(a, 'second version');
    });

    await soon(() => { expect(seen).toEqual(['first']); });
    await pollsPass(2);
    expect(await fs.readFile(a, 'utf8')).toBe('second version');
    expect(await exists(path.join(archive, 'a.hl7'))).toBe(false);
  });

  it('does not deliver a file again that came back unchanged after it was gone during processing', async () => {
    await drop('a.hl7', 'A');
    const a = path.join(inbound, 'a.hl7');
    const aside = path.join(root, 'aside');
    const { seen } = await start({}, async () => { await fs.rename(a, aside); });

    await soon(() => { expect(seen).toEqual(['A']); });
    await pollsPass(1);
    await fs.rename(aside, a);
    await pollsPass(3);

    expect(seen).toEqual(['A']);
  });
});

describe('a temporary file of a destination (#412)', () => {
  it('is never read, whatever the filter and ignoreDot say', async () => {
    const temp = path.join(inbound, tempFileName());
    await drop(path.basename(temp), 'half');
    await drop('a.hl7', 'A');
    const { seen } = await start({ ignoreDot: false });
    await soon(async () => { expect(await exists(path.join(inbound, 'a.hl7'))).toBe(false); });
    await pollsPass(1);
    expect(seen).toEqual(['A']);
    expect(await exists(temp)).toBe(true);
  });
});

describe('a File source that moves what it read (#412)', () => {
  it('puts the file in the target folder with its content', async () => {
    await drop('a.hl7', 'MSH|^~\\&|A');
    const { seen } = await start({ postAction: FILE_POST_ACTION.MOVE });

    await soon(async () => { expect(await exists(path.join(inbound, 'a.hl7'))).toBe(false); });
    expect(await fs.readFile(path.join(archive, 'a.hl7'), 'utf8')).toBe('MSH|^~\\&|A');
    expect(await fs.readdir(archive)).toEqual(['a.hl7']);
    expect(seen).toEqual(['MSH|^~\\&|A']);
  });

  async function expectKeptBoth(): Promise<void> {
    expect(await fs.readFile(path.join(archive, 'a.hl7'), 'utf8')).toBe('yesterday');
    expect(await fs.readFile(path.join(inbound, 'a.hl7'), 'utf8')).toBe('today');
  }

  it('keeps both files when the target folder has one of that name, and does not deliver again, even after a restart', async () => {
    await fs.mkdir(archive);
    await drop('a.hl7', 'yesterday', archive);
    await drop('a.hl7', 'today');
    const first = await start({ postAction: FILE_POST_ACTION.MOVE });

    await soon(() => { expect(first.log.errors.some((e) => e.msg.includes('quarantining'))).toBe(true); });
    const error = first.log.errors.find((e) => e.msg.includes('quarantining'))!;
    expect(String(error.obj['errMsg'])).toContain(path.join(archive, 'a.hl7'));
    await expectKeptBoth();
    await first.receiver.onStop();

    const second = await start({ postAction: FILE_POST_ACTION.MOVE });
    await pollsPass(3);
    expect(first.seen).toEqual(['today']);
    expect(second.seen).toEqual([]);
    await expectKeptBoth();
  });

  it('moves on a file system without hard links, and still replaces nothing', async () => {
    vi.mocked(fs.link).mockRejectedValue(Object.assign(new Error('EPERM: operation not permitted, link'), { code: 'EPERM' }));
    await fs.mkdir(archive);
    await drop('a.hl7', 'yesterday', archive);
    await drop('a.hl7', 'today');
    await drop('b.hl7', 'B');
    const { log } = await start({ postAction: FILE_POST_ACTION.MOVE });

    await soon(async () => { expect(await exists(path.join(archive, 'b.hl7'))).toBe(true); });
    expect(await exists(path.join(inbound, 'b.hl7'))).toBe(false);
    await expectKeptBoth();
    expect(log.errors.some((e) => e.msg.includes('quarantining'))).toBe(true);
  });

  it('keeps the moved file when its old name is already gone', async () => {
    vi.mocked(fs.unlink).mockImplementation(async (file) => {
      await realFs.unlink(file);
      if (path.dirname(String(file)) === inbound) throw Object.assign(new Error('ENOENT: no such file, unlink'), { code: 'ENOENT' });
    });
    await drop('a.hl7', 'A');
    const { log } = await start({ postAction: FILE_POST_ACTION.MOVE });
    await soon(async () => { expect(await exists(path.join(inbound, 'a.hl7'))).toBe(false); });
    await pollsPass(1);
    expect(await fs.readFile(path.join(archive, 'a.hl7'), 'utf8')).toBe('A');
    expect(log.errors).toEqual([]);
  });

  it('keeps the moved file when an unlink that reported an error did remove the old name', async () => {
    vi.mocked(fs.unlink).mockImplementation(async (file) => {
      await realFs.unlink(file);
      if (path.dirname(String(file)) === inbound) throw Object.assign(new Error('EIO: i/o error, unlink'), { code: 'EIO' });
    });
    await drop('a.hl7', 'A');
    const { log } = await start({ postAction: FILE_POST_ACTION.MOVE });
    await soon(() => { expect(log.errors.some((e) => e.msg.includes('quarantining'))).toBe(true); });
    expect(await fs.readFile(path.join(archive, 'a.hl7'), 'utf8')).toBe('A');
  });

  it('finishes a move that was cut off after the file had its new name', async () => {
    await fs.mkdir(archive);
    await drop('a.hl7', 'A');
    await fs.link(path.join(inbound, 'a.hl7'), path.join(archive, 'a.hl7'));
    const { log } = await start({ postAction: FILE_POST_ACTION.MOVE });
    await soon(async () => { expect(await exists(path.join(inbound, 'a.hl7'))).toBe(false); });
    await pollsPass(1);
    expect(await fs.readFile(path.join(archive, 'a.hl7'), 'utf8')).toBe('A');
    expect(log.errors).toEqual([]);
  });

  it('keeps a file whose target folder is the one it is in', async () => {
    await drop('a.hl7', 'A');
    await fs.link(path.join(inbound, 'a.hl7'), path.join(root, 'another name'));
    const { seen, log } = await start({ postAction: FILE_POST_ACTION.MOVE, moveToDirectory: inbound });
    await soon(() => { expect(log.errors.some((e) => e.msg.includes('quarantining'))).toBe(true); });
    await pollsPass(2);
    expect(await fs.readFile(path.join(inbound, 'a.hl7'), 'utf8')).toBe('A');
    expect(seen).toEqual(['A']);
  });

  it('leaves no copy in the target folder when the file cannot leave the source folder', async () => {
    vi.mocked(fs.unlink).mockImplementation(async (file) => {
      if (path.dirname(String(file)) === inbound) throw Object.assign(new Error('EPERM: operation not permitted, unlink'), { code: 'EPERM' });
      await realFs.unlink(file);
    });
    await drop('a.hl7', 'A');
    const { seen, log } = await start({ postAction: FILE_POST_ACTION.MOVE });

    await soon(() => { expect(log.errors.some((e) => e.msg.includes('quarantining'))).toBe(true); });
    expect(await fs.readFile(path.join(inbound, 'a.hl7'), 'utf8')).toBe('A');
    expect(await fs.readdir(archive)).toEqual([]);
    await pollsPass(2);
    expect(seen).toEqual(['A']);
  });
});
