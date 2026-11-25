import type { QueueCharset } from '@galvanigraph/core-models';
import { decodeWindows1252 } from '@galvanigraph/core-util';

// fs.readFile/writeFile reject IANA names like 'ISO-8859-1' or 'US-ASCII' with ERR_UNKNOWN_ENCODING.
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

/** Falls back to 'utf8' for empty or unrecognized values. */
export function normalizeEncoding(charset: string | undefined | null): BufferEncoding {
  if (typeof charset !== 'string' || charset.length === 0) return 'utf8';
  return ALIASES[charset.toLowerCase()] ?? 'utf8';
}

/**
 * Empty means the UTF-8 default. Connectors check this at deploy: decoding with the
 * wrong charset (for example windows-1252 read as UTF-8) corrupts text in silence.
 */
export function isKnownEncoding(charset: string | undefined | null): boolean {
  if (typeof charset !== 'string' || charset.length === 0) return true;
  return Object.hasOwn(ALIASES, charset.toLowerCase());
}

export interface DecodedPayload {
  readonly text: string;
  /** True when the bytes were not valid UTF-8 and invalid ones became U+FFFD. */
  readonly replaced: boolean;
}

/** What a queue source puts in the source map (`charsetError`) for a payload that was not valid UTF-8. */
export const INVALID_UTF8_MESSAGE = 'Payload is not valid UTF-8; invalid bytes were replaced with U+FFFD. Set the source charset to match the sender.';

/** `fatal` makes invalid UTF-8 throw instead of being replaced in silence; `ignoreBOM` keeps a BOM as Buffer.toString does. */
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function decodePayload(bytes: Buffer, charset: QueueCharset): DecodedPayload {
  switch (charset) {
    case 'utf-8':
      try {
        return { text: STRICT_UTF8.decode(bytes), replaced: false };
      } catch {
        return { text: bytes.toString('utf8'), replaced: true };
      }
    case 'latin1':
    case 'base64':
      return { text: bytes.toString(charset), replaced: false };
    case 'windows-1252':
      return { text: decodeWindows1252(bytes), replaced: false };
    default: {
      const unreachable: never = charset;
      throw new Error(`Unknown charset ${String(unreachable)}`);
    }
  }
}

export interface CharsetDecoder {
  /** As the Encoding Standard names it. */
  readonly encoding: string;
  /** Throws on bytes that are not valid in the charset. */
  readonly decode: (bytes: Uint8Array) => string;
}

/** Null for a charset this Node does not know. `keepBom` keeps a byte order mark as a character. */
export function strictDecoder(charset: string, keepBom: boolean): CharsetDecoder | null {
  try {
    const decoder = new TextDecoder(charset, { fatal: true, ignoreBOM: keepBom });
    const { encoding } = decoder;
    return { encoding, decode: encoding === 'windows-1252' ? decodeWindows1252 : (bytes): string => decoder.decode(bytes) };
  } catch {
    return null;
  }
}

export function declaredCharset(contentType: string | null | undefined): string | undefined {
  return /;\s*charset\s*=\s*"?([^",;\s]+)"?/i.exec(contentType ?? '')?.[1];
}

export interface AnswerHeaders {
  readonly contentType: string | null;
  /** Of a body that was not decompressed. */
  readonly contentEncoding?: string | undefined;
}

interface DecodedAnswer {
  readonly text: string;
  /** Why the text may not be what was sent; null when it is. */
  readonly problem: string | null;
}

function bomCharset(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : undefined;
}

/**
 * The body of an HTTP answer, in the charset of its byte order mark, which is left out, else the
 * one its Content-Type declares, else UTF-8. Never refused: the request was handled by then.
 */
export function decodeAnswer(bytes: Uint8Array, headers: AnswerHeaders): DecodedAnswer {
  const decoded = decodeText(bytes, headers.contentType);
  const coding = headers.contentEncoding?.trim().toLowerCase() ?? 'identity';
  if (bytes.length === 0 || coding === 'identity') return decoded;
  return { ...decoded, problem: `it is compressed (${coding}) and was not decompressed` };
}

function decodeText(bytes: Uint8Array, contentType: string | null): DecodedAnswer {
  if (bytes.length === 0) return { text: '', problem: null };
  const declared = strictDecoder(bomCharset(bytes) ?? declaredCharset(contentType) ?? 'utf-8', false);
  const { encoding, decode } = declared ?? strictDecoder('utf-8', false)!;
  const unknown = declared === null ? 'its charset is not known, so it was read as utf-8' : null;
  try {
    return { text: decode(bytes), problem: unknown };
  } catch {
    const problem = unknown === null ? `it is not valid ${encoding}` : `${unknown}, which it is not`;
    return { text: new TextDecoder(encoding).decode(bytes), problem };
  }
}

/** Node writes another character in place of one the charset does not have, without an error. */
export function encodeText(text: string, charset: BufferEncoding): Buffer {
  const bytes = Buffer.from(text, charset);
  const written = bytes.toString(charset);
  if (written === text) return bytes;
  let at = 0;
  while (written[at] === text[at]) at += 1;
  const character = `U+${text.codePointAt(at)!.toString(16).toUpperCase().padStart(4, '0')}`;
  throw new Error(`The text holds the character ${character}, which the charset ${charset} does not have`);
}

export function unknownEncodingMessage(charset: string): string {
  return `Unknown character set "${charset}". Supported: utf-8, iso-8859-1 (latin1), us-ascii, utf-16le.`;
}
