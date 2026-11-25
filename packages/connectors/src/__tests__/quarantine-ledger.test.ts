import { describe, it, expect } from 'vitest';
import { stderr, type Result } from '@galvanigraph/core-util';
import type { DispatchResult, RawMessage } from '../base.js';
import { QuarantineLedger, dispatchQuarantined, type FileVersion, type LedgerStorage, type QuarantinedFile } from '../quarantine-ledger.js';
import { makeMockLogger, type MockLogger } from '../__fixtures__/mock-logger.js';

const LEDGER = '/in/.galvanigraph-quarantine.json';
const LEGACY = '/in/.mirthless-quarantine.json';

/** A path mapped to an Error fails its read. */
class MemoryStorage implements LedgerStorage {
  readonly files = new Map<string, string | Error>();
  writeError: Error | null = null;

  async read(path: string): Promise<string | null> {
    const value = this.files.get(path);
    if (value instanceof Error) throw value;
    return value ?? null;
  }

  async write(path: string, text: string): Promise<void> {
    if (this.writeError) throw this.writeError;
    this.files.set(path, text);
  }
}

function setup(): { storage: MemoryStorage; log: MockLogger; ledger: QuarantineLedger } {
  const storage = new MemoryStorage();
  const log = makeMockLogger();
  return { storage, log, ledger: new QuarantineLedger(storage, LEDGER, log.logger) };
}

describe('QuarantineLedger.load', () => {
  it('adds nothing and logs nothing when no ledger exists', async () => {
    const { log, ledger } = setup();
    await ledger.load([LEDGER, LEGACY]);
    expect(ledger.has('a.hl7:1')).toBe(false);
    expect(log.errors).toEqual([]);
  });

  it('loads the string keys of a JSON array, trimming whitespace', async () => {
    const { storage, log, ledger } = setup();
    storage.files.set(LEDGER, '  ["a.hl7:1", 7, "b.hl7:2"]\n');
    await ledger.load([LEDGER]);
    expect(ledger.has('a.hl7:1')).toBe(true);
    expect(ledger.has('b.hl7:2')).toBe(true);
    expect(ledger.has('7')).toBe(false);
    expect(log.errors).toEqual([]);
  });

  it('ignores text that is not a JSON array without logging it', async () => {
    const { storage, log, ledger } = setup();
    storage.files.set(LEDGER, '{"a.hl7:1": true}');
    storage.files.set(LEGACY, '');
    await ledger.load([LEDGER, LEGACY]);
    expect(ledger.has('a.hl7:1')).toBe(false);
    expect(log.errors).toEqual([]);
  });

  it('logs a corrupt ledger with its path and keeps loading the next one', async () => {
    const { storage, log, ledger } = setup();
    storage.files.set(LEDGER, '[not valid json');
    storage.files.set(LEGACY, '["a.hl7:1"]');
    await ledger.load([LEDGER, LEGACY]);
    expect(ledger.has('a.hl7:1')).toBe(true);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]!.msg).toBe('Quarantine ledger is corrupt; ignoring it (files may be re-dispatched)');
    expect(log.errors[0]!.obj['file']).toBe(LEDGER);
  });

  it('logs a ledger that exists but cannot be read, and keeps loading the next one', async () => {
    const { storage, log, ledger } = setup();
    storage.files.set(LEDGER, new Error('EACCES: permission denied'));
    storage.files.set(LEGACY, '["a.hl7:1"]');
    await ledger.load([LEDGER, LEGACY]);
    expect(ledger.has('a.hl7:1')).toBe(true);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]!.msg).toBe('Failed to read quarantine ledger; ignoring it (files may be re-dispatched)');
    expect(log.errors[0]!.obj['file']).toBe(LEDGER);
    expect(log.errors[0]!.obj['errMsg']).toContain('EACCES');
  });

  it('merges a legacy ledger so the next write carries both into the current ledger only', async () => {
    const { storage, ledger } = setup();
    storage.files.set(LEDGER, '["b.hl7:2"]');
    storage.files.set(LEGACY, '["a.hl7:1"]');
    await ledger.load([LEDGER, LEGACY]);
    await ledger.add('c.hl7:3');
    expect(JSON.parse(String(storage.files.get(LEDGER)))).toEqual(['b.hl7:2', 'a.hl7:1', 'c.hl7:3']);
    expect(storage.files.get(LEGACY)).toBe('["a.hl7:1"]');
  });
});

describe('QuarantineLedger.add', () => {
  it('quarantines the key and persists the whole set', async () => {
    const { storage, ledger } = setup();
    await ledger.add('a.hl7:1');
    await ledger.add('b.hl7:2');
    expect(ledger.has('a.hl7:1')).toBe(true);
    expect(storage.files.get(LEDGER)).toBe('["a.hl7:1","b.hl7:2"]');
  });

  it('logs a failed write and still quarantines the key in memory', async () => {
    const { storage, log, ledger } = setup();
    storage.writeError = new Error('disk full');
    await ledger.add('a.hl7:1');
    expect(ledger.has('a.hl7:1')).toBe(true);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]!.msg).toBe('Failed to persist quarantine ledger; quarantine will not survive a restart');
    expect(log.errors[0]!.obj['file']).toBe(LEDGER);
  });
});

describe('QuarantineLedger.reportOnce', () => {
  it('is true the first time for each key and false after', () => {
    const { ledger } = setup();
    expect(ledger.reportOnce('a.hl7:1')).toBe(true);
    expect(ledger.reportOnce('a.hl7:1')).toBe(false);
    expect(ledger.reportOnce('b.hl7:2')).toBe(true);
  });
});

const RAW: RawMessage = { content: 'MSH|^~\\&|X', sourceMap: {} };

function ok(value: DispatchResult): Result<DispatchResult> {
  return { ok: true, value, error: null };
}

const KEY = 'a.hl7:1';
const LISTED: FileVersion = { modifyTime: 1, size: 5 };

/** Answers each version in turn, and the last one from then on. */
function versions(...answers: readonly FileVersion[]): () => Promise<FileVersion> {
  let i = 0;
  return async () => answers[Math.min(i++, answers.length - 1)]!;
}

interface Run {
  readonly job: QuarantinedFile;
  readonly log: MockLogger;
  readonly storage: MemoryStorage;
  readonly calls: string[];
}

function makeJob(overrides: Partial<QuarantinedFile> = {}): Run {
  const { storage, log, ledger } = setup();
  const calls: string[] = [];
  const job: QuarantinedFile = {
    ledger,
    logger: log.logger,
    name: 'a.hl7',
    listed: LISTED,
    file: '/in/a.hl7',
    minAgeMs: 1_000,
    version: versions(LISTED),
    read: async () => { calls.push('read'); return RAW; },
    dispatcher: async () => { calls.push('dispatch'); return ok({ messageId: 1 }); },
    postProcess: async () => { calls.push('post'); },
    ...overrides,
  };
  return { job, log, storage, calls };
}

describe('dispatchQuarantined', () => {
  it('reads, dispatches and post-processes a file that is not quarantined', async () => {
    const { job, log, calls } = makeJob();
    await dispatchQuarantined(job);
    expect(calls).toEqual(['read', 'dispatch', 'post']);
    expect(log.errors).toEqual([]);
  });

  it('skips a quarantined file without reading it and reports it once', async () => {
    const { job, log, calls } = makeJob();
    await job.ledger.add(KEY);
    await dispatchQuarantined(job);
    await dispatchQuarantined(job);
    expect(calls).toEqual([]);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]!.obj).toEqual({ file: '/in/a.hl7' });
    expect(log.errors[0]!.msg).toContain('skipping to avoid duplicate delivery');
  });

  it('does nothing more when the read returns null', async () => {
    const { job, calls } = makeJob({ read: async () => null });
    await dispatchQuarantined(job);
    expect(calls).toEqual([]);
    expect(job.ledger.has(KEY)).toBe(false);
  });

  it('leaves the file for the next poll when the pipeline did not take it', async () => {
    const { job, calls, log } = makeJob({
      dispatcher: async () => ({ ok: false, value: null, error: stderr('queue full') }),
    });
    await dispatchQuarantined(job);
    expect(calls).toEqual(['read']);
    expect(job.ledger.has(KEY)).toBe(false);
    expect(log.errors).toEqual([]);
  });

  it('quarantines and persists, without post-processing, a file the pipeline recorded an error for', async () => {
    const { job, calls, log, storage } = makeJob({
      dispatcher: async () => ok({ messageId: 9, status: 'ERROR' }),
    });
    await dispatchQuarantined(job);
    expect(calls).toEqual(['read']);
    expect(job.ledger.has(KEY)).toBe(true);
    expect(storage.files.get(LEDGER)).toBe('["a.hl7:1"]');
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]!.obj['file']).toBe('/in/a.hl7');
    expect(log.errors[0]!.msg).toBe('Pipeline recorded an error for this file; file kept in place and quarantined so it is not read again');
  });

  it('quarantines and persists a file whose post-action fails', async () => {
    const { job, log, storage } = makeJob({ postProcess: async () => { throw new Error('EPERM'); } });
    await dispatchQuarantined(job);
    expect(job.ledger.has(KEY)).toBe(true);
    expect(storage.files.get(LEDGER)).toBe('["a.hl7:1"]');
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]!.obj['errMsg']).toBe('EPERM');
    expect(log.errors[0]!.obj['file']).toBe('/in/a.hl7');
    expect(log.errors[0]!.msg).toBe('Post-action failed after successful dispatch; quarantining file');
  });

  it('quarantines a file that cannot be looked at again after dispatch, without deleting or moving it', async () => {
    let looks = 0;
    const { job, calls, log, storage } = makeJob({
      version: async () => {
        if (++looks === 3) throw new Error('No SFTP connection available');
        return LISTED;
      },
    });
    await dispatchQuarantined(job);
    expect(calls).toEqual(['read', 'dispatch']);
    expect(storage.files.get(LEDGER)).toBe('["a.hl7:1"]');
    expect(log.errors[0]!.msg).toBe('Post-action failed after successful dispatch; quarantining file');
  });

  it('does not read a file that is gone', async () => {
    const { job, calls } = makeJob({ version: async () => { throw new Error('ENOENT'); } });
    await expect(dispatchQuarantined(job)).rejects.toThrow('ENOENT');
    expect(calls).toEqual([]);
  });

  it('does not read a file that changed since the listing and is now too new', async () => {
    const { job, calls } = makeJob({ version: versions({ modifyTime: Date.now(), size: 9 }) });
    await dispatchQuarantined(job);
    expect(calls).toEqual([]);
  });

  it.each([1_000, null])('reads a file that changed since the listing and is not too new (minimum age %s)', async (minAgeMs) => {
    const now = { modifyTime: minAgeMs === null ? Date.now() : 2, size: 9 };
    const read: FileVersion[] = [];
    const { job, calls } = makeJob({
      minAgeMs, version: versions(now), read: async (version) => { read.push(version); return RAW; },
    });
    await dispatchQuarantined(job);
    expect(read).toEqual([now]);
    expect(calls).toEqual(['dispatch', 'post']);
  });

  it('does not read a file quarantined as it is now, whatever the listing said', async () => {
    const { job, calls } = makeJob({ version: versions({ modifyTime: 2, size: 5 }) });
    await job.ledger.add('a.hl7:2');
    await dispatchQuarantined(job);
    expect(calls).toEqual([]);
  });

  it('quarantines the version it read, not the one listed', async () => {
    const { job, storage } = makeJob({
      version: versions({ modifyTime: 2, size: 5 }), dispatcher: async () => ok({ messageId: 9, status: 'ERROR' }),
    });
    await dispatchQuarantined(job);
    expect(storage.files.get(LEDGER)).toBe('["a.hl7:2"]');
  });

  it.each([['grew', { modifyTime: 1, size: 6 }], ['has a new time', { modifyTime: 2, size: 5 }]])('does not dispatch a file that %s while it was read', async (_label, after) => {
    const { job, calls, log } = makeJob({ version: versions(LISTED, after) });
    await dispatchQuarantined(job);
    expect(calls).toEqual(['read']);
    expect(log.warnings[0]!.obj).toEqual({ file: '/in/a.hl7' });
  });

  it.each([['grew', { modifyTime: 1, size: 6 }], ['has a new time', { modifyTime: 2, size: 5 }]])('neither deletes nor quarantines a file that %s while it was processed', async (_label, after) => {
    const { job, calls, log, storage } = makeJob({ version: versions(LISTED, LISTED, after) });
    await dispatchQuarantined(job);
    expect(calls).toEqual(['read', 'dispatch']);
    expect(storage.files.size).toBe(0);
    expect(log.warnings).toHaveLength(1);
  });

  it('takes two versions with no time as the same', async () => {
    const untimed = { modifyTime: NaN, size: 5 };
    const { job, calls } = makeJob({ listed: untimed, version: versions({ ...untimed }) });
    await dispatchQuarantined(job);
    expect(calls).toEqual(['read', 'dispatch', 'post']);
  });

  it('leaves a file with no post-action alone', async () => {
    const { job, calls } = makeJob({ postProcess: null, version: versions(LISTED, LISTED, { modifyTime: 2, size: 5 }) });
    await dispatchQuarantined(job);
    expect(calls).toEqual(['read', 'dispatch']);
  });

  it('lets a read failure propagate without quarantining', async () => {
    const { job } = makeJob({ read: async () => { throw new Error('SFTP get failed'); } });
    await expect(dispatchQuarantined(job)).rejects.toThrow('SFTP get failed');
    expect(job.ledger.has(KEY)).toBe(false);
  });
});
