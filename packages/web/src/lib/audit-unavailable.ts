// ===========================================
// Audit Unavailable
// ===========================================
// The server refuses a PHI read, an export or a backup with 503
// AUDIT_UNAVAILABLE when the audit log cannot record it (D-312). There is no
// way around that refusal; the page says so and points at the runbook.

import { useNotificationStore } from '../stores/notification.store.js';

export const AUDIT_UNAVAILABLE = 'AUDIT_UNAVAILABLE';

/** What the user is told. No retry button and no bypass: an administrator has to fix the database. */
export const AUDIT_UNAVAILABLE_NOTICE =
  'The audit log could not record this request, so it was refused and nothing was shown or downloaded. '
  + 'Ask an administrator to check the database (runbook: docs/ops/audit-log.md).';

/** Show the notice when an API error is AUDIT_UNAVAILABLE. */
export function noticeAuditUnavailable(code: string | undefined): void {
  if (code === AUDIT_UNAVAILABLE) useNotificationStore.getState().notify(AUDIT_UNAVAILABLE_NOTICE, 'error');
}

/**
 * Why a file download failed: the server's own message when it sent the
 * usual error body, else the status. Shows the AUDIT_UNAVAILABLE notice too.
 */
export async function downloadFailure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  noticeAuditUnavailable(body?.error?.code);
  return body?.error?.message ?? `Export failed with status ${String(response.status)}`;
}
