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

/** Unescape HL7 escape sequences back to their original characters. */
export function unescapeValue(value: string, enc: Hl7Encoding): string {
  const e = escapeRegex(enc.escapeChar);
  let result = value;
  result = result.replace(new RegExp(`${e}E${e}`, 'g'), enc.escapeChar);
  result = result.replace(new RegExp(`${e}F${e}`, 'g'), enc.fieldSep);
  result = result.replace(new RegExp(`${e}S${e}`, 'g'), enc.componentSep);
  result = result.replace(new RegExp(`${e}T${e}`, 'g'), enc.subComponentSep);
  result = result.replace(new RegExp(`${e}R${e}`, 'g'), enc.repetitionSep);
  result = result.replace(new RegExp(`${e}X0D${e}`, 'g'), '\r');
  result = result.replace(new RegExp(`${e}X0A${e}`, 'g'), '\n');
  // Hex escape: \Xnn\ where nn is hex
  result = result.replace(new RegExp(`${e}X([0-9A-Fa-f]{2,})${e}`, 'g'), (_match, hex: string) => {
    let out = '';
    for (let i = 0; i < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
    }
    return out;
  });
  return result;
}
