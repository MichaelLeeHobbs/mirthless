// Example channel transformer, authored against the sandbox ambient types
// (../sandbox-globals.d.ts). This file is type-checked by tsconfig.sandbox.json
// (`pnpm --filter @mirthless/engine typecheck:scripts`) but never bundled or run
// — it exists to prove the shipped ambient types resolve for real authoring.
//
// A real transformer body would end in `return <newMsg>`; a top-level return is
// illegal in a standalone .ts file, so this example demonstrates the same global
// surface via statements only.

const parsed: Hl7MessageProxy = parseHL7(rawData);
logger.info(`received ${parsed.messageType} (${parsed.messageControlId})`);

const mrn: string = parsed.get('PID.3') ?? 'unknown';
channelMap['lastMrn'] = mrn;
$c['lastType'] = parsed.messageType;

// Durable lookup via a Collection, typed end to end.
const priorVisits: Promise<CollectionRecord[]> = getCollection('visits').find({ mrn });
void priorVisits.then((records: CollectionRecord[]) => {
  logger.debug(`prior visits: ${records.length}`);
});

// Config + global maps, and a plain string transform on msg.
const facility: unknown = configMap['facility.name'];
globalMap['seenCount'] = ((globalMap['seenCount'] as number | undefined) ?? 0) + 1;
const normalized: string = String(msg).trim().toUpperCase();
void [facility, normalized];
