// GHSA-r434-hwqg-cvcw

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveWithinRoots, NO_FILE_ROOTS, type FileRoots } from '../file-roots.js';

let base: string;
let allowed: string;
let outside: string;
let install: string;

beforeAll(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gg-file-roots-')));
  allowed = path.join(base, 'allowed');
  outside = path.join(base, 'outside');
  install = path.join(allowed, 'install');
  await fs.mkdir(path.join(allowed, 'inbound'), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.mkdir(install, { recursive: true });
  await fs.writeFile(path.join(outside, 'secret.env'), 'JWT_SECRET=x');
  // A directory link inside the allowed root that points outside it. 'junction'
  // needs no privilege on Windows and is ignored elsewhere.
  await fs.symlink(outside, path.join(allowed, 'escape'), 'junction');
});

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

function roots(overrides?: Partial<FileRoots>): FileRoots {
  return { allowed: [allowed], denied: [install], ...overrides };
}

describe('resolveWithinRoots', () => {
  it('returns the real path of a directory under an allowed root', async () => {
    expect(await resolveWithinRoots(path.join(allowed, 'inbound'), roots())).toBe(path.join(allowed, 'inbound'));
  });

  it('accepts the allowed root itself', async () => {
    expect(await resolveWithinRoots(allowed, roots())).toBe(allowed);
  });

  it('accepts a path that does not exist yet under an allowed root', async () => {
    const target = path.join(allowed, 'not', 'made', 'yet');
    expect(await resolveWithinRoots(target, roots())).toBe(target);
  });

  it('refuses a directory outside every allowed root', async () => {
    await expect(resolveWithinRoots(outside, roots())).rejects.toThrow(/outside FILE_CONNECTOR_ROOTS/);
  });

  it('refuses a path that climbs out of the root with ..', async () => {
    await expect(resolveWithinRoots(path.join(allowed, 'inbound', '..', '..', 'outside'), roots()))
      .rejects.toThrow(/outside FILE_CONNECTOR_ROOTS/);
  });

  it('refuses a link inside the root that points outside it', async () => {
    await expect(resolveWithinRoots(path.join(allowed, 'escape'), roots())).rejects.toThrow(/outside FILE_CONNECTOR_ROOTS/);
    await expect(resolveWithinRoots(path.join(allowed, 'escape', 'secret.env'), roots())).rejects.toThrow(/outside FILE_CONNECTOR_ROOTS/);
  });

  it('refuses a denied directory even inside an allowed root', async () => {
    await expect(resolveWithinRoots(install, roots())).rejects.toThrow(/server's own/);
    await expect(resolveWithinRoots(path.join(install, '.env'), roots())).rejects.toThrow(/server's own/);
  });

  it('refuses /proc, /sys and /dev whatever the roots say', async () => {
    const everything = roots({ allowed: [path.parse(base).root], denied: [] });
    await expect(resolveWithinRoots(path.resolve('/proc/self/environ'), everything)).rejects.toThrow(/server's own/);
    await expect(resolveWithinRoots(path.resolve('/sys/kernel'), everything)).rejects.toThrow(/server's own/);
    await expect(resolveWithinRoots(path.resolve('/dev/stdin'), everything)).rejects.toThrow(/server's own/);
  });

  it('refuses every path when no roots are configured', async () => {
    await expect(resolveWithinRoots(path.join(allowed, 'inbound'), NO_FILE_ROOTS)).rejects.toThrow(/FILE_CONNECTOR_ROOTS is not set/);
  });

  it('does not treat a sibling whose name starts with the root as inside it', async () => {
    const sibling = `${allowed}-sibling`;
    await expect(resolveWithinRoots(sibling, roots())).rejects.toThrow(/outside FILE_CONNECTOR_ROOTS/);
  });

  it('refuses a relative path', async () => {
    await expect(resolveWithinRoots('inbound', roots())).rejects.toThrow('File connector path "inbound" must be absolute');
  });
});
