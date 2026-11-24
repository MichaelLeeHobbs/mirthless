/** `{ a: { a: ... 'leaf' } }`, built and compared without recursion, which a matcher's walk of the value would overflow on. */
export function nestedTables(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let i = 0; i < depth; i += 1) value = { a: value };
  return value;
}

export function nestedTablesJson(depth: number): string {
  return `${'{"a":'.repeat(depth)}"leaf"${'}'.repeat(depth)}`;
}
