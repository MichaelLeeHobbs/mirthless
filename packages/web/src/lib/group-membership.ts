/** Ignores order; both lists must be free of repeats. */
export function isSameGroupSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** The UI gives a channel one group (D-126), but the API can put it in more. */
export function multiGroupNote(groupNames: readonly string[]): string | undefined {
  if (groupNames.length < 2) return undefined;
  return `In ${String(groupNames.length)} groups: ${groupNames.join(', ')}. Saving keeps only the group you choose.`;
}
