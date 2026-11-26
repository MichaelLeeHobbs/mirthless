import { decodeWindows1252 } from '../windows-1252.js';

export interface Hl7Encoding {
  readonly fieldSep: string;
  readonly componentSep: string;
  readonly repetitionSep: string;
  readonly escapeChar: string;
  /**
   * The field separator when MSH-2 declares none (legacy three-character MSH-2):
   * a field never contains it, so nothing splits at subcomponent level.
   */
  readonly subComponentSep: string;
  readonly segmentSep: string;
}

/**
 * MSH-2 holds 4 distinct characters, or 5 from v2.7 (truncation). Legacy
 * senders send 3 with no subcomponent separator, read as Mirth reads it.
 * Anything else is refused: delimiters read from a malformed header would split
 * every field in the wrong place without an error.
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

export function encodingCharsString(enc: Hl7Encoding): string {
  const sub = enc.subComponentSep === enc.fieldSep ? '' : enc.subComponentSep;
  return `${enc.componentSep}${enc.repetitionSep}${enc.escapeChar}${sub}`;
}

function escapeRegex(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A CR (with or without LF) always ends a segment. A bare LF ends one only
 * before a line that starts like a segment or is blank: files and HTTP bodies
 * arrive with LF endings, and some senders put raw LFs inside free text.
 */
export function splitSegments(text: string, enc: Pick<Hl7Encoding, 'fieldSep'>): string[] {
  const sep = escapeRegex(enc.fieldSep);
  const boundary = new RegExp(`\\r\\n?|\\n(?=[A-Z][A-Z0-9]{2}(?:${sep}|[\\r\\n]|$)|[\\r\\n])`);
  return text.replace(/[\r\n]+$/, '').split(boundary).filter((line) => line.trim() !== '');
}

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

/** Fatal, so a run that is not valid UTF-8 is refused rather than turned into U+FFFD; `ignoreBOM` keeps an escaped BOM as U+FEFF. */
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * MSH-18 values are HL7 table 0211. Plain `UNICODE` (HL7 2.3) is read as UTF-8,
 * as HAPI and nHapi read it. Anything else, including no MSH-18, `ASCII` and
 * `8859/1`, is read as Windows-1252, as browsers read a `latin1` label.
 */
export function hexEscapeCharset(msh18: string | undefined): HexEscapeCharset {
  const name = (msh18 ?? '').toUpperCase().replace(/[\s_-]/g, '');
  return name === 'UNICODEUTF8' || name === 'UTF8' || name === 'UNICODE' ? 'utf-8' : 'windows-1252';
}

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    // A fatal TextDecoder reports invalid bytes only by throwing a TypeError;
    // the caller then reads the run byte by byte, so no byte is lost.
    return undefined;
  }
}

function hexBytes(digits: string): Uint8Array {
  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(digits.substring(i * 2, i * 2 + 2), 16);
  return bytes;
}

function decodeBytes(digits: string, charset: HexEscapeCharset): string {
  const bytes = hexBytes(digits);
  const utf8 = charset === 'utf-8' ? decodeUtf8(bytes) : undefined;
  return utf8 ?? decodeWindows1252(bytes);
}

/** HAPI, and the libraries that descend from it, write a carriage return as `\X000d\`. */
const WIDE_LINE_BREAKS = /^(?:000[AaDd])+$/;
const LINE_BREAKS = /^(?:0[AaDd])+$/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * For a sender that writes code points (#194, D-386): digits in fours, other
 * than line breaks, and other than UTF-8 bytes in a message MSH-18 says is UTF-8.
 */
function isCodeUnits(digits: string, charset: HexEscapeCharset): boolean {
  if (digits.length % 4 !== 0 || LINE_BREAKS.test(digits)) return false;
  if (charset !== 'utf-8') return true;
  const bytes = hexBytes(digits);
  return !bytes.some((b) => b >= 0x80) || decodeUtf8(bytes) === undefined;
}

function codeUnits(digits: string): string {
  let text = '';
  for (let i = 0; i < digits.length; i += 4) text += String.fromCharCode(parseInt(digits.substring(i, i + 4), 16));
  return text;
}

/** How a hex escape's digits are read: the charset MSH-18 names, and whether the channel's sender writes code points. */
interface HexEscapeReading {
  readonly charset: HexEscapeCharset;
  readonly codePoints: boolean;
}

/**
 * `\XC3\\XA9\` is the bytes C3 A9. Bytes next to each other decode together;
 * code points next to each other too, and when they would leave half a
 * surrogate pair they are kept as written rather than replaced.
 */
function decodeHexRun(run: string, escapeChar: string, reading: HexEscapeReading): string {
  let text = '';
  let bytes = '';
  let units = '';
  let unitsWritten = '';
  const endUnits = (): void => {
    text += LONE_SURROGATE.test(units) ? unitsWritten : units;
    units = '';
    unitsWritten = '';
  };
  for (const piece of run.split(escapeChar).filter((p) => p !== '')) {
    const written = piece.slice(1);
    const digits = WIDE_LINE_BREAKS.test(written) ? written.replace(/00(0[AaDd])/g, '$1') : written;
    if (reading.codePoints && isCodeUnits(digits, reading.charset)) {
      text += decodeBytes(bytes, reading.charset);
      bytes = '';
      units += codeUnits(digits);
      unitsWritten += `${escapeChar}${piece}${escapeChar}`;
    } else {
      endUnits();
      bytes += digits;
    }
  }
  endUnits();
  return text + decodeBytes(bytes, reading.charset);
}

/**
 * One pass, so a decoded escape character never joins what follows into a
 * second sequence (`\E\F\E\` must decode to the text `\F\`). Unknown sequences
 * such as `\H\` and `\.br\` are kept. Adjacent `\X..\` escapes decode as one
 * byte run, so a UTF-8 character split across two escapes still decodes.
 */
export function unescapeValue(value: string, enc: Hl7Encoding, charset: HexEscapeCharset = 'windows-1252', codePoints = false): string {
  const e = escapeRegex(enc.escapeChar);
  const single: Readonly<Record<string, string>> = {
    E: enc.escapeChar, F: enc.fieldSep, S: enc.componentSep, T: enc.subComponentSep, R: enc.repetitionSep,
  };
  const pattern = new RegExp(`${e}([EFSTR])${e}|(?:${e}X(?:[0-9A-Fa-f]{2})+${e})+`, 'g');
  return value.replace(pattern, (match: string, code: string | undefined) => {
    // The second alternative is the only other way to match, so a match without a code is a hex run.
    if (code !== undefined) return single[code] ?? match;
    return decodeHexRun(match, enc.escapeChar, { charset, codePoints });
  });
}

/**
 * Escapes only what can never be part of a value (field separator, line
 * breaks), for a value that may be a deliberate composite (`CODE^Text`).
 */
export function escapeStructural(value: string, enc: Hl7Encoding): string {
  const x = enc.escapeChar;
  return value
    .split(enc.fieldSep).join(`${x}F${x}`)
    .replace(/\r/g, `${x}X0D${x}`)
    .replace(/\n/g, `${x}X0A${x}`);
}
