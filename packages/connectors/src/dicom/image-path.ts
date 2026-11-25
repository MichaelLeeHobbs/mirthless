// An image's path holds UIDs, and a UID leads to one patient's study. Log lines, and ERROR texts,
// which reach the log and alerts, name the image by a hash instead (#321, D-386).

import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { isWithin, resolveWithinRoots, type FileRoots } from '../file/file-roots.js';

/** Whoever may list the directory finds the file by it. */
export function fileHash(filePath: string): string {
  return createHash('sha256').update(path.basename(filePath)).digest('hex').slice(0, 12);
}

/**
 * A failed file operation's message and stack quote its paths. What is left is its call, its code and
 * its path if that is one of these configured directories, or one they are in.
 */
export function withoutPath(err: unknown, configured: readonly string[]): Error {
  const error: Error & { readonly code?: unknown; readonly syscall?: unknown; readonly path?: unknown } = err instanceof Error ? err : new Error(String(err));
  // Node quotes a path it refuses without giving it as a property.
  if (error.path === undefined && error.code !== 'ERR_INVALID_ARG_VALUE') return error;
  const call = typeof error.syscall === 'string' ? error.syscall : 'file operation';
  const target = typeof error.path === 'string' ? path.resolve(error.path) : undefined;
  const shown = target !== undefined && configured.some((dir) => dir !== '' && isWithin(path.resolve(dir), target)) ? ` ${target}` : '';
  return new Error(`${call} failed: ${String(error.code)}${shown}`);
}

/** {@link resolveWithinRoots} for an image. */
export async function resolveImage(filePath: string, roots: FileRoots): Promise<string> {
  const hash = fileHash(filePath);
  try {
    return await resolveWithinRoots(filePath, roots, `The path of DICOM file ${hash}`);
  } catch (err) {
    const error = withoutPath(err, [...roots.allowed, ...roots.denied]);
    throw error === err ? err : new Error(`DICOM file ${hash} could not be checked against FILE_CONNECTOR_ROOTS: ${error.message}`);
  }
}
