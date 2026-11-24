/** An `<input type="datetime-local">` value: local time, no zone, to the second. '' for no time or one it cannot read. */
export function toDateTimeLocal(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

/**
 * null when blank, undefined when unreadable. A value that still shows `saved`
 * is `saved` itself: the input has no milliseconds, and when the clocks go back
 * one local time is two instants.
 */
export function fromDateTimeLocal(value: string, saved: string | null = null): string | null | undefined {
  if (saved !== null && value === toDateTimeLocal(saved)) return saved;
  if (value.trim() === '') return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/**
 * As {@link fromDateTimeLocal}, but a value it cannot read goes as typed, for the
 * server to refuse. Left out, a year of five digits would widen a search or make
 * access permanent.
 */
export function sentDateTimeLocal(value: string, saved: string | null = null): string | null {
  const iso = fromDateTimeLocal(value, saved);
  return iso === undefined ? value : iso;
}
