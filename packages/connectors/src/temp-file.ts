import { randomUUID } from 'node:crypto';

/**
 * A destination's temporary file, in the folder of the file it becomes. The dot and the
 * extension keep it from most partners' patterns; its own name per write keeps two
 * messages for one file name apart.
 */
export function tempFileName(): string {
  return `.galvanigraph-${randomUUID()}.tmp`;
}

/** No source reads one, whatever its filter and ignoreDot say. */
export function isTempFileName(name: string): boolean {
  return /^\.galvanigraph-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/.test(name);
}
