// ===========================================
// HL7 ACK/NAK Building & Classification
// ===========================================
// The MLLP source connector must return a real HL7 acknowledgement to the
// sending system — never raw destination content (e.g. a file path). The MLLP
// destination connector must treat a NAK (MSA-1 = AE/AR/CE/CR) as an ERROR,
// not a silent SENT.

import { Hl7Message, createAck, formatTimestamp, escapeValue, type Hl7Encoding } from '@galvaniflow/core-util';

/** HL7 acknowledgement codes we emit. */
export type AckCode = 'AA' | 'AE' | 'AR';

/**
 * Build an HL7 ACK/NAK for an inbound message.
 * Uses the inbound MSH to swap sender/receiver and echo the control ID.
 * Falls back to a minimal, well-formed ACK when the inbound message cannot
 * be parsed as HL7 — a response is ALWAYS produced so the sender never times
 * out into a retransmit loop.
 *
 * @param inbound - Raw inbound HL7v2 message.
 * @param ackCode - AA (accept), AE (error), or AR (reject).
 * @param textMessage - Optional MSA-3 diagnostic text.
 */
export function buildAck(inbound: string, ackCode: AckCode, textMessage?: string): string {
  try {
    const msg = Hl7Message.parse(inbound);
    return createAck(msg, textMessage !== undefined ? { ackCode, textMessage } : { ackCode });
  } catch {
    return buildFallbackAck(ackCode, textMessage);
  }
}

const DEFAULT_ENCODING: Hl7Encoding = {
  fieldSep: '|', componentSep: '^', repetitionSep: '~', escapeChar: '\\', subComponentSep: '&', segmentSep: '\r',
};

/** Minimal ACK used when the inbound message is not parseable HL7. */
function buildFallbackAck(ackCode: AckCode, textMessage?: string): string {
  const timestamp = formatTimestamp(new Date());
  // MSH-10 holds at most 20 characters: "GF" plus the millisecond clock is 15.
  const controlId = `GF${String(Date.now())}`;
  const msh = ['MSH', '^~\\&', '', '', '', '', timestamp, '', 'ACK', controlId, 'P', '2.5.1'].join('|');
  const msaParts = ['MSA', ackCode, controlId];
  if (textMessage !== undefined) msaParts.push(escapeValue(textMessage, DEFAULT_ENCODING));
  return [msh, msaParts.join('|')].join('\r');
}

/** Classification of a received acknowledgement. */
export interface AckClassification {
  readonly accepted: boolean;
  readonly ackCode: string;
  readonly errorMessage?: string;
}

/**
 * Classify a received HL7 acknowledgement frame.
 * Accepts on MSA-1 = AA or CA; everything else (AE/AR/CE/CR, missing MSA,
 * or unparseable) is a failure so the message surfaces and can retry.
 *
 * A positive acknowledgement that names a different message (MSA-2 differs
 * from the control ID that was sent) is also a failure: on a reused connection
 * it means the reply belongs to something else, and counting it would mark an
 * undelivered message SENT. An acknowledgement with no MSA-2 is accepted.
 *
 * @param response - The raw HL7 acknowledgement received.
 * @param sentControlId - MSH-10 of the message that was sent, when it has one.
 */
export function classifyAckResponse(response: string, sentControlId?: string): AckClassification {
  const extracted = extractMsa(response);
  if (extracted === undefined) {
    return { accepted: false, ackCode: '', errorMessage: 'Unparseable acknowledgement response' };
  }

  const ackCode = extracted.code.toUpperCase();
  if (ackCode === 'AA' || ackCode === 'CA') {
    const ackedId = extracted.controlId ?? '';
    if (sentControlId && ackedId !== '' && ackedId !== sentControlId) {
      return {
        accepted: false,
        ackCode,
        errorMessage: `Acknowledgement is for a different message (MSA-2=${ackedId}, sent ${sentControlId})`,
      };
    }
    return { accepted: true, ackCode };
  }
  if (ackCode === '') {
    return { accepted: false, ackCode, errorMessage: 'Acknowledgement missing MSA-1' };
  }
  return {
    accepted: false,
    ackCode,
    errorMessage: `Negative acknowledgement (MSA-1=${ackCode})${extracted.text ? `: ${extracted.text}` : ''}`,
  };
}

/**
 * Extract MSA-1/MSA-3 from an acknowledgement. Handles a full HL7 message
 * (MSH + MSA) via the parser, and falls back to a manual segment scan for
 * degenerate responses that omit MSH (be liberal in what we accept).
 */
function extractMsa(response: string): { code: string; controlId?: string; text?: string } | undefined {
  try {
    const msg = Hl7Message.parse(response);
    const code = msg.get('MSA.1');
    if (code !== undefined) {
      const controlId = msg.get('MSA.2');
      const text = msg.get('MSA.3');
      return { code, ...(controlId !== undefined ? { controlId } : {}), ...(text !== undefined ? { text } : {}) };
    }
  } catch {
    // No MSH / not parseable as a full message — try a manual scan below.
  }
  for (const seg of response.split(/[\r\n]+/)) {
    if (seg.startsWith('MSA')) {
      const fields = seg.split('|');
      return { code: fields[1] ?? '', ...(fields[2] ? { controlId: fields[2] } : {}), ...(fields[3] ? { text: fields[3] } : {}) };
    }
  }
  return undefined;
}

/** MSH-10 of an outbound message, or undefined when it is not HL7 or has none. */
export function controlIdOf(message: string): string | undefined {
  try {
    const id = Hl7Message.parse(message).get('MSH.10');
    return id !== undefined && id !== '' ? id : undefined;
  } catch {
    return undefined;
  }
}
