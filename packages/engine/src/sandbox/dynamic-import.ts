// Node refuses a script's `import()` with an error of the host realm, whatever callback it is
// given, so a script must not be able to run one at all.

/** What the sandbox's String.raw puts back. */
export const ESCAPED_IMPORT = 'i\\u006dport';

/**
 * The same script with the `m` of every `import` escaped. In a string, template, regular expression,
 * comment, property name or longer identifier the two mean the same; as the keyword, the escaped
 * spelling is a syntax error, so no parsing is needed to tell which is which. The escape does show in
 * the text itself: `regex.source`, a function's own text, and the raw strings of a script's own tag.
 */
export function withoutDynamicImport(code: string): string {
  return code.replaceAll('import', ESCAPED_IMPORT);
}
