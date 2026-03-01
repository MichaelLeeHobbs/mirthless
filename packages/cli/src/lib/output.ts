// ===========================================
// CLI Output Formatters
// ===========================================
// Functions for formatting CLI output as tables, JSON, or messages.

/** Format data as a simple table with column headers. */
export function formatTable(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string {
  // Calculate column widths from header and data
  const widths = headers.map((h, i) => {
    const maxData = rows.reduce(
      (max, row) => Math.max(max, (row[i] ?? '').length),
      0,
    );
    return Math.max(h.length, maxData);
  });

  // Build header row
  const headerLine = headers
    .map((h, i) => h.padEnd(widths[i]!))
    .join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');

  // Build data rows
  const dataLines = rows.map((row) =>
    row.map((cell, i) => (cell ?? '').padEnd(widths[i]!)).join('  '),
  );

  return [headerLine, separator, ...dataLines].join('\n');
}

/** Format data as pretty-printed JSON. */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** Print an error message to stderr. */
export function printError(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
}

/** Print a success message to stdout. */
export function printSuccess(message: string): void {
  process.stdout.write(`${message}\n`);
}
