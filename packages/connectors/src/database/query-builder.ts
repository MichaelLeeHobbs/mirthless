// Values are never interpolated into SQL; they are always passed as parameters.

import { fillPlaceholders } from '@galvanigraph/core-util';

export interface PreparedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * `numbered`: `$1, $2, ...`, a name used twice reuses its number (PostgreSQL).
 * `question`: `?` per use, so a name used twice is passed twice (MySQL).
 */
export type PlaceholderStyle = 'numbered' | 'question';

const PLAIN_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Names are D-275's: what stands between the braces, trimmed, and only the context's own keys.
 * One the context lacks is bound as NULL when it is a plain name; any other is left as written,
 * so the database refuses the statement.
 */
export function prepare(
  template: string,
  context: Readonly<Record<string, unknown>>,
  style: PlaceholderStyle = 'numbered',
): PreparedQuery {
  const params: unknown[] = [];
  const numbers = new Map<string, number>();

  const sql = fillPlaceholders(template, (name) => {
    const known = Object.hasOwn(context, name);
    if (!known && !PLAIN_NAME.test(name)) return undefined;
    const number = style === 'numbered' ? numbers.get(name) : undefined;
    if (number !== undefined) return `$${String(number)}`;
    params.push(known ? context[name] : undefined);
    numbers.set(name, params.length);
    return style === 'numbered' ? `$${String(params.length)}` : '?';
  });

  return { sql, params };
}
