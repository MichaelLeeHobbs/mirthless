interface TimestampOptions {
  readonly empty?: string;
  readonly dateOnly?: boolean;
}

/** The rule for every time on screen (D-278): missing shows `empty`, not the 1970 epoch; unparseable shows as it came, not "Invalid Date". */
export function formatTimestampWith(
  value: string | null | undefined,
  render: (date: Date) => string,
  empty = '—',
): string {
  if (value === null || value === undefined || value === '') return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return render(date);
}

export function formatTimestamp(value: string | null | undefined, options: TimestampOptions = {}): string {
  const render = options.dateOnly === true
    ? (date: Date): string => date.toLocaleDateString()
    : (date: Date): string => date.toLocaleString();
  return formatTimestampWith(value, render, options.empty);
}

export function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}

export function humanize(value: string): string {
  const words = value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
