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

/**
 * The note a single-group picker shows for a channel in several groups (the UI
 * gives a channel one group, D-126, but the API can put it in more).
 *
 * @param groupNames - The names of every group the channel is in.
 * @returns The note, or undefined for a channel in one group or none.
 */
export function multiGroupNote(groupNames: readonly string[]): string | undefined {
  if (groupNames.length < 2) return undefined;
  return `In ${String(groupNames.length)} groups: ${groupNames.join(', ')}. Saving keeps only the group you choose.`;
}
