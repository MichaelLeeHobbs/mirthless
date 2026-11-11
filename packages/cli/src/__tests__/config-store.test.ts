import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveConfig } from '../lib/config-store.js';

const posix = process.platform !== 'win32';

describe('saveConfig', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'gf-cli-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('writes the config as JSON', () => {
    const dir = join(home, '.galvaniflow');
    saveConfig(dir, { url: 'http://x', token: 't' });

    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8'))).toEqual({ url: 'http://x', token: 't' });
  });

  it.runIf(posix)('lets only the owner read the saved token', () => {
    const dir = join(home, '.galvaniflow');
    saveConfig(dir, { token: 't' });

    expect(statSync(join(dir, 'config.json')).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it.runIf(posix)('tightens a config file an older version left world-readable', () => {
    const dir = join(home, '.galvaniflow');
    mkdirSync(dir, { mode: 0o755 });
    writeFileSync(join(dir, 'config.json'), '{}', { mode: 0o644 });

    saveConfig(dir, { token: 't' });

    expect(statSync(join(dir, 'config.json')).mode & 0o777).toBe(0o600);
  });
});
