// Type-checked by tsconfig.sandbox.json (`typecheck:scripts`), never run: it
// proves the ambient types in ../sandbox-globals.d.ts resolve. No `return`: a
// top-level return is illegal in a standalone .ts file.

const parsed: Hl7MessageProxy = parseHL7(rawData);
logger.info(`received ${parsed.messageType} (${parsed.messageControlId})`);

const mrn: string = parsed.get('PID.3') ?? 'unknown';
channelMap['lastMrn'] = mrn;
$c('lastType', parsed.messageType);

const priorVisits: Promise<CollectionRecord[]> = getCollection('visits').find({ mrn });
void priorVisits.then((records: CollectionRecord[]) => {
  logger.debug(`prior visits: ${records.length}`);
});

const facility: unknown = $cfg('facility.name') ?? configMap['facility.name'];
globalMap['seenCount'] = ((globalMap['seenCount'] as number | undefined) ?? 0) + 1;
const normalized: string = String(msg).trim().toUpperCase();
void [facility, normalized];
