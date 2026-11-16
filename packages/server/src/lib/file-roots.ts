// ===========================================
// File Connector Roots (server side)
// ===========================================
// The directories File connectors may use come from FILE_CONNECTOR_ROOTS. The
// server's own directories are always refused, even inside a root: the install
// holds its code and `.env` (JWT_SECRET, CONTENT_ENCRYPTION_KEY, DATABASE_URL),
// and the working directory is where dotenv also looks (D-314).

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileRoots } from '@galvanigraph/connectors';

/**
 * The root the server runs from: the repository in development, `/app` in the
 * image. This file sits at `packages/server/{src,dist}/lib/`, four levels down.
 */
export const INSTALL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** File connector roots: the operator's allowed directories, minus the server's own. */
export function buildFileRoots(allowed: readonly string[]): FileRoots {
  return { allowed, denied: [INSTALL_ROOT, process.cwd()] };
}
