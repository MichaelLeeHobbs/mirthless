// ===========================================
// HL7v2 Encoding
// ===========================================
// Detects delimiter characters from MSH segment
// and handles escape/unescape of special characters.

/** HL7v2 encoding characters detected from a message header. */
export interface Hl7Encoding {
  readonly fieldSep: string;
  readonly componentSep: string;
  readonly repetitionSep: string;
  readonly escapeChar: string;
  /**
   * The subcomponent separator, or the field separator when MSH-2 declares none
   * (three characters, as some legacy senders send). A field never contains the
   * field separator, so nothing is then split at subcomponent level.
   */
  readonly subComponentSep: string;
  readonly segmentSep: string;
}

/**
 * Detect encoding characters from an MSH segment line.
 *
 * MSH-2 holds 4 distinct characters (component, repetition, escape,
 * subcomponent), or 5 from v2.7, which adds the truncation character. Some
 * legacy senders send 3, with no subcomponent separator; that is read as Mirth
 * reads it, with no subcomponent splitting. Anything else is refused: reading
 * delimiters from a malformed header would split every field in the wrong place
 * without an error.
 */
export function detectEncoding(mshSegment: string): Hl7Encoding {
  const fieldSep = /^MSH([^\r\n])/.exec(mshSegment)?.[1];
  if (fieldSep === undefined) {
    throw new Error('Invalid MSH segment — cannot detect encoding');
  }
  const chars = mshSegment.slice(4).split(fieldSep)[0]!.split(/[\r\n]/)[0]!;
  if (chars.length < 3 || chars.length > 5 || new Set(chars).size !== chars.length) {
    throw new Error(`Invalid MSH-2 encoding characters "${chars}": expected 3 to 5 distinct characters`);
  }
  return {
    fieldSep,
    componentSep: chars[0]!,
    repetitionSep: chars[1]!,
    escapeChar: chars[2]!,
    subComponentSep: chars[3] ?? fieldSep,
    segmentSep: '\r',
  };
}

/** Build the MSH.2 encoding characters string (`^~\&`, or `^~\` when there is no subcomponent separator). */
export function encodingCharsString(enc: Hl7Encoding): string {
  const sub = enc.subComponentSep === enc.fieldSep ? '' : enc.subComponentSep;
  return `${enc.componentSep}${enc.repetitionSep}${enc.escapeChar}${sub}`;
}

/** Escape a regex special character for use in RegExp constructor. */
function escapeRegex(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split message text into segment lines.
 *
 * The standard separator is a carriage return, but files and HTTP bodies often
 * arrive with CRLF or bare line feeds. A CR (with or without a following LF)
 * always ends a segment. A bare LF ends one only when the next line starts like a
 * segment (three-character ID then the field separator) or is blank, because
 * some senders put raw line feeds inside free-text fields.
 */
export function splitSegments(text: string, enc: Pick<Hl7Encoding, 'fieldSep'>): string[] {
  const sep = escapeRegex(enc.fieldSep);
  const boundary = new RegExp(`\\r\\n?|\\n(?=[A-Z][A-Z0-9]{2}(?:${sep}|[\\r\\n]|$)|[\\r\\n])`);
  return text.replace(/[\r\n]+$/, '').split(boundary).filter((line) => line.trim() !== '');
}

/** Escape a value for embedding in an HL7 field. */
export function escapeValue(value: string, enc: Hl7Encoding): string {
  let result = value;
  // Escape char first to prevent double-encoding
  result = result.replace(new RegExp(escapeRegex(enc.escapeChar), 'g'), `${enc.escapeChar}E${enc.escapeChar}`);
  result = result.replace(new RegExp(escapeRegex(enc.fieldSep), 'g'), `${enc.escapeChar}F${enc.escapeChar}`);
  result = result.replace(new RegExp(escapeRegex(enc.componentSep), 'g'), `${enc.escapeChar}S${enc.escapeChar}`);
  result = result.replace(new RegExp(escapeRegex(enc.subComponentSep), 'g'), `${enc.escapeChar}T${enc.escapeChar}`);
  result = result.replace(new RegExp(escapeRegex(enc.repetitionSep), 'g'), `${enc.escapeChar}R${enc.escapeChar}`);
  result = result.replace(/\r/g, `${enc.escapeChar}X0D${enc.escapeChar}`);
  result = result.replace(/\n/g, `${enc.escapeChar}X0A${enc.escapeChar}`);
  return result;
}

/**
 * How the bytes of a `\X..\` escape become text. `utf-8` decodes them as
 * UTF-8; `windows-1252` reads one character per byte, with 0x80 to 0x9F as
 * Windows-1252 and every other byte as Latin-1.
 */
export type HexEscapeCharset = 'utf-8' | 'windows-1252';

/**
 * Windows-1252 characters for bytes 0x80 to 0x9F. The five bytes it leaves
 * undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) keep their C1 code points, as the
 * WHATWG Encoding Standard decodes them.
 */
const WINDOWS_1252_80_9F: readonly number[] = [
  0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F,
  0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178,
];

/** Non-fatal, so a malformed byte run becomes U+FFFD; `ignoreBOM` keeps an escaped BOM as U+FEFF. */
const UTF8_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });

/**
 * The charset for `\X..\` escapes from MSH-18 (HL7 table 0211). `UNICODE
 * UTF-8` (also `UTF-8` or `UTF8`, in any case) is UTF-8. Anything else,
 * including no MSH-18, `ASCII` and `8859/1`, is read as Windows-1252, as
 * browsers read a `latin1` label.
 */
export function hexEscapeCharset(msh18: string | undefined): HexEscapeCharset {
  const name = (msh18 ?? '').toUpperCase().replace(/[\s_-]/g, '');
  return name === 'UNICODEUTF8' || name === 'UTF8' ? 'utf-8' : 'windows-1252';
}

/** Decode the bytes of a run of `\X..\` escapes (`\XC3\\XA9\` is the bytes C3 A9). */
function decodeHexRun(run: string, escapeChar: string, charset: HexEscapeCharset): string {
  const bytes: number[] = [];
  for (const piece of run.split(escapeChar)) {
    for (let i = 1; i < piece.length; i += 2) {
      bytes.push(parseInt(piece.substring(i, i + 2), 16));
    }
  }
  if (charset === 'utf-8') return UTF8_DECODER.decode(Uint8Array.from(bytes));
  return bytes.map((b) => String.fromCharCode(WINDOWS_1252_80_9F[b - 0x80] ?? b)).join('');
}

/**
 * Unescape HL7 escape sequences back to their original characters.
 *
 * One pass over the text, so a decoded escape character can never join the
 * characters after it into a second sequence (the literal text `\F\` is
 * encoded as `\E\F\E\` and must decode to itself). Sequences this function
 * does not know, such as the formatting commands `\H\` and `\.br\`, are kept.
 *
 * Adjacent `\X..\` escapes are decoded as one byte run in `charset` (see
 * {@link HexEscapeCharset}), so a UTF-8 character split across two escapes
 * still decodes. Under UTF-8, bytes that are not valid UTF-8 become U+FFFD.
 */
export function unescapeValue(value: string, enc: Hl7Encoding, charset: HexEscapeCharset = 'windows-1252'): string {
  const e = escapeRegex(enc.escapeChar);
  const single: Readonly<Record<string, string>> = {
    E: enc.escapeChar, F: enc.fieldSep, S: enc.componentSep, T: enc.subComponentSep, R: enc.repetitionSep,
  };
  const pattern = new RegExp(`${e}([EFSTR])${e}|((?:${e}X(?:[0-9A-Fa-f]{2})+${e})+)`, 'g');
  return value.replace(pattern, (match, code: string | undefined, run: string | undefined) => {
    if (code !== undefined) return single[code] ?? match;
    return run === undefined ? match : decodeHexRun(run, enc.escapeChar, charset);
  });
}

/**
 * Escape only what can never be part of a value: the field separator and line
 * breaks. Used when a caller sets a value that may be a deliberate composite
 * (`CODE^Text`), where the other delimiters are structure and must be kept.
 */
export function escapeStructural(value: string, enc: Hl7Encoding): string {
  const x = enc.escapeChar;
  return value
    .split(enc.fieldSep).join(`${x}F${x}`)
    .replace(/\r/g, `${x}X0D${x}`)
    .replace(/\n/g, `${x}X0A${x}`);
}
