// ===========================================
// Charset Normalization
// ===========================================
// Maps human/IANA charset names to valid Node Buffer encodings so a config value
// like 'ISO-8859-1' or 'US-ASCII' (which fs.readFile/writeFile reject with
// ERR_UNKNOWN_ENCODING) is coerced to the Node equivalent instead of crashing the
// poll/write. Unknown values fall back to utf-8.

const ALIASES: Readonly<Record<string, BufferEncoding>> = {
  'utf8': 'utf8',
  'utf-8': 'utf8',
  'iso-8859-1': 'latin1',
  'iso8859-1': 'latin1',
  'latin1': 'latin1',
  'latin-1': 'latin1',
  'us-ascii': 'ascii',
  'ascii': 'ascii',
  'utf16le': 'utf16le',
  'utf-16le': 'utf16le',
  'ucs2': 'utf16le',
  'ucs-2': 'utf16le',
  'base64': 'base64',
  'hex': 'hex',
  'binary': 'binary',
};

/**
 * Coerce a configured charset string to a valid Node Buffer encoding.
 * Falls back to 'utf8' for empty or unrecognized values.
 */
export function normalizeEncoding(charset: string | undefined | null): BufferEncoding {
  if (typeof charset !== 'string' || charset.length === 0) return 'utf8';
  return ALIASES[charset.toLowerCase()] ?? 'utf8';
}
