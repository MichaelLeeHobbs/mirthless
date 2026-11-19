// Outside the repository because File connectors may not use the server's install (D-315). The
// suite's server lists it in FILE_CONNECTOR_ROOTS and runs on this machine, so it reads the same path.

import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SCENARIO_FILE_ROOT = join(tmpdir(), 'galvanigraph-scenarios', 'files');

const ROOT = SCENARIO_FILE_ROOT;

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
