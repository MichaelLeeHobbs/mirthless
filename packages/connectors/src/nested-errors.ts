/** The messages of the errors inside `err` (`errors` and `cause`, at any depth), without its own. At most 10. */
export function nestedErrorMessages(err: Error): readonly string[] {
  const reasons: string[] = [];
  const pending: unknown[] = [err];
  while (pending.length > 0 && reasons.length < 10) {
    const next = pending.shift();
    if (!(next instanceof Error)) continue;
    if (next !== err && next.message) reasons.push(next.message);
    const nested = (next as { errors?: unknown }).errors;
    if (Array.isArray(nested)) pending.push(...(nested as unknown[]));
    if (next.cause !== undefined) pending.push(next.cause);
  }
  return [...new Set(reasons)].filter((r) => r !== err.message);
}
