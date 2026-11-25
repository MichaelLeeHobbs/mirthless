// An image's path holds UIDs, and a UID leads to one patient's study. Log lines, and ERROR texts,
// which reach the log and alerts, name the image by a hash instead (#321, D-379).

import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { resolveWithinRoots, type FileRoots } from '../file/file-roots.js';

/** Whoever may list the directory finds the file by it. */
export function fileHash(filePath: string): string {
  return createHash('sha256').update(path.basename(filePath)).digest('hex').slice(0, 12);
}

/** A failed file operation's message and stack quote its paths; its call and code say what failed. */
export function withoutPath(err: unknown): Error {
  const error: Error & { readonly code?: unknown; readonly syscall?: unknown } = err instanceof Error ? err : new Error(String(err));
  // Node quotes a path it refuses without giving it as a property.
  if (!('path' in error) && error.code !== 'ERR_INVALID_ARG_VALUE') return error;
  const call = typeof error.syscall === 'string' ? error.syscall : 'file operation';
  return Object.assign(new Error(`${call} failed: ${String(error.code)}`), { code: error.code });
}

/** {@link resolveWithinRoots} for an image. */
export async function resolveImage(filePath: string, roots: FileRoots): Promise<string> {
  const hash = fileHash(filePath);
  try {
    return await resolveWithinRoots(filePath, roots, `The path of DICOM file ${hash}`);
  } catch (err) {
    const error = withoutPath(err);
    throw error === err ? err : new Error(`DICOM file ${hash} cannot be used: ${error.message}`);
  }
}
