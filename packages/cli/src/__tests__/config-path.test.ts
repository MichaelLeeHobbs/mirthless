// ===========================================
// CLI Config Location Tests
// ===========================================

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configDir, configFileToRead } from '../lib/config-path.js';

describe('CLI config location', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'galvaniflow-cli-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('writes config to ~/.galvaniflow', () => {
    expect(configDir(home)).toBe(join(home, '.galvaniflow'));
  });

  it('reads ~/.galvaniflow when neither directory exists', () => {
    expect(configFileToRead(home)).toBe(join(home, '.galvaniflow', 'config.json'));
  });

  it('falls back to ~/.mirthless when only the old directory exists', () => {
    mkdirSync(join(home, '.mirthless'));
    expect(configFileToRead(home)).toBe(join(home, '.mirthless', 'config.json'));
  });

  it('prefers ~/.galvaniflow when both directories exist', () => {
    mkdirSync(join(home, '.mirthless'));
    mkdirSync(join(home, '.galvaniflow'));
    expect(configFileToRead(home)).toBe(join(home, '.galvaniflow', 'config.json'));
  });
});
