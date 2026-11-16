// ===========================================
// HL7v2 ACK/NAK Generation
// ===========================================
// Generates acknowledgement messages from
// an original HL7v2 message.

import { Hl7Message } from './hl7-message.js';
import { formatTimestamp } from './hl7-timestamp.js';
import { encodingCharsString, escapeValue } from './hl7-encoding.js';

export interface AckOptions {
  readonly ackCode: 'AA' | 'AE' | 'AR';
  readonly textMessage?: string;
  /** An HL7 table 0357 error code (`207` application internal error), written to ERR-3 on AE/AR. */
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
  const version = original.get('MSH.12') ?? '2.5.1';

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

  // ERR-3 holds the code (CWE, table 0357) and ERR-4 the severity. ERR-1 is
  // kept by v2.5 only for backward compatibility, so it stays empty.
  if ((options.ackCode === 'AE' || options.ackCode === 'AR') && options.errorCode) {
    const code = [escapeValue(options.errorCode, enc), '', 'HL70357'].join(enc.componentSep);
    segments.push(['ERR', '', '', code, 'E'].join(enc.fieldSep));
  }

  return segments.join(enc.segmentSep);
}

