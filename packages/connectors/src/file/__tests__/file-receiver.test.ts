// ===========================================
// File Receiver Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawMessage, DispatchResult } from '../../base.js';
import type { Result } from '@mirthless/core-util';
import { FileReceiver, matchGlob, FILE_SORT_BY, FILE_POST_ACTION, type FileReceiverConfig } from '../file-receiver.js';

// ----- Mock node:fs/promises -----

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
}));

import * as fs from 'node:fs/promises';

const mockReaddir = vi.mocked(fs.readdir);
const mockReadFile = vi.mocked(fs.readFile);
const mockStat = vi.mocked(fs.stat);
const mockUnlink = vi.mocked(fs.unlink);
const mockRename = vi.mocked(fs.rename);
const mockMkdir = vi.mocked(fs.mkdir);

// ----- Helpers -----

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

// ----- Lifecycle -----

let receiver: FileReceiver | null = null;

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

// ----- matchGlob Tests -----

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

  it('is case insensitive', () => {
    expect(matchGlob('*.HL7', 'patient.hl7')).toBe(true);
    expect(matchGlob('*.hl7', 'PATIENT.HL7')).toBe(true);
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

// ----- FileReceiver Tests -----

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

      // Trigger poll interval
      await vi.advanceTimersByTimeAsync(5_000);

      // Should have dispatched 2 files (*.hl7 matches patient.hl7 and lab.hl7)
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
      // After advanceTimersByTimeAsync(5_000), Date.now() in the receiver
      // will be the current fake time + 5_000. We need the "new" file's
      // mtime to be within 1_000ms of that future time.
      const pollTime = Date.now() + 5_000;

      mockReaddir.mockResolvedValue([
        makeDirent('old.hl7'),
        makeDirent('new.hl7'),
      ] as never);

      // old.hl7 is 5s before poll time (passes 1s threshold)
      // new.hl7 is 500ms before poll time (fails 1s threshold)
      let callIdx = 0;
      mockStat.mockImplementation(async () => {
        callIdx++;
        if (callIdx === 1) return makeStatResult(pollTime - 5_000, 100) as never;
        return makeStatResult(pollTime - 500, 100) as never;
      });
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
      mockRename.mockResolvedValue(undefined);

      receiver = new FileReceiver(makeConfig({
        postAction: FILE_POST_ACTION.MOVE,
        moveToDirectory: '/data/processed',
      }));
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockMkdir).toHaveBeenCalledWith('/data/processed', { recursive: true });
      expect(mockRename).toHaveBeenCalledWith(
        expect.stringContaining('file.hl7'),
        expect.stringContaining('file.hl7'),
      );
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
        error: { name: 'Error', code: 'DISPATCH_FAILED', message: 'dispatch failed' },
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
      mockReadFile.mockResolvedValue(binaryBuffer as never);
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

      // First poll: error, second poll: success
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

      // First poll fails
      await vi.advanceTimersByTimeAsync(5_000);
      expect(captured).toHaveLength(0);

      // Second poll succeeds
      await vi.advanceTimersByTimeAsync(5_000);
      expect(captured).toHaveLength(1);
    });
  });
});
