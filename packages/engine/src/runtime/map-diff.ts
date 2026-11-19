// Only the keys a script changed in a shared map are written back: writing the
// whole map would overwrite keys another message changed while the script ran.

export interface MapChanges {
  readonly set: ReadonlyArray<readonly [string, unknown]>;
  readonly removed: ReadonlyArray<string>;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function diffMap(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): MapChanges {
  const set: Array<readonly [string, unknown]> = [];
  const removed: string[] = [];
  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    if (!(key in before) || !sameValue(before[key], value)) set.push([key, value]);
  }
  for (const key of Object.keys(before)) {
    if (after[key] === undefined) removed.push(key);
  }
  return { set, removed };
}
