// ===========================================
// Database Query Builder
// ===========================================
// Converts template strings with ${variable} placeholders
// into parameterized SQL with positional $1, $2, ... params.
// CRITICAL: No string interpolation of values into SQL.

// ----- Types -----

export interface PreparedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

// ----- Placeholder regex -----

/** Matches `${variableName}` placeholders in a query template. */
const PLACEHOLDER_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

// ----- Public API -----

/**
 * Prepare a parameterized query from a template string.
 * Replaces `${variable}` with positional `$N` parameters.
 *
 * @example
 * prepare("INSERT INTO t (a, b) VALUES (${name}, ${age})", { name: "John", age: 30 })
 * // => { sql: "INSERT INTO t (a, b) VALUES ($1, $2)", params: ["John", 30] }
 */
export function prepare(
  template: string,
  context: Readonly<Record<string, unknown>>,
): PreparedQuery {
  const params: unknown[] = [];
  const seen = new Map<string, number>();

  const sql = template.replace(PLACEHOLDER_RE, (_match, varName: string) => {
    const existingIndex = seen.get(varName);
    if (existingIndex !== undefined) {
      return `$${String(existingIndex)}`;
    }

    params.push(context[varName]);
    const paramIndex = params.length;
    seen.set(varName, paramIndex);
    return `$${String(paramIndex)}`;
  });

  return { sql, params };
}
