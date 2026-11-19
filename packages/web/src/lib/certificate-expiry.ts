const DAY_MS = 1000 * 60 * 60 * 24;

export function expiryDays(notAfter: string, now: number = Date.now()): number {
  return Math.floor((new Date(notAfter).getTime() - now) / DAY_MS);
}

export function expiryColor(days: number): 'error' | 'warning' | 'success' {
  if (days < 30) return 'error';
  if (days < 90) return 'warning';
  return 'success';
}

export function expiryLabel(days: number): string {
  if (days < 0) return `Expired ${String(-days)}d ago`;
  return `${String(days)}d remaining`;
}
