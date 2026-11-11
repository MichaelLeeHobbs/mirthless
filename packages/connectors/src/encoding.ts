// ===========================================
// Charset Normalization
// ===========================================
// Maps human/IANA charset names to valid Node Buffer encodings so a config value
// like 'ISO-8859-1' or 'US-ASCII' (which fs.readFile/writeFile reject with
// ERR_UNKNOWN_ENCODING) is coerced to the Node equivalent instead of crashing the
// poll/write. The file connectors refuse an unknown value at deploy (see
// isKnownEncoding): decoding with the wrong charset corrupts text in silence.

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

/**
 * Whether a configured charset is one this server can read and write. Empty
 * means the UTF-8 default. Connectors check this at deploy so a charset Node
 * cannot handle (for example windows-1252) stops the channel with a clear
 * error instead of being read as UTF-8.
 */
export function isKnownEncoding(charset: string | undefined | null): boolean {
  if (typeof charset !== 'string' || charset.length === 0) return true;
  return Object.hasOwn(ALIASES, charset.toLowerCase());
}

/** Error text for a charset that failed {@link isKnownEncoding}. */
export function unknownEncodingMessage(charset: string): string {
  return `Unknown character set "${charset}". Supported: utf-8, iso-8859-1 (latin1), us-ascii, utf-16le.`;
}
