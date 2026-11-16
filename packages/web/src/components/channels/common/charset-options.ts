// ===========================================
// Charset Options
// ===========================================
// The charset choices of the TCP/MLLP and FILE forms. Values must be the
// core-models CONNECTOR_CHARSETS, which the schemas accept at deploy
// (connector-defaults.test.ts checks they match).

/** Each charset with its name on screen. */
export const CHARSET_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'latin1', label: 'ISO-8859-1 (Latin-1)' },
  { value: 'ascii', label: 'US-ASCII' },
  { value: 'utf16le', label: 'UTF-16LE' },
];
