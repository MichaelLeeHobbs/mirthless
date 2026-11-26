export interface BatchSource {
  readonly inboundDataType: string;
  readonly sourceConnectorType: string;
  readonly sourceConnectorProperties: Readonly<Record<string, unknown>>;
}

/** Content these sources hand over is never HL7 text, so `splitHl7Batch` refuses every message of it (#441). */
function unsplittableContent(type: string, props: Readonly<Record<string, unknown>>): string | null {
  if (type === 'DATABASE') return 'a Database source hands over each row as a JSON object';
  if (type === 'DICOM') return 'a DICOM source hands over the path of a stored file';
  // The split runs before any script could take out the body.
  if (type === 'EMAIL') return 'an Email source hands over the whole email, headers first';
  if (type === 'FILE' && props['binary'] === true) return 'a File source with binary on hands over each file as base64';
  const charset = type === 'HTTP' ? props['bodyCharset'] : props['charset'];
  if ((type === 'HTTP' || type === 'KAFKA' || type === 'AMQP') && charset === 'base64') return 'this source hands over its content as base64';
  return null;
}

/**
 * Why the channel cannot process batches, or null. Deploy refuses such a channel, and the Mirth
 * importer holds it (D-301): it would deploy and record none of its messages, and a source that
 * settles its input anyway (a Database source with `updateMode` `ALWAYS`) would lose them.
 */
export function batchRefusal(channel: BatchSource): string | null {
  if (channel.sourceConnectorProperties['processBatch'] !== true) return null;
  const content = unsplittableContent(channel.sourceConnectorType, channel.sourceConnectorProperties);
  if (content !== null) return `batch processing splits HL7 v2 text, and ${content}`;
  if (channel.inboundDataType !== 'HL7V2') return `batch processing is only supported for HL7V2, not ${channel.inboundDataType}`;
  return null;
}
