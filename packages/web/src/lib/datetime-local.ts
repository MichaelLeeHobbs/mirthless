/**
 * An `<input type="datetime-local">` value: local time, no zone, with its
 * seconds, so saving a time nobody changed does not move it. '' for no time or
 * one it cannot read.
 */
export function toDateTimeLocal(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

/** null when blank, undefined when unreadable. */
export function fromDateTimeLocal(value: string): string | null | undefined {
  if (value.trim() === '') return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}
