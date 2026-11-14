// ===========================================
// Certificate Expiry
// ===========================================
// How long a certificate has left, and the chip colour and label for it, as
// shown on the Certificates page and in the connector certificate picker.

const DAY_MS = 1000 * 60 * 60 * 24;

/** Whole days until `notAfter`, negative once it has passed. */
export function expiryDays(notAfter: string, now: number = Date.now()): number {
  return Math.floor((new Date(notAfter).getTime() - now) / DAY_MS);
}

/** Chip colour: error under 30 days (and once expired), warning under 90. */
export function expiryColor(days: number): 'error' | 'warning' | 'success' {
  if (days < 30) return 'error';
  if (days < 90) return 'warning';
  return 'success';
}

/** "12d remaining" or "Expired 3d ago". */
export function expiryLabel(days: number): string {
  if (days < 0) return `Expired ${String(-days)}d ago`;
  return `${String(days)}d remaining`;
}
