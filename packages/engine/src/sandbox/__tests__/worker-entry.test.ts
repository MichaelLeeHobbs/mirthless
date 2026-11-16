// Workers run user code (test runs) or need nothing from the server (type
// checks), so they must not inherit its environment: the database URL and the
// JWT secret live there.

import { describe, it, expect, afterEach } from 'vitest';
import { workerEntry } from '../worker-entry.js';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('workerEntry', () => {
  it('starts the built worker with no environment at all', () => {
    process.env['DATABASE_URL'] = 'postgresql://user:secret@db/galvaniflow';
    const entry = workerEntry('file:///app/dist/sandbox/script-test-isolated.js', 'script-test-worker');
    expect(entry.url.href).toBe('file:///app/dist/sandbox/script-test-worker.js');
    expect(entry.execArgv).toEqual([]);
    expect(entry.env).toEqual({});
  });

  it('starts a worker from source through tsx, with only the temp folder variables tsx needs', () => {
    process.env['DATABASE_URL'] = 'postgresql://user:secret@db/galvaniflow';
    process.env['JWT_SECRET'] = 'secret';
    process.env['TMP'] = 'C:\\temp';
    delete process.env['TMPDIR'];
    const entry = workerEntry('file:///repo/src/sandbox/script-type-checker.ts', 'script-type-worker');
    expect(entry.url.href).toBe('file:///repo/src/sandbox/script-type-worker.ts');
    expect(entry.execArgv).toEqual(['--import', 'tsx']);
    expect(entry.env['TMP']).toBe('C:\\temp');
    expect(entry.env).not.toHaveProperty('TMPDIR');
    expect(entry.env).not.toHaveProperty('DATABASE_URL');
    expect(entry.env).not.toHaveProperty('JWT_SECRET');
  });
});
