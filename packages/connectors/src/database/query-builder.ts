// Values are never interpolated into SQL; they are always passed as parameters.

export interface PreparedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * `numbered`: `$1, $2, ...`, a name used twice reuses its number (PostgreSQL).
 * `question`: `?` per use, so a name used twice is passed twice (MySQL).
 */
export type PlaceholderStyle = 'numbered' | 'question';

const PLACEHOLDER_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function prepare(
  template: string,
  context: Readonly<Record<string, unknown>>,
  style: PlaceholderStyle = 'numbered',
): PreparedQuery {
  const params: unknown[] = [];
  const seen = new Map<string, number>();

  const sql = template.replace(PLACEHOLDER_RE, (_match, varName: string) => {
    if (style === 'question') {
      params.push(context[varName]);
      return '?';
    }
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
