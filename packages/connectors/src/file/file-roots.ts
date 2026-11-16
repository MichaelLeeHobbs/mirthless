// ===========================================
// File Connector Roots
// ===========================================
// Where the File source and File destination may read and write. A channel
// author picks the directory, so without a limit a deployer could read the
// server's .env through a File source or overwrite its code through a File
// destination (GHSA-r434-hwqg-cvcw, D-315). The operator lists the allowed
// directories in FILE_CONNECTOR_ROOTS; the server adds its own directories to
// the denied list. Paths are compared after symlinks are resolved.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** The directories a File connector may use, and the ones it may never use. */
export interface FileRoots {
  /** Directories a File connector may use, with everything under them. */
  readonly allowed: readonly string[];
  /** Directories refused even inside an allowed root: the server's install and configuration. */
  readonly denied: readonly string[];
}

/** No allowed roots: every File connector path is refused. */
export const NO_FILE_ROOTS: FileRoots = { allowed: [], denied: [] };

/** Kernel and device trees, refused whatever the roots say. `/proc/self/environ` holds the server's secrets. */
const SYSTEM_DENIED: readonly string[] = ['/proc', '/sys', '/dev'];

function isMissing(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}

/**
 * The real path of `target`, following every symlink. A path that does not
 * exist yet (a folder a File destination will create) resolves its nearest
 * existing ancestor and keeps the missing names after it.
 */
async function realPathOf(target: string): Promise<string> {
  let existing = path.resolve(target);
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(await fs.realpath(existing), ...missing);
    } catch (err) {
      const parent = path.dirname(existing);
      if (!isMissing(err) || parent === existing) throw err;
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

/** True when `child` is `parent` or somewhere under it. */
function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Resolve a File connector path and return its real path, or throw when the
 * connector may not use it: a relative path, a path in a denied directory, or
 * one outside every allowed root. Call it at deploy and again before each
 * read, move or write, so a directory swapped for a symlink later is caught.
 */
export async function resolveWithinRoots(target: string, roots: FileRoots): Promise<string> {
  if (!path.isAbsolute(target)) {
    throw new Error(`File connector path "${target}" must be absolute`);
  }
  const real = await realPathOf(target);
  const denied = await Promise.all([...SYSTEM_DENIED, ...roots.denied].map(realPathOf));
  if (denied.some((dir) => isWithin(real, dir))) {
    throw new Error(`File connector path "${target}" is in one of the server's own directories, which File connectors may not use`);
  }
  if (roots.allowed.length === 0) {
    throw new Error('File connectors are turned off: FILE_CONNECTOR_ROOTS is not set. List the directories File connectors may use in it.');
  }
  const allowed = await Promise.all(roots.allowed.map(realPathOf));
  if (!allowed.some((dir) => isWithin(real, dir))) {
    throw new Error(`File connector path "${target}" is outside FILE_CONNECTOR_ROOTS`);
  }
  return real;
}
