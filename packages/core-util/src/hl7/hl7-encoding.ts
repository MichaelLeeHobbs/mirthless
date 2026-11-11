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
  readonly subComponentSep: string;
  readonly segmentSep: string;
}

const MSH_REGEX = /^MSH(.)(.)(.)(.)(.)/;

/** Detect encoding characters from an MSH segment line. */
export function detectEncoding(mshSegment: string): Hl7Encoding {
  const matches = MSH_REGEX.exec(mshSegment);
  if (!matches) {
    throw new Error('Invalid MSH segment — cannot detect encoding');
  }
  return {
    fieldSep: matches[1]!,
    componentSep: matches[2]!,
    repetitionSep: matches[3]!,
    escapeChar: matches[4]!,
    subComponentSep: matches[5]!,
    segmentSep: '\r',
  };
}

/** Build the MSH.2 encoding characters string (4 chars: ^~\&). */
export function encodingCharsString(enc: Hl7Encoding): string {
  return `${enc.componentSep}${enc.repetitionSep}${enc.escapeChar}${enc.subComponentSep}`;
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
export function splitSegments(text: string, enc: Hl7Encoding): string[] {
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
 * Unescape HL7 escape sequences back to their original characters.
 *
 * One pass over the text, so a decoded escape character can never join the
 * characters after it into a second sequence (the literal text `\F\` is
 * encoded as `\E\F\E\` and must decode to itself). Sequences this function
 * does not know, such as the formatting commands `\H\` and `\.br\`, are kept.
 */
export function unescapeValue(value: string, enc: Hl7Encoding): string {
  const e = escapeRegex(enc.escapeChar);
  const single: Readonly<Record<string, string>> = {
    E: enc.escapeChar, F: enc.fieldSep, S: enc.componentSep, T: enc.subComponentSep, R: enc.repetitionSep,
  };
  return value.replace(new RegExp(`${e}([EFSTR]|X(?:[0-9A-Fa-f]{2})+)${e}`, 'g'), (_match, code: string) => {
    const known = single[code];
    if (known !== undefined) return known;
    let out = '';
    for (let i = 1; i < code.length; i += 2) {
      out += String.fromCharCode(parseInt(code.substring(i, i + 2), 16));
    }
    return out;
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
