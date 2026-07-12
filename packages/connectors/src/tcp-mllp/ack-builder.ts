// ===========================================
// HL7 ACK/NAK Building & Classification
// ===========================================
// The MLLP source connector must return a real HL7 acknowledgement to the
// sending system — never raw destination content (e.g. a file path). The MLLP
// destination connector must treat a NAK (MSA-1 = AE/AR/CE/CR) as an ERROR,
// not a silent SENT.

import { Hl7Message, createAck, formatTimestamp } from '@mirthless/core-util';

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

/** Minimal ACK used when the inbound message is not parseable HL7. */
function buildFallbackAck(ackCode: AckCode, textMessage?: string): string {
  const timestamp = formatTimestamp(new Date());
  const controlId = `MIRTHLESS${String(Date.now())}`;
  const msh = ['MSH', '^~\\&', '', '', '', '', timestamp, '', 'ACK', controlId, 'P', '2.5.1'].join('|');
  const msaParts = ['MSA', ackCode, controlId];
  if (textMessage !== undefined) msaParts.push(textMessage);
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
 * @param response - The raw HL7 acknowledgement received.
 */
export function classifyAckResponse(response: string): AckClassification {
  const extracted = extractMsa(response);
  if (extracted === undefined) {
    return { accepted: false, ackCode: '', errorMessage: 'Unparseable acknowledgement response' };
  }

  const ackCode = extracted.code.toUpperCase();
  if (ackCode === 'AA' || ackCode === 'CA') {
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
function extractMsa(response: string): { code: string; text?: string } | undefined {
  try {
    const msg = Hl7Message.parse(response);
    const code = msg.get('MSA.1');
    if (code !== undefined) {
      const text = msg.get('MSA.3');
      return text !== undefined ? { code, text } : { code };
    }
  } catch {
    // No MSH / not parseable as a full message — try a manual scan below.
  }
  for (const seg of response.split(/[\r\n]+/)) {
    if (seg.startsWith('MSA')) {
      const fields = seg.split('|');
      return { code: fields[1] ?? '', ...(fields[3] ? { text: fields[3] } : {}) };
    }
  }
  return undefined;
}
