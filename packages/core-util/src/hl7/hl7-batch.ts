import { splitSegments } from './hl7-encoding.js';

const ENVELOPE = new Set(['FHS', 'FTS', 'BHS', 'BTS']);

function batchFieldSeparator(content: string): string {
  return /^(?:FHS|BHS|MSH)(.)/m.exec(content)?.[1] ?? '|';
}

/**
 * Segments split as the parser splits them, so a line feed inside free text
 * stays in its field. A non-envelope segment before the first MSH refuses the
 * batch rather than losing it.
 */
export function splitHl7Batch(content: string): string[] {
  const messages: string[][] = [];
  for (const segment of splitSegments(content, { fieldSep: batchFieldSeparator(content) })) {
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
