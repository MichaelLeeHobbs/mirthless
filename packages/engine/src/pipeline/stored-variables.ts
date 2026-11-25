import { isPlainObject } from '@galvanigraph/core-util';

/** The variables stored for a destination (`CONTENT_TYPE.CHANNEL_MAP`). Undefined when none were. */
export function parseStoredVariables(stored: string | null): Readonly<Record<string, unknown>> | undefined | 'INVALID' {
  if (stored === null) return undefined;
  try {
    const value: unknown = JSON.parse(stored);
    return isPlainObject(value) ? value : 'INVALID';
  } catch {
    return 'INVALID';
  }
}
