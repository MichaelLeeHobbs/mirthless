// ===========================================
// Example Messages Seed
// ===========================================
// Populates the message browser with a handful of clearly-fake, browsable
// messages for each of the example channels created by seed-examples.ts /
// seed-showcase.ts. Without this the browser renders empty even though the
// example channels exist. Messages are written through the real MessageService
// write-path (the same one the engine uses) so row shapes cannot drift.
//
// Coverage per channel is a mix of happy and non-happy paths: SENT source +
// destinations, FILTERED source, ERROR source with a PROCESSING_ERROR content
// row, and destination-level SENT/ERROR/QUEUED/FILTERED outcomes. Message
// content is OBVIOUSLY fake (DOE^JOHN / MRN TEST12345 / {"patient":"TEST"}).
//
// A source message in "Example: HL7 ADT Router" and a correlated downstream
// message in "Example: HL7 to JSON" share one correlation id, so the A -> B
// channel hop is visible across both message browsers.
//
// Idempotent: a channel is skipped entirely when it already has >0 messages,
// logged with the same +/=/~ style used by seed-examples.ts. Uses the server
// db singleton (same connection MessageService uses); no db argument.

import { eq, and, asc, isNull, sql } from 'drizzle-orm';
import { CONTENT_TYPE, type MessageStatus } from '@mirthless/core-models';
import type { Result } from 'stderr-lib';
import { db } from '../../lib/db.js';
import { MessageService } from '../../services/message.service.js';
import * as schema from '../schema/index.js';

// Fixed pseudo-server id so all seeded statistics group under one server row.
const SERVER_ID = 'seed-server';

// Shared correlation id linking the HL7 ADT Router source message to the
// downstream HL7-to-JSON message (the A -> B channel hop).
const CASCADE_CORRELATION_ID = '11111111-1111-4111-8111-111111111111';

type StatField = 'received' | 'filtered' | 'sent' | 'errored';
type SourceOutcome = 'SENT' | 'FILTERED' | 'ERROR';
type DestStatus = Extract<MessageStatus, 'SENT' | 'ERROR' | 'QUEUED' | 'FILTERED'>;

interface DestOutcome {
  readonly status: DestStatus;
  readonly sent?: string; // CT SENT (outbound)
  readonly response?: string; // CT RESPONSE (outbound, SENT only)
  readonly error?: string; // CT PROCESSING_ERROR (ERROR only)
}

interface SampleMessage {
  readonly raw: string; // CT RAW at source (inbound)
  readonly transformed?: string; // CT TRANSFORMED at source (outbound)
  readonly outcome: SourceOutcome;
  readonly processingError?: string; // CT PROCESSING_ERROR at source (ERROR only)
  readonly correlationId?: string;
  readonly dests?: readonly DestOutcome[]; // aligned to enabled connectors by index
}

interface ChannelSpec {
  readonly channelName: string;
  readonly messages: readonly SampleMessage[];
}

interface DestPlan {
  readonly metaDataId: number;
  readonly name: string;
  readonly outcome: DestOutcome;
}

interface WriteCtx {
  readonly channelId: string;
  readonly inbound: string;
  readonly outbound: string;
  readonly connectors: ReadonlyArray<{ readonly metaDataId: number; readonly name: string }>;
}

const STATUS_STAT: Readonly<Partial<Record<MessageStatus, StatField>>> = {
  SENT: 'sent',
  ERROR: 'errored',
  FILTERED: 'filtered',
};

// ----- Result unwrap (seed context: throw loudly, run-seed catches) -----

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

// ----- Write-path helpers (mirror engine's MessageProcessor) -----

/** Set a connector's status and increment the matching lifetime stat. */
async function setConnectorStatus(
  channelId: string,
  messageId: number,
  metaDataId: number,
  status: DestStatus,
): Promise<void> {
  must(await MessageService.updateConnectorMessageStatus(channelId, messageId, metaDataId, status));
  const field = STATUS_STAT[status];
  if (field) {
    must(await MessageService.incrementStats(channelId, metaDataId, SERVER_ID, field));
  }
}

/** Create one destination connector message with its content and final status. */
async function writeDestination(
  channelId: string,
  messageId: number,
  outbound: string,
  plan: DestPlan,
): Promise<void> {
  const { metaDataId, name, outcome } = plan;
  must(await MessageService.createConnectorMessage(channelId, messageId, metaDataId, name, 'RECEIVED'));
  if (outcome.sent !== undefined) {
    must(await MessageService.storeContent(channelId, messageId, metaDataId, CONTENT_TYPE.SENT, outcome.sent, outbound));
  }
  if (outcome.response !== undefined) {
    must(await MessageService.storeContent(channelId, messageId, metaDataId, CONTENT_TYPE.RESPONSE, outcome.response, outbound));
  }
  if (outcome.error !== undefined) {
    must(await MessageService.storeContent(channelId, messageId, metaDataId, CONTENT_TYPE.PROCESSING_ERROR, outcome.error, 'TEXT'));
  }
  await setConnectorStatus(channelId, messageId, metaDataId, outcome.status);
}

/** Finalize the source connector (metaDataId 0) per the message outcome. */
async function finalizeSource(channelId: string, messageId: number, msg: SampleMessage): Promise<void> {
  if (msg.outcome === 'SENT') {
    must(await MessageService.finalizeMessage(channelId, messageId, SERVER_ID));
    return;
  }
  if (msg.outcome === 'FILTERED') {
    await setConnectorStatus(channelId, messageId, 0, 'FILTERED');
    must(await MessageService.markProcessed(channelId, messageId));
    return;
  }
  if (msg.processingError !== undefined) {
    must(await MessageService.storeContent(channelId, messageId, 0, CONTENT_TYPE.PROCESSING_ERROR, msg.processingError, 'TEXT'));
  }
  await setConnectorStatus(channelId, messageId, 0, 'ERROR');
  must(await MessageService.markProcessed(channelId, messageId));
}

/** Write a full message (source + optional transformed + destinations). */
async function writeMessage(ctx: WriteCtx, msg: SampleMessage): Promise<void> {
  const init = must(
    await MessageService.initializeMessage(
      ctx.channelId,
      SERVER_ID,
      'Source',
      [{ metaDataId: 0, contentType: CONTENT_TYPE.RAW, content: msg.raw, dataType: ctx.inbound }],
      msg.correlationId,
    ),
  );
  const messageId = init.messageId;
  if (msg.transformed !== undefined) {
    must(await MessageService.storeContent(ctx.channelId, messageId, 0, CONTENT_TYPE.TRANSFORMED, msg.transformed, ctx.outbound));
  }
  const dests = msg.dests ?? [];
  for (let i = 0; i < dests.length; i++) {
    const connector = ctx.connectors[i];
    if (!connector) continue; // channel has fewer connectors than declared — skip gracefully
    await writeDestination(ctx.channelId, messageId, ctx.outbound, {
      metaDataId: connector.metaDataId,
      name: connector.name,
      outcome: dests[i]!,
    });
  }
  await finalizeSource(ctx.channelId, messageId, msg);
}

// ----- Channel lookup + idempotency -----

async function loadCtx(channelName: string): Promise<WriteCtx | null> {
  const [channel] = await db
    .select({
      id: schema.channels.id,
      inbound: schema.channels.inboundDataType,
      outbound: schema.channels.outboundDataType,
    })
    .from(schema.channels)
    .where(and(eq(schema.channels.name, channelName), isNull(schema.channels.deletedAt)));
  if (!channel) return null;
  const connectors = await db
    .select({ metaDataId: schema.channelConnectors.metaDataId, name: schema.channelConnectors.name })
    .from(schema.channelConnectors)
    .where(and(eq(schema.channelConnectors.channelId, channel.id), eq(schema.channelConnectors.enabled, true)))
    .orderBy(asc(schema.channelConnectors.metaDataId));
  return { channelId: channel.id, inbound: channel.inbound, outbound: channel.outbound, connectors };
}

async function hasMessages(channelId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(eq(schema.messages.channelId, channelId));
  return (row?.n ?? 0) > 0;
}

async function seedChannel(spec: ChannelSpec): Promise<void> {
  const ctx = await loadCtx(spec.channelName);
  if (!ctx) {
    // eslint-disable-next-line no-console
    console.log(`  ~ ${spec.channelName} (not found, skipped)`);
    return;
  }
  if (await hasMessages(ctx.channelId)) {
    // eslint-disable-next-line no-console
    console.log(`  = ${spec.channelName} (has messages)`);
    return;
  }
  for (const msg of spec.messages) {
    await writeMessage(ctx, msg);
  }
  // eslint-disable-next-line no-console
  console.log(`  + ${spec.channelName} (${spec.messages.length} messages)`);
}

// ----- Fake message payloads (obviously test data) -----

const HL7_ADT_A01 = [
  'MSH|^~\\&|TESTSEND|TESTFAC|TESTRECV|TESTFAC|20260712120000||ADT^A01|TEST0001|P|2.5',
  'EVN|A01|20260712120000',
  'PID|1||TEST12345^^^MRN||DOE^JOHN||19800101|M|||123 TEST ST^^TESTVILLE^TS^00000',
  'PV1|1|I|WARD^101^A',
].join('\n');

const HL7_ADT_A01_B = [
  'MSH|^~\\&|TESTSEND|TESTFAC|TESTRECV|TESTFAC|20260712121500||ADT^A01|TEST0003|P|2.5',
  'EVN|A01|20260712121500',
  'PID|1||TEST54321^^^MRN||DOE^JANE||19750615|F|||456 TEST AVE^^TESTVILLE^TS^00000',
  'PV1|1|I|WARD^202^B',
].join('\n');

const HL7_ORU_R01 = [
  'MSH|^~\\&|TESTSEND|TESTFAC|TESTRECV|TESTFAC|20260712122000||ORU^R01|TEST0004|P|2.5',
  'PID|1||TEST99999^^^MRN||DOE^SAM||19900303|M',
  'OBR|1||TESTORDER|CBC^COMPLETE BLOOD COUNT',
].join('\n');

const HL7_ADT_A02 = [
  'MSH|^~\\&|TESTSEND|TESTFAC|TESTRECV|TESTFAC|20260712123000||ADT^A02|TEST0005|P|2.5',
  'EVN|A02|20260712123000',
  'PID|1||TEST11111^^^MRN||DOE^PAT||19681212|F',
  'PV1|1|I|WARD^303^C',
].join('\n');

const HL7_TO_JSON_OUT = JSON.stringify(
  {
    mrn: 'TEST12345',
    lastName: 'DOE',
    firstName: 'JOHN',
    dob: '19800101',
    gender: 'M',
    messageType: 'ADT',
    triggerEvent: 'A01',
    sendingFacility: 'TESTFAC',
    messageControlId: 'TEST0001',
  },
  null,
  2,
);

const JSON_IN = '{"patient":"TEST","mrn":"TEST12345"}';
const JSON_OUT = '{"patient":"TEST","mrn":"TEST12345","processedAt":"2026-07-12T12:00:00.000Z","processedBy":"Mirthless"}';
const XML_DOC = '<patient><name>TEST DOE</name><mrn>TEST12345</mrn></patient>';
const HEARTBEAT = '{"type":"heartbeat","timestamp":"2026-07-12T12:00:00.000Z","source":"Example: JS Scripted"}';

// ----- Declarative channel -> messages map -----

const SPECS: ReadonlyArray<ChannelSpec> = [
  {
    channelName: 'Example: Echo (RAW)',
    messages: [
      { raw: 'TEST echo message one', outcome: 'SENT' },
      { raw: 'TEST echo message two', outcome: 'SENT' },
    ],
  },
  {
    channelName: 'Example: String Transform',
    messages: [
      { raw: 'World', transformed: 'Hello, World!', outcome: 'SENT' },
      { raw: 'Mirthless', transformed: 'Hello, Mirthless!', outcome: 'SENT' },
    ],
  },
  {
    channelName: 'Example: HL7 to JSON',
    messages: [
      // Correlated downstream half of the HL7 ADT Router -> HL7-to-JSON hop.
      { raw: HL7_ADT_A01, transformed: HL7_TO_JSON_OUT, outcome: 'SENT', correlationId: CASCADE_CORRELATION_ID },
      { raw: HL7_ADT_A01_B, transformed: HL7_TO_JSON_OUT, outcome: 'SENT' },
    ],
  },
  {
    channelName: 'Example: JSON Processor',
    messages: [
      {
        raw: JSON_IN,
        transformed: JSON_OUT,
        outcome: 'SENT',
        dests: [{ status: 'SENT', sent: JSON_OUT, response: 'Wrote ./output/json-processor/msg-1.json' }],
      },
      {
        raw: '{"patient":"TEST","mrn":"TEST67890"}',
        transformed: '{"patient":"TEST","mrn":"TEST67890","processedAt":"2026-07-12T12:05:00.000Z","processedBy":"Mirthless"}',
        outcome: 'SENT',
        dests: [{ status: 'SENT', sent: '{"patient":"TEST","mrn":"TEST67890","processedBy":"Mirthless"}', response: 'Wrote ./output/json-processor/msg-2.json' }],
      },
    ],
  },
  {
    channelName: 'Example: XML Transform',
    messages: [
      {
        raw: XML_DOC,
        transformed: XML_DOC,
        outcome: 'SENT',
        dests: [{ status: 'SENT', sent: XML_DOC, response: 'Wrote ./output/xml-transform/msg-1.xml' }],
      },
      {
        raw: '<patient><name>TEST ROE</name><mrn>TEST67890</mrn></patient>',
        transformed: '<patient><name>TEST ROE</name><mrn>TEST67890</mrn></patient>',
        outcome: 'SENT',
        dests: [{ status: 'SENT', sent: '<patient><name>TEST ROE</name><mrn>TEST67890</mrn></patient>', response: 'Wrote ./output/xml-transform/msg-2.xml' }],
      },
    ],
  },
  {
    channelName: 'Example: Error Handler',
    messages: [
      { raw: 'Normal message', transformed: 'Processed OK: Normal message', outcome: 'SENT' },
      {
        raw: 'This message has an ERROR keyword',
        outcome: 'ERROR',
        processingError: 'Error: Message contained ERROR keyword — intentional demo',
      },
    ],
  },
  {
    channelName: 'Example: Filter Demo',
    messages: [
      { raw: HL7_ADT_A01, outcome: 'SENT' },
      // Non-ADT^A01 message is rejected by the source filter.
      { raw: HL7_ORU_R01, outcome: 'FILTERED' },
    ],
  },
  {
    channelName: 'Example: JS Scripted',
    messages: [
      { raw: HEARTBEAT, outcome: 'SENT', dests: [{ status: 'SENT', sent: HEARTBEAT, response: 'Logged OK' }] },
      {
        raw: '{"type":"heartbeat","timestamp":"2026-07-12T12:01:00.000Z","source":"Example: JS Scripted"}',
        outcome: 'SENT',
        dests: [{ status: 'SENT', sent: '{"type":"heartbeat","timestamp":"2026-07-12T12:01:00.000Z","source":"Example: JS Scripted"}', response: 'Logged OK' }],
      },
    ],
  },
  {
    channelName: 'Example: HL7 ADT Router',
    messages: [
      // Happy path + the source half of the cascade to HL7-to-JSON.
      {
        raw: HL7_ADT_A01,
        transformed: HL7_ADT_A01,
        outcome: 'SENT',
        correlationId: CASCADE_CORRELATION_ID,
        dests: [
          { status: 'SENT', sent: HL7_ADT_A01, response: 'Routed to Example: HL7 to JSON' },
          { status: 'SENT', sent: HL7_ADT_A01, response: 'Wrote ./output/hl7-archive/adt-1.hl7' },
        ],
      },
      // Destination error: file archive write fails -> source recorded as ERROR.
      {
        raw: HL7_ADT_A01_B,
        transformed: HL7_ADT_A01_B,
        outcome: 'ERROR',
        dests: [
          { status: 'SENT', sent: HL7_ADT_A01_B, response: 'Routed to Example: HL7 to JSON' },
          { status: 'ERROR', sent: HL7_ADT_A01_B, error: "Error: ENOENT: cannot write to './output/hl7-archive'" },
        ],
      },
      // Non-ADT message rejected by the source filter (no destinations run).
      { raw: HL7_ORU_R01, outcome: 'FILTERED' },
    ],
  },
  {
    channelName: 'Example: Multi-Destination',
    messages: [
      {
        raw: 'TEST multi-dest payload',
        outcome: 'SENT',
        dests: [
          { status: 'SENT', sent: 'TEST multi-dest payload', response: '{"echo":"TEST multi-dest payload"}' },
          { status: 'SENT', sent: 'TEST multi-dest payload', response: 'Wrote ./output/multi-dest/msg-1.txt' },
          { status: 'SENT', sent: 'TEST multi-dest payload', response: 'Routed to Example: Echo (RAW)' },
        ],
      },
      // HTTP Echo destination fails -> source recorded as ERROR; other dests still SENT.
      {
        raw: 'TEST failing payload',
        outcome: 'ERROR',
        dests: [
          { status: 'ERROR', sent: 'TEST failing payload', error: 'Error: HTTP 502 Bad Gateway from https://httpbin.org/post' },
          { status: 'SENT', sent: 'TEST failing payload', response: 'Wrote ./output/multi-dest/msg-2.txt' },
          { status: 'SENT', sent: 'TEST failing payload', response: 'Routed to Example: Echo (RAW)' },
        ],
      },
    ],
  },
  {
    channelName: 'Example: Full Pipeline',
    messages: [
      {
        raw: HL7_ADT_A01,
        transformed: HL7_ADT_A01,
        outcome: 'SENT',
        dests: [{ status: 'SENT', sent: HL7_ADT_A01, response: 'delivered' }],
      },
      // Destination-level filter rejects the non-A01 message; source still completes.
      {
        raw: HL7_ADT_A02,
        transformed: HL7_ADT_A02,
        outcome: 'SENT',
        dests: [{ status: 'FILTERED' }],
      },
    ],
  },
];

// ----- Main -----

/**
 * Seed browsable example messages for the example channels. Idempotent per
 * channel (skips any channel that already has messages) and skips gracefully
 * when a channel is absent. Safe to run after seedExampleChannels/seedShowcase.
 */
export async function seedExampleMessages(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('\nSeeding example messages...');
  for (const spec of SPECS) {
    await seedChannel(spec);
  }
}
