import type { BulkDeleteResult } from '../hooks/use-message-actions.js';

export const DELETE_WARNING = 'A message that still waits on a queue is not sent. This cannot be undone.';

const MAX_NAMED = 5;

/** What to tell the user, and as what, when some of the messages may have been refused. */
export function deleteNotice({ deletedCount, refusedIds }: BulkDeleteResult): readonly [text: string, severity: 'success' | 'warning'] {
  const deleted = `Deleted ${String(deletedCount)} message(s)`;
  if (refusedIds.length === 0) return [deleted, 'success'];
  const named = refusedIds.slice(0, MAX_NAMED).map((id) => `#${String(id)}`).join(', ');
  const more = refusedIds.length > MAX_NAMED ? ` and ${String(refusedIds.length - MAX_NAMED)} more` : '';
  return [`${deleted}. Still being processed or sent, so not deleted: ${named}${more}`, 'warning'];
}
