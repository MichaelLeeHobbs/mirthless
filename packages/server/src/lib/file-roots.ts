// The server's own directories are refused even inside an allowed root (D-315):
// the install holds `.env` with its secrets, and dotenv also reads the working
// directory.

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileRoots } from '@galvanigraph/connectors';

/** This file is four levels down, at `packages/server/{src,dist}/lib/`; `/app` in the image. */
export const INSTALL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export function buildFileRoots(allowed: readonly string[]): FileRoots {
  return { allowed, denied: [INSTALL_ROOT, process.cwd()] };
}
