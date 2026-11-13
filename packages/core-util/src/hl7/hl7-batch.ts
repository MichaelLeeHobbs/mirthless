// ===========================================
// HL7v2 batch splitting
// ===========================================
// A batch file holds several messages, each starting with an MSH segment, and
// may wrap them in file (FHS/FTS) and batch (BHS/BTS) header and trailer
// segments. Each message becomes its own message in the channel.

const ENVELOPE = new Set(['FHS', 'FTS', 'BHS', 'BTS']);

/**
 * The messages in an HL7v2 batch: one per MSH segment, with the segments that
 * follow it, joined by carriage returns. Envelope segments and blank lines are
 * dropped. Text before the first MSH that is not an envelope segment cannot
 * belong to a message, so the batch is refused rather than losing it.
 */
export function splitHl7Batch(content: string): string[] {
  const messages: string[][] = [];
  for (const segment of content.split(/\r\n|\r|\n/)) {
    if (segment.trim() === '') continue;
    const name = segment.slice(0, 3);
    if (ENVELOPE.has(name)) continue;
    if (name === 'MSH') {
      messages.push([segment]);
      continue;
    }
    const current = messages.at(-1);
    if (!current) throw new Error(`HL7 batch has a ${name} segment before its first MSH`);
    current.push(segment);
  }
  return messages.map((segments) => segments.join('\r'));
}
