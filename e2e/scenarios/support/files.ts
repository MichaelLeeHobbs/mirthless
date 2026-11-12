// ===========================================
// Scenario suite: a local drop folder
// ===========================================
// File Reader scenarios poll a folder under tmp/feature-climb/files, emptied
// before each use. The server runs on this machine, so it reads the same path.

import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve('tmp/feature-climb/files');

/** Create an empty folder for one scenario and return its absolute path. */
export function dropFolder(name: string): string {
  const dir = join(ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'done'), { recursive: true });
  return dir;
}

export function drop(dir: string, file: string, content: string): void {
  writeFileSync(join(dir, file), content);
}

export function exists(dir: string, file: string): boolean {
  return existsSync(join(dir, file));
}

export function list(dir: string): string[] {
  return readdirSync(dir);
}
