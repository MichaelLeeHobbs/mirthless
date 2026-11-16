// ===========================================
// Channel group membership helpers
// ===========================================

/**
 * True when two lists of group IDs name the same groups, in any order. Screens
 * that change a channel's groups use it to skip a save that changes nothing.
 *
 * @param a - One list of group IDs, without repeats.
 * @param b - The other list of group IDs, without repeats.
 * @returns Whether both lists hold exactly the same IDs.
 */
export function isSameGroupSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}
