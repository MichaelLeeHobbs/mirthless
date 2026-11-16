// ===========================================
// HL7v2 ACK/NAK Generation
// ===========================================
// Generates acknowledgement messages from
// an original HL7v2 message.

import { Hl7Message } from './hl7-message.js';
import { formatTimestamp } from './hl7-timestamp.js';
import { escapeValue } from './hl7-encoding.js';

export interface AckOptions {
  readonly ackCode: 'AA' | 'AE' | 'AR';
  readonly textMessage?: string;
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
    `${enc.componentSep}${enc.repetitionSep}${enc.escapeChar}${enc.subComponentSep}`,
    recvApp,
    recvFac,
    sendApp,
    sendFac,
    timestamp,
    '',
    `ACK${enc.componentSep}${original.get('MSH.9.2') ?? ''}`,
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

  // Build ERR segment if error
  if ((options.ackCode === 'AE' || options.ackCode === 'AR') && options.errorCode) {
    const err = ['ERR', escapeValue(options.errorCode, enc)].join(enc.fieldSep);
    segments.push(err);
  }

  return segments.join(enc.segmentSep);
}

