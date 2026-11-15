// ===========================================
// Quarantine Ledger Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { QuarantineLedger, type LedgerStorage } from '../quarantine-ledger.js';
import { makeMockLogger, type MockLogger } from '../__fixtures__/mock-logger.js';

const LEDGER = '/in/.galvaniflow-quarantine.json';
const LEGACY = '/in/.mirthless-quarantine.json';

/** In-memory ledger storage; a path mapped to an Error fails that operation. */
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
