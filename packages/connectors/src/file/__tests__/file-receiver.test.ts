import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawMessage, DispatchResult } from '../../base.js';
import { stderr, type Result } from '@galvanigraph/core-util';
import { FileReceiver, matchGlob, FILE_SORT_BY, FILE_POST_ACTION, type FileReceiverConfig } from '../file-receiver.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  rename: vi.fn(),
  link: vi.fn(),
  mkdir: vi.fn(),
  realpath: vi.fn(),
}));

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const mockReaddir = vi.mocked(fs.readdir);
const mockReadFile = vi.mocked(fs.readFile);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockStat = vi.mocked(fs.stat);
const mockUnlink = vi.mocked(fs.unlink);
const mockRename = vi.mocked(fs.rename);
const mockLink = vi.mocked(fs.link);
const mockMkdir = vi.mocked(fs.mkdir);
const mockRealpath = vi.mocked(fs.realpath);

const QUARANTINE_LEDGER = '.galvanigraph-quarantine.json';
/** Earlier names' ledgers (D-205, D-309): still read, never written. */
const LEGACY_LEDGERS = ['.galvaniflow-quarantine.json', '.mirthless-quarantine.json'] as const;

function isLegacyLedger(p: unknown): boolean {
  return LEGACY_LEDGERS.some((name) => String(p).endsWith(name));
}

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
}

function makeConfig(overrides?: Partial<FileReceiverConfig>): FileReceiverConfig {
  return {
    directory: '/data/inbound',
    fileFilter: '*.hl7',
    pollingIntervalMs: 5_000,
    sortBy: FILE_SORT_BY.NAME,
    charset: 'utf-8',
    binary: false,
    checkFileAge: true,
    fileAgeMs: 1_000,
    postAction: FILE_POST_ACTION.DELETE,
    moveToDirectory: '',
    ignoreDot: true,
    roots: { allowed: ['/data'], denied: [] },
    ...overrides,
  };
}

function makeDispatcher(
  handler?: (raw: RawMessage) => DispatchResult,
): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async (raw) => ({
    ok: true as const,
    value: handler
      ? handler(raw)
      : { messageId: 1 },
    error: null,
  });
}

function makeDirent(name: string, isFile = true): { name: string; isFile: () => boolean } {
  return { name, isFile: () => isFile };
}

function makeStatResult(mtimeMs: number, size: number): { mtimeMs: number; size: number } {
  return { mtimeMs, size };
}

let receiver: FileReceiver | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockReadFile.mockRejectedValue(enoent());
  mockWriteFile.mockResolvedValue(undefined as never);
  // No symlinks unless a test says so: every path is its own real path.
  mockRealpath.mockImplementation(((p: string) => Promise.resolve(p)) as never);
});

afterEach(async () => {
  vi.useRealTimers();
  if (receiver) {
    await receiver.onStop();
    await receiver.onUndeploy();
    receiver = null;
  }
});

describe('matchGlob', () => {
  it('matches * wildcard', () => {
    expect(matchGlob('*.hl7', 'patient.hl7')).toBe(true);
    expect(matchGlob('*.hl7', 'patient.txt')).toBe(false);
  });

  it('matches ? single character wildcard', () => {
    expect(matchGlob('file?.txt', 'file1.txt')).toBe(true);
    expect(matchGlob('file?.txt', 'file12.txt')).toBe(false);
  });

  it('matches exact filename', () => {
    expect(matchGlob('data.csv', 'data.csv')).toBe(true);
    expect(matchGlob('data.csv', 'other.csv')).toBe(false);
  });

  it('is case sensitive, as a Mirth File Reader filter is, on every platform', () => {
    expect(matchGlob('*.HL7', 'patient.hl7')).toBe(false);
    expect(matchGlob('*.hl7', 'PATIENT.HL7')).toBe(false);
    expect(matchGlob('ADT_*', 'adt_a01.hl7')).toBe(false);
    expect(matchGlob('*.HL7', 'PATIENT.HL7')).toBe(true);
  });

  it('treats regex metacharacters as literals instead of throwing', () => {
    expect(() => matchGlob('report(1)*.hl7', 'report(1)_a.hl7')).not.toThrow();
    expect(matchGlob('report(1)*.hl7', 'report(1)_a.hl7')).toBe(true);
    expect(matchGlob('data[0]*.txt', 'data[0]_x.txt')).toBe(true);
    expect(matchGlob('data[0]*.txt', 'data0_x.txt')).toBe(false);
    expect(matchGlob('a+b*.dat', 'a+b_c.dat')).toBe(true);
  });

  it('matches all files with *', () => {
    expect(matchGlob('*', 'anything.txt')).toBe(true);
    expect(matchGlob('*', 'file')).toBe(true);
  });

  it('matches prefix pattern', () => {
    expect(matchGlob('ADT_*', 'ADT_A01.hl7')).toBe(true);
    expect(matchGlob('ADT_*', 'ORM_O01.hl7')).toBe(false);
  });
});

describe('FileReceiver', () => {
  describe('onDeploy', () => {
    it('validates directory is required', async () => {
      receiver = new FileReceiver(makeConfig({ directory: '' }));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates file filter is required', async () => {
      receiver = new FileReceiver(makeConfig({ fileFilter: '' }));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates polling interval minimum', async () => {
      receiver = new FileReceiver(makeConfig({ pollingIntervalMs: 50 }));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates moveToDirectory required when postAction is MOVE', async () => {
      receiver = new FileReceiver(makeConfig({
        postAction: FILE_POST_ACTION.MOVE,
        moveToDirectory: '',
      }));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('deploys with valid config', async () => {
      receiver = new FileReceiver(makeConfig());
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(true);
    });
  });

  // GHSA-r434-hwqg-cvcw: a File source on the server's own directory turned its .env into readable messages.
  describe('allowed roots', () => {
    it('refuses to deploy a directory outside FILE_CONNECTOR_ROOTS', async () => {
      receiver = new FileReceiver(makeConfig({ directory: '/app' }));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
      expect(result.error?.message).toMatch(/outside FILE_CONNECTOR_ROOTS/);
    });

    it('refuses to deploy a directory in a denied root inside an allowed one', async () => {
      receiver = new FileReceiver(makeConfig({ roots: { allowed: ['/data'], denied: ['/data/app'] }, directory: '/data/app' }));
      const result = await receiver.onDeploy();
      expect(result.error?.message).toMatch(/server's own/);
    });

    it('refuses to deploy /proc even when every directory is allowed', async () => {
      receiver = new FileReceiver(makeConfig({ roots: { allowed: ['/'], denied: [] }, directory: '/proc/self' }));
      const result = await receiver.onDeploy();
      expect(result.error?.message).toMatch(/server's own/);
    });

    it('refuses to deploy a move-to directory outside FILE_CONNECTOR_ROOTS', async () => {
      receiver = new FileReceiver(makeConfig({ postAction: FILE_POST_ACTION.MOVE, moveToDirectory: '/app/packages' }));
      const result = await receiver.onDeploy();
      expect(result.error?.message).toMatch(/outside FILE_CONNECTOR_ROOTS/);
    });

    it('reads nothing on a poll once the directory has become a link out of the roots', async () => {
      mockReaddir.mockResolvedValue([makeDirent('.env')] as never);
      mockStat.mockResolvedValue(makeStatResult(Date.now() - 5_000, 100) as never);
      receiver = new FileReceiver(makeConfig({ fileFilter: '*' }));
      expect((await receiver.onDeploy()).ok).toBe(true);
      mockRealpath.mockImplementation(((p: string) =>
        Promise.resolve(p === path.resolve('/data/inbound') ? path.resolve('/app') : p)) as never);
      const dispatched: RawMessage[] = [];
      receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(raw); return { messageId: 1 }; }));
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockReaddir).not.toHaveBeenCalled();
      expect(dispatched).toHaveLength(0);
    });

    it('leaves the file in place when the move-to directory has become a link out of the roots', async () => {
      mockReaddir.mockResolvedValue([makeDirent('file.hl7')] as never);
      mockStat.mockResolvedValue(makeStatResult(Date.now() - 5_000, 100) as never);
      mockReadFile.mockImplementation(((p: string) =>
        (String(p).endsWith('file.hl7') ? Promise.resolve('content') : Promise.reject(enoent()))) as never);
      mockRealpath.mockImplementation(((p: string) =>
        Promise.resolve(p === path.resolve('/data/processed') ? path.resolve('/app') : p)) as never);
      receiver = new FileReceiver(makeConfig({ postAction: FILE_POST_ACTION.MOVE, moveToDirectory: '/data/processed' }));
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockMkdir).not.toHaveBeenCalled();
      expect(mockLink).not.toHaveBeenCalled();
      expect(mockRename).not.toHaveBeenCalled();
    });
  });

  describe('onStart', () => {
    it('errors if dispatcher not set', async () => {
      receiver = new FileReceiver(makeConfig());
      const result = await receiver.onStart();
      expect(result.ok).toBe(false);
    });

    it('starts successfully with dispatcher set', async () => {
      receiver = new FileReceiver(makeConfig());
      receiver.setDispatcher(makeDispatcher());
      const result = await receiver.onStart();
      expect(result.ok).toBe(true);
    });
  });

  describe('poll cycle', () => {
    it('reads files matching the glob pattern', async () => {
      const captured: RawMessage[] = [];
      const now = Date.now();

      mockReaddir.mockResolvedValue([
        makeDirent('patient.hl7'),
        makeDirent('data.txt'),
        makeDirent('lab.hl7'),
      ] as never);

      mockStat.mockResolvedValue(makeStatResult(now - 5_000, 100) as never);
      mockReadFile.mockResolvedValue('MSH|^~\\&|SENDER');
      mockUnlink.mockResolvedValue(undefined);

      receiver = new FileReceiver(makeConfig());
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: captured.length };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(captured).toHaveLength(2);
      expect(captured[0]!.sourceMap['originalFilename']).toBe('lab.hl7');
      expect(captured[1]!.sourceMap['originalFilename']).toBe('patient.hl7');
    });

    it('skips directories in listing', async () => {
      const captured: RawMessage[] = [];
      const now = Date.now();

      mockReaddir.mockResolvedValue([
        makeDirent('subdir', false),
        makeDirent('file.hl7', true),
      ] as never);

      mockStat.mockResolvedValue(makeStatResult(now - 5_000, 100) as never);
      mockReadFile.mockResolvedValue('content');
      mockUnlink.mockResolvedValue(undefined);

      receiver = new FileReceiver(makeConfig());
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: 1 };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(captured).toHaveLength(1);
      expect(captured[0]!.sourceMap['originalFilename']).toBe('file.hl7');
    });

    it('filters files by age when checkFileAge is true', async () => {
      const captured: RawMessage[] = [];
      // The receiver polls at fake now + 5_000.
      const pollTime = Date.now() + 5_000;

      mockReaddir.mockResolvedValue([
        makeDirent('old.hl7'),
        makeDirent('new.hl7'),
      ] as never);

      // At poll time old.hl7 is 5s old (passes the 1s threshold), new.hl7 500ms (fails it).
      mockStat.mockImplementation((async (file: unknown) =>
        makeStatResult(pollTime - (String(file).endsWith('old.hl7') ? 5_000 : 500), 100)) as never);
      mockReadFile.mockResolvedValue('content');
      mockUnlink.mockResolvedValue(undefined);

      receiver = new FileReceiver(makeConfig({ fileAgeMs: 1_000 }));
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: 1 };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(captured).toHaveLength(1);
      expect(captured[0]!.sourceMap['originalFilename']).toBe('old.hl7');
    });

    it('does not check file age when disabled', async () => {
      const captured: RawMessage[] = [];
      const now = Date.now();

      mockReaddir.mockResolvedValue([
        makeDirent('recent.hl7'),
      ] as never);

      mockStat.mockResolvedValue(makeStatResult(now - 100, 50) as never);
      mockReadFile.mockResolvedValue('content');
      mockUnlink.mockResolvedValue(undefined);

      receiver = new FileReceiver(makeConfig({ checkFileAge: false }));
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: 1 };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(captured).toHaveLength(1);
    });
  });

  describe('sorting', () => {
    it('sorts by name (default)', async () => {
      const captured: RawMessage[] = [];
      const now = Date.now();

      mockReaddir.mockResolvedValue([
        makeDirent('charlie.hl7'),
        makeDirent('alpha.hl7'),
        makeDirent('bravo.hl7'),
      ] as never);

      mockStat.mockResolvedValue(makeStatResult(now - 5_000, 100) as never);
      mockReadFile.mockResolvedValue('content');
      mockUnlink.mockResolvedValue(undefined);

      receiver = new FileReceiver(makeConfig({ sortBy: FILE_SORT_BY.NAME }));
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: captured.length };
      }));
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      const names = captured.map((r) => r.sourceMap['originalFilename']);
      expect(names).toEqual(['alpha.hl7', 'bravo.hl7', 'charlie.hl7']);
    });

    it('sorts by date', async () => {
      const captured: RawMessage[] = [];
      const now = Date.now();

      mockReaddir.mockResolvedValue([
        makeDirent('newest.hl7'),
        makeDirent('oldest.hl7'),
        makeDirent('middle.hl7'),
      ] as never);

      let statIdx = 0;
      const times = [now - 1_000, now - 10_000, now - 5_000];
      mockStat.mockImplementation(async () => {
        const t = times[statIdx]!;
        statIdx++;
        return makeStatResult(t, 100) as never;
      });
      mockReadFile.mockResolvedValue('content');
      mockUnlink.mockResolvedValue(undefined);

      receiver = new FileReceiver(makeConfig({ sortBy: FILE_SORT_BY.DATE, checkFileAge: false }));
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: captured.length };
      }));
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      const names = captured.map((r) => r.sourceMap['originalFilename']);
      expect(names).toEqual(['oldest.hl7', 'middle.hl7', 'newest.hl7']);
    });

    it('sorts by size', async () => {
      const captured: RawMessage[] = [];
      const now = Date.now();

      mockReaddir.mockResolvedValue([
        makeDirent('large.hl7'),
        makeDirent('small.hl7'),
        makeDirent('medium.hl7'),
      ] as never);

      let statIdx = 0;
      const sizes = [1000, 100, 500];
      mockStat.mockImplementation(async () => {
        const s = sizes[statIdx]!;
        statIdx++;
        return makeStatResult(now - 5_000, s) as never;
      });
      mockReadFile.mockResolvedValue('content');
      mockUnlink.mockResolvedValue(undefined);

      receiver = new FileReceiver(makeConfig({ sortBy: FILE_SORT_BY.SIZE, checkFileAge: false }));
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: captured.length };
      }));
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      const names = captured.map((r) => r.sourceMap['originalFilename']);
      expect(names).toEqual(['small.hl7', 'medium.hl7', 'large.hl7']);
    });
  });

  describe('post-processing', () => {
    it('deletes file when postAction is DELETE', async () => {
      const now = Date.now();

      mockReaddir.mockResolvedValue([makeDirent('file.hl7')] as never);
      mockStat.mockResolvedValue(makeStatResult(now - 5_000, 100) as never);
      mockReadFile.mockResolvedValue('content');
      mockUnlink.mockResolvedValue(undefined);

      receiver = new FileReceiver(makeConfig({ postAction: FILE_POST_ACTION.DELETE }));
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('file.hl7'));
    });

    it('moves file when postAction is MOVE', async () => {
      const now = Date.now();

      mockReaddir.mockResolvedValue([makeDirent('file.hl7')] as never);
      mockStat.mockResolvedValue(makeStatResult(now - 5_000, 100) as never);
      mockReadFile.mockResolvedValue('content');
      mockMkdir.mockResolvedValue(undefined as never);
      mockLink.mockResolvedValue(undefined);
      mockUnlink.mockResolvedValue(undefined);

      receiver = new FileReceiver(makeConfig({
        postAction: FILE_POST_ACTION.MOVE,
        moveToDirectory: '/data/processed',
      }));
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockMkdir).toHaveBeenCalledWith(path.resolve('/data/processed'), { recursive: true });
      const source = path.join(path.resolve('/data/inbound'), 'file.hl7');
      expect(mockLink).toHaveBeenCalledWith(source, path.join(path.resolve('/data/processed'), 'file.hl7'));
      expect(mockUnlink).toHaveBeenCalledWith(source);
      expect(mockRename).not.toHaveBeenCalled();
    });

    it('leaves file when postAction is NONE', async () => {
      const now = Date.now();

      mockReaddir.mockResolvedValue([makeDirent('file.hl7')] as never);
      mockStat.mockResolvedValue(makeStatResult(now - 5_000, 100) as never);
      mockReadFile.mockResolvedValue('content');

      receiver = new FileReceiver(makeConfig({ postAction: FILE_POST_ACTION.NONE }));
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockUnlink).not.toHaveBeenCalled();
      expect(mockRename).not.toHaveBeenCalled();
    });

    it('does not post-process when dispatch fails', async () => {
      const now = Date.now();

      mockReaddir.mockResolvedValue([makeDirent('file.hl7')] as never);
      mockStat.mockResolvedValue(makeStatResult(now - 5_000, 100) as never);
      mockReadFile.mockResolvedValue('content');

      const failDispatcher = async (): Promise<Result<DispatchResult>> => ({
        ok: false as const,
        value: null,
        error: stderr({ name: 'Error', code: 'DISPATCH_FAILED', message: 'dispatch failed' }),
      });

      receiver = new FileReceiver(makeConfig({ postAction: FILE_POST_ACTION.DELETE }));
      receiver.setDispatcher(failDispatcher);
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockUnlink).not.toHaveBeenCalled();
    });
  });

  describe('sourceMap', () => {
    it('includes file metadata in sourceMap', async () => {
      let capturedRaw: RawMessage | null = null;
      const now = Date.now();

      mockReaddir.mockResolvedValue([makeDirent('patient.hl7')] as never);
      mockStat.mockResolvedValue(makeStatResult(now - 5_000, 256) as never);
      mockReadFile.mockResolvedValue('MSH|^~\\&|SENDER');
      mockUnlink.mockResolvedValue(undefined);

      receiver = new FileReceiver(makeConfig());
      receiver.setDispatcher(makeDispatcher((raw) => {
        capturedRaw = raw;
        return { messageId: 1 };
      }));
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(capturedRaw).not.toBeNull();
      expect(capturedRaw!.sourceMap['originalFilename']).toBe('patient.hl7');
      expect(capturedRaw!.sourceMap['directory']).toBe('/data/inbound');
      expect(capturedRaw!.sourceMap['fileSize']).toBe(256);
      expect(capturedRaw!.content).toBe('MSH|^~\\&|SENDER');
    });
  });

  describe('binary mode', () => {
    it('reads file as base64 when binary is true', async () => {
      let capturedRaw: RawMessage | null = null;
      const now = Date.now();
      const binaryBuffer = Buffer.from([0x00, 0x01, 0x02, 0xFF]);

      mockReaddir.mockResolvedValue([makeDirent('image.dcm')] as never);
      mockStat.mockResolvedValue(makeStatResult(now - 5_000, 4) as never);
      mockReadFile.mockImplementation((p: unknown) =>
        (String(p).endsWith('.json') ? Promise.reject(enoent()) : Promise.resolve(binaryBuffer)) as never,
      );
      mockUnlink.mockResolvedValue(undefined);

      receiver = new FileReceiver(makeConfig({
        fileFilter: '*.dcm',
        binary: true,
      }));
      receiver.setDispatcher(makeDispatcher((raw) => {
        capturedRaw = raw;
        return { messageId: 1 };
      }));
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(capturedRaw).not.toBeNull();
      expect(capturedRaw!.content).toBe(binaryBuffer.toString('base64'));
    });
  });

  describe('lifecycle', () => {
    it('stops and clears interval', async () => {
      receiver = new FileReceiver(makeConfig());
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      const stopResult = await receiver.onStop();
      expect(stopResult.ok).toBe(true);

      const undeployResult = await receiver.onUndeploy();
      expect(undeployResult.ok).toBe(true);

      receiver = null;
    });

    it('halt clears interval', async () => {
      receiver = new FileReceiver(makeConfig());
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      const haltResult = await receiver.onHalt();
      expect(haltResult.ok).toBe(true);

      receiver = null;
    });
  });

  describe('error handling', () => {
    it('continues polling after readdir error', async () => {
      const captured: RawMessage[] = [];
      const now = Date.now();

      let callCount = 0;
      mockReaddir.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Permission denied');
        return [makeDirent('file.hl7')] as never;
      });
      mockStat.mockResolvedValue(makeStatResult(now - 5_000, 100) as never);
      mockReadFile.mockResolvedValue('content');
      mockUnlink.mockResolvedValue(undefined);

      receiver = new FileReceiver(makeConfig());
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: 1 };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(captured).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(captured).toHaveLength(1);
    });
  });

  describe('failure visibility & post-action safety', () => {
    it('logs an error when the poll cycle throws (vanished directory)', async () => {
      const { logger, errors } = makeMockLogger();
      mockReaddir.mockRejectedValue(new Error('ENOENT: no such directory'));

      receiver = new FileReceiver(makeConfig(), logger);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(errors).toHaveLength(1);
      expect(errors[0]!.msg).toContain('poll cycle failed');
    });

    describe('reported to the engine (#417)', () => {
      const seen: Array<string | null> = [];

      async function start(): Promise<ReturnType<typeof makeMockLogger>> {
        const log = makeMockLogger();
        seen.length = 0;
        receiver = new FileReceiver(makeConfig(), log.logger);
        receiver.setDispatcher(makeDispatcher());
        receiver.setHealthHandler((failure) => { seen.push(failure?.message ?? null); });
        await receiver.onStart();
        return log;
      }

      const eacces = (): Error => Object.assign(new Error('EACCES: permission denied, stat'), { code: 'EACCES' });

      it('is a directory in which no file can be looked at, and the log says how many and which is the first', async () => {
        mockReaddir.mockResolvedValue([makeDirent('a.hl7'), makeDirent('b.hl7')] as never);
        mockStat.mockRejectedValue(eacces());
        const { errors } = await start();

        await vi.advanceTimersByTimeAsync(5_000);

        expect(seen).toEqual(['EACCES: permission denied, stat']);
        expect(errors[0]?.obj).toMatchObject({ files: 2, file: expect.stringContaining('a.hl7') as string });
      });

      it('is not one that cannot be looked at beside one that is too new', async () => {
        mockReaddir.mockResolvedValue([makeDirent('a.hl7'), makeDirent('b.hl7')] as never);
        mockStat.mockImplementation(async (p) => {
          if (String(p).endsWith('a.hl7')) throw eacces();
          return makeStatResult(Date.now(), 100) as never;
        });
        await start();

        await vi.advanceTimersByTimeAsync(5_000);

        expect(seen).toEqual([null]);
      });

      it('is not a long listing that goes on', async () => {
        mockReaddir.mockResolvedValue(['a.hl7', 'b.hl7', 'c.hl7'].map((name) => makeDirent(name)) as never);
        let looks = 0;
        mockStat.mockImplementation(async () => {
          looks += 1;
          // As the listing looks at each; not as the files are then taken.
          if (looks <= 3) await new Promise((resolve) => { setTimeout(resolve, 40_000); });
          return makeStatResult(0, 100) as never;
        });
        mockReadFile.mockResolvedValue('MSH|^~\\&|X');
        await start();

        await vi.advanceTimersByTimeAsync(5_000 + 3 * 40_000 - 1);

        expect(seen).toEqual([]);
        // The poll that is due then comes too.
        await vi.advanceTimersByTimeAsync(1);
        expect(new Set(seen)).toEqual(new Set([null]));
      });

      it('is not one file among others that cannot be looked at, and the log names it', async () => {
        mockReaddir.mockResolvedValue([makeDirent('a.hl7'), makeDirent('b.hl7')] as never);
        mockStat.mockImplementation(async (p) => {
          if (String(p).endsWith('a.hl7')) throw eacces();
          return makeStatResult(Date.now() - 5_000, 100) as never;
        });
        mockReadFile.mockResolvedValue('MSH|^~\\&|X');
        const { errors } = await start();

        await vi.advanceTimersByTimeAsync(5_000);

        expect(seen).toEqual([null]);
        expect(errors.filter((e) => String(e.obj['file']).endsWith('a.hl7'))).toHaveLength(1);
      });

      it('is a listing that hangs, as that of a mount that is gone does, and no second one is begun', async () => {
        let end: (entries: never) => void = () => undefined;
        mockReaddir.mockImplementation(() => new Promise((resolve) => { end = resolve; }));
        const { errors } = await start();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(seen).toEqual([]);
        await vi.advanceTimersByTimeAsync(15_000);

        expect(new Set(seen)).toEqual(new Set(['Listing the directory has not gone on for 60 s']));
        expect(errors).toHaveLength(1);
        expect(mockReaddir).toHaveBeenCalledTimes(1);
        end([] as never);
      });
    });

    it('quarantines a file whose post-action fails, preventing re-dispatch', async () => {
      const { logger, errors } = makeMockLogger();
      const now = Date.now();
      mockReaddir.mockResolvedValue([makeDirent('a.hl7', true)] as never);
      mockStat.mockResolvedValue(makeStatResult(now - 5_000, 100) as never);
      mockReadFile.mockResolvedValue('MSH|^~\\&|X');
      mockUnlink.mockRejectedValue(new Error('EPERM: unlink failed'));

      let dispatchCount = 0;
      receiver = new FileReceiver(makeConfig(), logger);
      receiver.setDispatcher(makeDispatcher(() => { dispatchCount++; return { messageId: dispatchCount }; }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(dispatchCount).toBe(1);
      expect(errors.some((e) => e.msg.includes('quarantining'))).toBe(true);
    });

    it('reports a quarantined file once, not on every poll', async () => {
      const { logger, errors } = makeMockLogger();
      mockReaddir.mockResolvedValue([makeDirent('a.hl7', true)] as never);
      mockStat.mockResolvedValue(makeStatResult(Date.now() - 5_000, 100) as never);
      mockReadFile.mockResolvedValue('MSH|^~\\&|X');
      mockUnlink.mockRejectedValue(new Error('EPERM: unlink failed'));
      receiver = new FileReceiver(makeConfig(), logger);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(20_000);

      expect(errors.filter((e) => e.msg.includes('skipping to avoid duplicate delivery'))).toHaveLength(1);
    });

    it('keeps going when one file cannot be read', async () => {
      const { logger, errors } = makeMockLogger();
      mockReaddir.mockResolvedValue([makeDirent('a.hl7'), makeDirent('b.hl7'), makeDirent('c.hl7')] as never);
      mockStat.mockResolvedValue(makeStatResult(Date.now() - 5_000, 100) as never);
      mockReadFile.mockImplementation((async (path: unknown) => {
        const name = String(path);
        if (name.endsWith('.json')) throw enoent();
        if (name.endsWith('b.hl7')) throw new Error('EACCES: permission denied');
        return name.endsWith('a.hl7') ? 'A' : 'C';
      }) as never);
      mockUnlink.mockResolvedValue(undefined as never);
      const seen: string[] = [];
      receiver = new FileReceiver(makeConfig(), logger);
      receiver.setDispatcher(makeDispatcher((raw) => { seen.push(raw.content); return { messageId: 1 }; }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(seen).toEqual(['A', 'C']);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('persists the quarantine to the sidecar ledger on quarantine', async () => {
      const { logger } = makeMockLogger();
      const now = Date.now();
      mockReaddir.mockResolvedValue([makeDirent('a.hl7', true)] as never);
      mockStat.mockResolvedValue(makeStatResult(now - 5_000, 100) as never);
      mockReadFile.mockResolvedValue('MSH|^~\\&|X');
      mockUnlink.mockRejectedValue(new Error('EPERM: unlink failed'));

      receiver = new FileReceiver(makeConfig(), logger);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      const writeCall = mockWriteFile.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).endsWith(QUARANTINE_LEDGER),
      );
      expect(writeCall).toBeDefined();
      expect(String(writeCall![1])).toContain('a.hl7:');
    });

    it('durable quarantine survives a restart: a new receiver loads the ledger and does not re-dispatch', async () => {
      const { logger } = makeMockLogger();
      const now = Date.now();
      const mtime = now - 5_000;
      const key = `a.hl7:${String(mtime)}`;

      mockReaddir.mockResolvedValue([makeDirent('a.hl7', true)] as never);
      mockStat.mockResolvedValue(makeStatResult(mtime, 100) as never);
      mockReadFile.mockImplementation((p: unknown) =>
        (typeof p === 'string' && p.endsWith(QUARANTINE_LEDGER)
          ? Promise.resolve(JSON.stringify([key]))
          : Promise.resolve('MSH|^~\\&|X')) as never,
      );

      let dispatchCount = 0;
      receiver = new FileReceiver(makeConfig(), logger);
      receiver.setDispatcher(makeDispatcher(() => { dispatchCount++; return { messageId: dispatchCount }; }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(dispatchCount).toBe(0);
    });

    it.each(LEGACY_LEDGERS)('honours the pre-rename ledger %s: a key quarantined there is not re-dispatched', async (legacy) => {
      const { logger } = makeMockLogger();
      const mtime = Date.now() - 5_000;
      mockReaddir.mockResolvedValue([makeDirent('a.hl7', true)] as never);
      mockStat.mockResolvedValue(makeStatResult(mtime, 100) as never);
      mockReadFile.mockImplementation((p: unknown) => {
        if (String(p).endsWith(legacy)) return Promise.resolve(JSON.stringify([`a.hl7:${String(mtime)}`])) as never;
        if (String(p).endsWith('.json')) return Promise.reject(enoent()) as never;
        return Promise.resolve('MSH|^~\\&|X') as never;
      });

      let dispatchCount = 0;
      receiver = new FileReceiver(makeConfig(), logger);
      receiver.setDispatcher(makeDispatcher(() => { dispatchCount++; return { messageId: dispatchCount }; }));
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(dispatchCount).toBe(0);
    });

    it('merges both legacy ledgers and the current one, and writes the union to the current ledger only', async () => {
      const { logger } = makeMockLogger();
      const mtime = Date.now() - 5_000;
      mockReaddir.mockResolvedValue(['a.hl7', 'b.hl7', 'c.hl7', 'd.hl7'].map((n) => makeDirent(n)) as never);
      mockStat.mockResolvedValue(makeStatResult(mtime, 100) as never);
      mockUnlink.mockRejectedValue(new Error('EPERM: unlink failed'));
      const ledgers: Readonly<Record<string, string>> = {
        '.mirthless-quarantine.json': 'a.hl7',
        '.galvaniflow-quarantine.json': 'b.hl7',
        [QUARANTINE_LEDGER]: 'c.hl7',
      };
      mockReadFile.mockImplementation((p: unknown) => {
        const ledger = Object.keys(ledgers).find((name) => String(p).endsWith(name));
        if (ledger !== undefined) return Promise.resolve(JSON.stringify([`${ledgers[ledger]!}:${String(mtime)}`])) as never;
        return Promise.resolve('MSH|^~\\&|X') as never;
      });

      const dispatched: string[] = [];
      receiver = new FileReceiver(makeConfig(), logger);
      receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(String(raw.sourceMap['originalFilename'])); return { messageId: 1 }; }));
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000); // d.hl7 dispatched, unlink fails → quarantined
      await vi.advanceTimersByTimeAsync(5_000);

      expect(dispatched).toEqual(['d.hl7']);
      const ledgerWrites = mockWriteFile.mock.calls.filter((c) => String(c[0]).endsWith(QUARANTINE_LEDGER));
      expect(ledgerWrites.length).toBeGreaterThan(0);
      const written = JSON.parse(String(ledgerWrites.at(-1)![1])) as string[];
      expect([...written].sort()).toEqual(['a.hl7', 'b.hl7', 'c.hl7', 'd.hl7'].map((n) => `${n}:${String(mtime)}`));
      expect(mockWriteFile.mock.calls.some((c) => isLegacyLedger(c[0]))).toBe(false);
    });

    it('logs an error when a ledger exists but cannot be read, and still starts', async () => {
      const { logger, errors } = makeMockLogger();
      mockReaddir.mockResolvedValue([] as never);
      mockReadFile.mockImplementation((p: unknown) =>
        (String(p).endsWith(QUARANTINE_LEDGER)
          ? Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))
          : Promise.reject(enoent())) as never,
      );

      receiver = new FileReceiver(makeConfig(), logger);
      receiver.setDispatcher(makeDispatcher());
      const started = await receiver.onStart();

      expect(started.ok).toBe(true);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.msg).toBe('Failed to read quarantine ledger; ignoring it (files may be re-dispatched)');
      expect(String(errors[0]!.obj['file'])).toContain(QUARANTINE_LEDGER);
      expect(errors[0]!.obj['errMsg']).toContain('EACCES');
    });

    it('stays silent when neither ledger exists', async () => {
      const { logger, errors } = makeMockLogger();
      mockReaddir.mockResolvedValue([] as never);

      receiver = new FileReceiver(makeConfig(), logger);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      expect(errors).toEqual([]);
    });

    it('logs a corrupt ledger and still dispatches the file', async () => {
      const { logger, errors } = makeMockLogger();
      mockReaddir.mockResolvedValue([makeDirent('a.hl7')] as never);
      mockStat.mockResolvedValue(makeStatResult(Date.now() - 5_000, 100) as never);
      mockUnlink.mockResolvedValue(undefined as never);
      mockReadFile.mockImplementation((p: unknown) => {
        if (String(p).endsWith(QUARANTINE_LEDGER)) return Promise.resolve('[not valid json') as never;
        if (isLegacyLedger(p)) return Promise.reject(enoent()) as never;
        return Promise.resolve('MSH|^~\\&|X') as never;
      });

      let dispatchCount = 0;
      receiver = new FileReceiver(makeConfig(), logger);
      receiver.setDispatcher(makeDispatcher(() => { dispatchCount++; return { messageId: 1 }; }));
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(dispatchCount).toBe(1);
      expect(errors.map((e) => e.msg)).toEqual(['Quarantine ledger is corrupt; ignoring it (files may be re-dispatched)']);
    });

    it('logs a ledger that cannot be written and still skips the file this session', async () => {
      const { logger, errors } = makeMockLogger();
      mockReaddir.mockResolvedValue([makeDirent('a.hl7')] as never);
      mockStat.mockResolvedValue(makeStatResult(Date.now() - 5_000, 100) as never);
      mockUnlink.mockRejectedValue(new Error('EPERM: unlink failed'));
      mockWriteFile.mockRejectedValue(new Error('ENOSPC: no space left on device'));
      mockReadFile.mockImplementation((p: unknown) =>
        (String(p).endsWith('.json') ? Promise.reject(enoent()) : Promise.resolve('MSH|^~\\&|X')) as never,
      );

      let dispatchCount = 0;
      receiver = new FileReceiver(makeConfig(), logger);
      receiver.setDispatcher(makeDispatcher(() => { dispatchCount++; return { messageId: 1 }; }));
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(dispatchCount).toBe(1);
      const persistErrors = errors.filter((e) => e.msg === 'Failed to persist quarantine ledger; quarantine will not survive a restart');
      expect(persistErrors).toHaveLength(1);
      expect(String(persistErrors[0]!.obj['file'])).toContain(QUARANTINE_LEDGER);
    });

    it('never dispatches a current or legacy ledger file even when the filter matches it', async () => {
      const { logger } = makeMockLogger();
      const mtime = Date.now() - 5_000;
      mockReaddir.mockResolvedValue([QUARANTINE_LEDGER, ...LEGACY_LEDGERS, 'a.hl7'].map((n) => makeDirent(n)) as never);
      mockStat.mockResolvedValue(makeStatResult(mtime, 100) as never);
      mockReadFile.mockImplementation((p: unknown) =>
        (String(p).endsWith('.json') ? Promise.resolve('[]') : Promise.resolve('MSH|^~\\&|X')) as never,
      );

      const dispatched: string[] = [];
      // ignoreDot off, so the ledger rule (not the dotfile rule) is what keeps it out.
      receiver = new FileReceiver(makeConfig({ fileFilter: '*', ignoreDot: false }), logger);
      receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(String(raw.sourceMap['originalFilename'])); return { messageId: 1 }; }));
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(dispatched).toEqual(['a.hl7']);
    });
  });
});

describe('FileReceiver leaves alone the files a Mirth File Reader leaves alone (#244)', () => {
  async function pollOnce(
    names: readonly string[],
    overrides?: Partial<FileReceiverConfig>,
  ): Promise<{ dispatched: string[]; deleted: string[] }> {
    mockReaddir.mockResolvedValue(names.map((n) => makeDirent(n)) as never);
    mockStat.mockResolvedValue(makeStatResult(Date.now() - 5_000, 100) as never);
    mockReadFile.mockImplementation((p: unknown) =>
      (String(p).endsWith('.json') ? Promise.reject(enoent()) : Promise.resolve('MSH|^~\\&|X')) as never,
    );
    mockUnlink.mockResolvedValue(undefined);
    const dispatched: string[] = [];
    receiver = new FileReceiver(makeConfig({ postAction: FILE_POST_ACTION.DELETE, ...overrides }));
    receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(String(raw.sourceMap['originalFilename'])); return { messageId: 1 }; }));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);
    return { dispatched, deleted: mockUnlink.mock.calls.map((c) => String(c[0])) };
  }

  it('neither reads nor deletes a dotfile by default, even when the filter matches it', async () => {
    const { dispatched, deleted } = await pollOnce(['.lock', '.a.hl7.swp', 'a.hl7'], { fileFilter: '*' });
    expect(dispatched).toEqual(['a.hl7']);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatch(/a\.hl7$/);
  });

  it('reads a dotfile when ignoreDot is off', async () => {
    const { dispatched } = await pollOnce(['.lock', 'a.hl7'], { fileFilter: '*', ignoreDot: false });
    expect(dispatched).toEqual(['.lock', 'a.hl7']);
  });

  it('neither reads nor deletes a file whose name differs from the filter only in case', async () => {
    const { dispatched, deleted } = await pollOnce(['A.HL7', 'b.hl7'], { fileFilter: '*.hl7' });
    expect(dispatched).toEqual(['b.hl7']);
    expect(deleted).toHaveLength(1);
  });

  it('never reads a file whose name ends in .ignore', async () => {
    const { dispatched } = await pollOnce(['notes.ignore', 'a.hl7'], { fileFilter: '*' });
    expect(dispatched).toEqual(['a.hl7']);
  });

  it('holds back a file while a <name>.ignore file sits next to it', async () => {
    const { dispatched, deleted } = await pollOnce(['a.hl7', 'a.hl7.ignore', 'b.hl7'], { fileFilter: '*' });
    expect(dispatched).toEqual(['b.hl7']);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatch(/b\.hl7$/);
  });
});

describe('FileReceiver when the pipeline recorded an error', () => {
  it('keeps the file and does not read it again', async () => {
    const now = Date.now();
    mockReaddir.mockResolvedValue([makeDirent('file.hl7')] as never);
    mockStat.mockResolvedValue(makeStatResult(now - 5_000, 100) as never);
    mockReadFile.mockResolvedValue('content');
    const dispatched: string[] = [];

    receiver = new FileReceiver(makeConfig({ postAction: FILE_POST_ACTION.DELETE }));
    receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(raw.content); return { messageId: 9, status: 'ERROR' }; }));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(mockUnlink).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
    expect(dispatched).toEqual(['content']);
  });

  it('still applies the post-action to a filtered message', async () => {
    const now = Date.now();
    mockReaddir.mockResolvedValue([makeDirent('file.hl7')] as never);
    mockStat.mockResolvedValue(makeStatResult(now - 5_000, 100) as never);
    mockReadFile.mockResolvedValue('content');
    mockUnlink.mockResolvedValue(undefined);

    receiver = new FileReceiver(makeConfig({ postAction: FILE_POST_ACTION.DELETE }));
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 9, status: 'FILTERED' })));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('file.hl7'));
  });
});

describe('FileReceiver faults', () => {
  it('refuses a character set it does not know instead of reading as UTF-8', async () => {
    receiver = new FileReceiver(makeConfig({ charset: 'windows-1252' as BufferEncoding }), makeMockLogger().logger);
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.message).toContain('windows-1252');
  });

  it('accepts the IANA names the editor offers', async () => {
    for (const charset of ['utf-8', 'ISO-8859-1', 'US-ASCII', 'utf-16le']) {
      const r = new FileReceiver(makeConfig({ charset: charset as BufferEncoding }), makeMockLogger().logger);
      expect((await r.onDeploy()).ok).toBe(true);
    }
  });

  function listFiles(...names: string[]): void {
    mockReaddir.mockResolvedValue(names.map((n) => makeDirent(n)) as never);
    mockStat.mockResolvedValue(makeStatResult(Date.now() - 60_000, 10) as never);
    mockUnlink.mockResolvedValue(undefined);
  }

  it('reads the later files when one file cannot be read, and reports the bad one', async () => {
    listFiles('a.hl7', 'b.hl7', 'c.hl7');
    mockReadFile.mockImplementation((async (file: unknown) => {
      if (String(file).endsWith('a.hl7')) throw new Error('EACCES: permission denied');
      if (String(file).endsWith('.json')) throw enoent();
      return `content of ${String(file)}`;
    }) as never);
    const log = makeMockLogger();
    const seen: unknown[] = [];

    receiver = new FileReceiver(makeConfig(), log.logger);
    receiver.setDispatcher(makeDispatcher((raw) => { seen.push(raw.sourceMap['originalFilename']); return { messageId: 1 }; }));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(seen).toEqual(['b.hl7', 'c.hl7']);
    expect(log.errors).toHaveLength(1);
    expect(String(log.errors[0]!.obj['file'])).toContain('a.hl7');
    expect(log.errors[0]!.msg).toContain('could not be read');
  });

  it('skips a file that vanishes between the listing and the stat', async () => {
    listFiles('gone.hl7', 'here.hl7');
    mockStat.mockImplementation((async (file: unknown) => {
      if (String(file).endsWith('gone.hl7')) throw enoent();
      return makeStatResult(Date.now() - 60_000, 10);
    }) as never);
    mockReadFile.mockImplementation((async (file: unknown) => {
      if (String(file).endsWith('.json')) throw enoent();
      return 'content';
    }) as never);
    const seen: unknown[] = [];

    receiver = new FileReceiver(makeConfig(), makeMockLogger().logger);
    receiver.setDispatcher(makeDispatcher((raw) => { seen.push(raw.sourceMap['originalFilename']); return { messageId: 1 }; }));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(seen).toEqual(['here.hl7']);
  });

  it('dispatches no further files once the channel is stopped mid-cycle', async () => {
    listFiles('a.hl7', 'b.hl7', 'c.hl7');
    mockReadFile.mockImplementation((async (file: unknown) => {
      if (String(file).endsWith('.json')) throw enoent();
      return 'content';
    }) as never);
    const seen: unknown[] = [];
    let stopping: Promise<unknown> | null = null;

    const r = new FileReceiver(makeConfig(), makeMockLogger().logger);
    receiver = r;
    r.setDispatcher(makeDispatcher((raw) => {
      seen.push(raw.sourceMap['originalFilename']);
      stopping ??= r.onStop();
      return { messageId: 1 };
    }));
    await r.onStart();
    await vi.advanceTimersByTimeAsync(5_000);
    await stopping;

    expect(seen).toEqual(['a.hl7']);
  });

  it('waits for the file in flight before stop resolves', async () => {
    listFiles('a.hl7');
    mockReadFile.mockImplementation((async (file: unknown) => {
      if (String(file).endsWith('.json')) throw enoent();
      return 'content';
    }) as never);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const r = new FileReceiver(makeConfig(), makeMockLogger().logger);
    receiver = r;
    r.setDispatcher(async () => { await gate; return { ok: true as const, value: { messageId: 1 }, error: null }; });
    await r.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    let stopped = false;
    const stop = r.onStop().then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(10);
    expect(stopped).toBe(false);

    release();
    await stop;
    expect(stopped).toBe(true);
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });
});
