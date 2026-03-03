// ===========================================
// HL7v2 ACK/NAK Generation
// ===========================================
// Generates acknowledgement messages from
// an original HL7v2 message.

import { Hl7Message } from './hl7-message.js';
import { formatTimestamp } from './hl7-timestamp.js';

export interface AckOptions {
  readonly ackCode: 'AA' | 'AE' | 'AR';
  readonly textMessage?: string;
  readonly errorCode?: string;
}

/**
 * Create an ACK/NAK response for the given original message.
 * Swaps sender/receiver, sets MSA with ack code + control ID.
 */
export function createAck(original: Hl7Message, options: AckOptions): string {
  const enc = original.encoding;

  // Get original header fields
  const sendApp = original.get('MSH.3') ?? '';
  const sendFac = original.get('MSH.4') ?? '';
  const recvApp = original.get('MSH.5') ?? '';
  const recvFac = original.get('MSH.6') ?? '';
  const controlId = original.get('MSH.10') ?? '';
  const version = original.get('MSH.12') ?? '2.5.1';

  const timestamp = formatTimestamp(new Date());

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
    controlId,
    original.get('MSH.11') ?? 'P',
    version,
  ].join(enc.fieldSep);

  // Build MSA segment
  const msaParts = [
    'MSA',
    options.ackCode,
    controlId,
  ];
  if (options.textMessage) {
    msaParts.push(options.textMessage);
  }
  const msa = msaParts.join(enc.fieldSep);

  const segments = [msh, msa];

  // Build ERR segment if error
  if ((options.ackCode === 'AE' || options.ackCode === 'AR') && options.errorCode) {
    const err = ['ERR', options.errorCode].join(enc.fieldSep);
    segments.push(err);
  }

  return segments.join(enc.segmentSep);
}

