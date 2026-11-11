// ===========================================
// Map Diff
// ===========================================
// Works out which keys a script changed in a shared map, so only those keys
// are written back. Writing the whole map back would overwrite keys another
// message changed while the script was running.

/** The keys a script set or removed. */
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

/** Compare the map a script was given with the map it left behind. */
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
