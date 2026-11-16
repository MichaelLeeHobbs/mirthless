// ===========================================
// HL7v2 ACK/NAK Generation
// ===========================================
// Generates acknowledgement messages from
// an original HL7v2 message.

import { Hl7Message } from './hl7-message.js';
import { formatTimestamp } from './hl7-timestamp.js';
import { encodingCharsString, escapeValue, type Hl7Encoding } from './hl7-encoding.js';

export interface AckOptions {
  readonly ackCode: 'AA' | 'AE' | 'AR';
  readonly textMessage?: string;
  /** An HL7 table 0357 error code (`207` application internal error), written to ERR on AE/AR: ERR-1 before v2.5, ERR-3 from v2.5. */
  readonly errorCode?: string;
}

let controlIdSequence = 0;

/**
 * A new control id for a message GalvaniFlow sends, such as an ACK's MSH-10:
 * `GF`, the millisecond clock (13 digits) and a 5-digit sequence, 20 characters
 * in all, the most MSH-10 holds. The sequence keeps ids made in the same
 * millisecond apart.
 */
export function newControlId(): string {
  controlIdSequence = (controlIdSequence + 1) % 100_000;
  return `GF${String(Date.now())}${String(controlIdSequence).padStart(5, '0')}`;
}

/**
 * Create an ACK/NAK response for the given original message.
 * Swaps sender/receiver, gives the ACK its own control id in MSH-10 and echoes
 * the original's in MSA-2.
 */
export function createAck(original: Hl7Message, options: AckOptions): string {
  const enc = original.encoding;

  // Get original header fields
  const sendApp = original.getRaw('MSH.3') ?? '';
  const sendFac = original.getRaw('MSH.4') ?? '';
  const recvApp = original.getRaw('MSH.5') ?? '';
  const recvFac = original.getRaw('MSH.6') ?? '';
  // MSA-2 echoes MSH-10 exactly as it was sent, every component and escape included.
  const controlId = original.getRaw('MSH.10') ?? '';
  // MSH-12 echoed whole (VID: version, then internationalization codes), so the sender reads the ACK by its own version's rules.
  const version = original.getRaw('MSH.12') ?? '2.5.1';

  const timestamp = formatTimestamp(new Date(), { utcOffset: true });

  // Build MSH segment (swap sender/receiver)
  const msh = [
    'MSH',
    // The sender's encoding characters as it sent them (3, 4 or 5), so it reads the ACK with its own rules.
    original.getRaw('MSH.2') ?? encodingCharsString(enc),
    recvApp,
    recvFac,
    sendApp,
    sendFac,
    timestamp,
    '',
    ['ACK', original.get('MSH.9.2') ?? '', 'ACK'].join(enc.componentSep),
    newControlId(),
    original.getRaw('MSH.11') ?? 'P',
    version,
  ].join(enc.fieldSep);

  // Build MSA segment
  const msaParts = [
    'MSA',
    options.ackCode,
    controlId,
  ];
  if (options.textMessage) {
    // Free text: a delimiter or line break in it must not start a new field or segment.
    msaParts.push(escapeValue(options.textMessage, enc));
  }
  const msa = msaParts.join(enc.fieldSep);

  const segments = [msh, msa];

  if ((options.ackCode === 'AE' || options.ackCode === 'AR') && options.errorCode) {
    segments.push(errSegment(escapeValue(options.errorCode, enc), original.get('MSH.12') ?? '', enc));
  }

  return segments.join(enc.segmentSep);
}

/**
 * The ERR segment for an already-escaped table 0357 code, laid out for the
 * sender's version. Before v2.5 the code goes in ERR-1 (ELD.4), the only field
 * those versions have. From v2.5, which keeps ERR-1 only for backward
 * compatibility, it goes in ERR-3 (CWE) with severity `E` in ERR-4. A missing or
 * unreadable version gets the current layout.
 */
function errSegment(code: string, version: string, enc: Hl7Encoding): string {
  const parts = /^(\d+)\.(\d+)/.exec(version);
  const beforeV25 = parts !== null && (Number(parts[1]) < 2 || (Number(parts[1]) === 2 && Number(parts[2]) < 5));
  if (beforeV25) {
    return ['ERR', `${enc.componentSep.repeat(3)}${code}`].join(enc.fieldSep);
  }
  return ['ERR', '', '', [code, '', 'HL70357'].join(enc.componentSep), 'E'].join(enc.fieldSep);
}

