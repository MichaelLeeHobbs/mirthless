// ===========================================
// Scenario suite: a local drop folder
// ===========================================
// File Reader scenarios poll a folder under the system temp folder, emptied
// before each use. The server runs on this machine, so it reads the same path.
// It is outside the repository because File connectors may not use the
// server's install (D-314), and the suite's server lists it in FILE_CONNECTOR_ROOTS.

import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The File root the scenario server is given. */
export const SCENARIO_FILE_ROOT = join(tmpdir(), 'galvanigraph-scenarios', 'files');

const ROOT = SCENARIO_FILE_ROOT;

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
