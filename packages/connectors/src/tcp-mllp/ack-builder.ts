// The MLLP source must return a real HL7 acknowledgement, never raw destination
// content (e.g. a file path). The MLLP destination treats a NAK (MSA-1 =
// AE/AR/CE/CR) as an ERROR, not a silent SENT.

import { Hl7Message, createAck, formatTimestamp, escapeValue, newControlId, type Hl7Encoding } from '@galvanigraph/core-util';

export type AckCode = 'AA' | 'AE' | 'AR';

/**
 * Always answers, even when the inbound message is not parseable HL7, so the
 * sender never times out into a retransmit loop. `textMessage` goes in MSA-3.
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

function buildFallbackAck(ackCode: AckCode, textMessage?: string): string {
  const timestamp = formatTimestamp(new Date(), { utcOffset: true });
  const controlId = newControlId();
  const msh = ['MSH', '^~\\&', '', '', '', '', timestamp, '', 'ACK', controlId, 'P', '2.5.1'].join('|');
  const msaParts = ['MSA', ackCode, controlId];
  if (textMessage !== undefined) msaParts.push(escapeValue(textMessage, DEFAULT_ENCODING));
  return [msh, msaParts.join('|')].join('\r');
}

export interface AckClassification {
  readonly accepted: boolean;
  readonly ackCode: string;
  readonly errorMessage?: string;
}

/**
 * A positive acknowledgement that names a different message is a failure: on a
 * reused connection the reply belongs to something else, and counting it would
 * mark an undelivered message SENT. MSA-2 may equal the whole sent MSH-10 or
 * only its first component, which some receivers echo alone; rejecting that
 * would resend, and so duplicate, a message the receiver already took.
 */
export function classifyAckResponse(response: string, sent?: SentControlId): AckClassification {
  const extracted = extractMsa(response);
  if (extracted === undefined) {
    return { accepted: false, ackCode: '', errorMessage: 'Unparseable acknowledgement response' };
  }

  const ackCode = extracted.code.toUpperCase();
  if (ackCode === 'AA' || ackCode === 'CA') {
    const ackedId = extracted.controlId ?? '';
    if (sent && ackedId !== '' && ackedId !== sent.whole && ackedId !== sent.first) {
      return {
        accepted: false,
        ackCode,
        errorMessage: `Acknowledgement is for a different message (MSA-2=${ackedId}, sent ${sent.whole})`,
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
 * Falls back to a segment scan for responses that omit MSH. Only a segment named MSA counts, and MSA-1 is
 * read up to its first `^`, as the parse does: HL7 tells a receiver to ignore components it does not expect.
 */
function extractMsa(response: string): { code: string; controlId?: string; text?: string } | undefined {
  try {
    const msg = Hl7Message.parse(response);
    const code = msg.get('MSA.1');
    if (code !== undefined) {
      const controlId = msg.getRaw('MSA.2');
      const text = msg.get('MSA.3');
      return { code, ...(controlId !== undefined ? { controlId } : {}), ...(text !== undefined ? { text } : {}) };
    }
  } catch {
    // No MSH / not parseable as a full message — try a manual scan below.
  }
  for (const seg of response.split(/[\r\n]+/)) {
    const fields = seg.split('|');
    if (fields[0] === 'MSA') {
      const code = (fields[1] ?? '').split('^')[0] ?? '';
      return { code, ...(fields[2] ? { controlId: fields[2] } : {}), ...(fields[3] ? { text: fields[3] } : {}) };
    }
  }
  return undefined;
}

/** MSH-10 of a sent message: the whole field as encoded, and its first component. */
export interface SentControlId {
  readonly whole: string;
  readonly first: string;
}

/** Read with the message's own separators, which encoded the id. */
export function controlIdOf(message: string): SentControlId | undefined {
  try {
    const msg = Hl7Message.parse(message);
    const whole = msg.getRaw('MSH.10');
    if (whole === undefined || whole === '') return undefined;
    return { whole, first: msg.getRaw('MSH.10.1') ?? whole };
  } catch {
    return undefined;
  }
}
