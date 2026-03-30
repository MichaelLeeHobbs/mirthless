// ===========================================
// Example Channels Seed
// ===========================================
// Creates 10 example channels in an "Examples" group.
// Demonstrates RAW, HL7V2, JSON, XML data types, transformers,
// filters, channel-to-channel routing, HTTP/File/JS connectors.
//
// Idempotent: checks by channel name before creating.
// Partitions are NOT created here — they're created on first deploy.

import { eq, and, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';

type Db = NodePgDatabase<typeof schema>;

const EXAMPLES_GROUP = 'Examples';
const SCRIPT_TYPES = ['DEPLOY', 'UNDEPLOY', 'PREPROCESSOR', 'POSTPROCESSOR'] as const;

// ----- Helpers -----

async function findChannel(db: Db, name: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(and(eq(schema.channels.name, name), isNull(schema.channels.deletedAt)));
  return row?.id ?? null;
}

async function insertChannel(
  db: Db,
  input: {
    name: string;
    description: string;
    inboundDataType: string;
    outboundDataType: string;
    sourceConnectorType: string;
    sourceConnectorProperties: Record<string, unknown>;
    destinations?: Array<{
      name: string;
      connectorType: string;
      properties: Record<string, unknown>;
      queueMode?: string;
      retryCount?: number;
      retryIntervalMs?: number;
    }>;
    scripts?: { preprocessor?: string; postprocessor?: string; deploy?: string; undeploy?: string };
  },
): Promise<string> {
  const [row] = await db.insert(schema.channels).values({
    name: input.name,
    description: input.description,
    enabled: false,
    inboundDataType: input.inboundDataType,
    outboundDataType: input.outboundDataType,
    sourceConnectorType: input.sourceConnectorType,
    sourceConnectorProperties: input.sourceConnectorProperties,
    initialState: 'STOPPED',
    messageStorageMode: 'DEVELOPMENT',
  }).returning({ id: schema.channels.id });

  const channelId = row!.id;

  // Insert 4 default scripts
  for (const scriptType of SCRIPT_TYPES) {
    const scriptContent = input.scripts?.[scriptType.toLowerCase() as keyof typeof input.scripts] ?? '';
    await db.insert(schema.channelScripts).values({
      channelId,
      scriptType,
      script: scriptContent,
    });
  }

  // Insert destinations
  if (input.destinations) {
    for (let i = 0; i < input.destinations.length; i++) {
      const dest = input.destinations[i]!;
      await db.insert(schema.channelConnectors).values({
        channelId,
        metaDataId: i + 1,
        name: dest.name,
        enabled: true,
        connectorType: dest.connectorType,
        properties: dest.properties,
        queueMode: dest.queueMode ?? 'NEVER',
        retryCount: dest.retryCount ?? 0,
        retryIntervalMs: dest.retryIntervalMs ?? 10000,
      });
    }
  }

  return channelId;
}

async function addSourceFilter(db: Db, channelId: string, rules: Array<{
  name: string;
  script: string;
}>): Promise<void> {
  const [filter] = await db.insert(schema.channelFilters).values({
    channelId,
    connectorId: null,
  }).returning({ id: schema.channelFilters.id });

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    await db.insert(schema.filterRules).values({
      filterId: filter!.id,
      sequenceNumber: i,
      enabled: true,
      name: rule.name,
      operator: 'AND',
      type: 'JAVASCRIPT',
      script: rule.script,
    });
  }
}

async function addSourceTransformer(db: Db, channelId: string, inType: string, outType: string, steps: Array<{
  name: string;
  script: string;
}>): Promise<void> {
  const [transformer] = await db.insert(schema.channelTransformers).values({
    channelId,
    connectorId: null,
    inboundDataType: inType,
    outboundDataType: outType,
    inboundProperties: {},
    outboundProperties: {},
  }).returning({ id: schema.channelTransformers.id });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    await db.insert(schema.transformerSteps).values({
      transformerId: transformer!.id,
      sequenceNumber: i,
      enabled: true,
      name: step.name,
      type: 'JAVASCRIPT',
      script: step.script,
    });
  }
}

// ----- Main -----

export async function seedExampleChannels(db: Db): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('\nSeeding example channels...');

  // Create Examples group (idempotent)
  let [group] = await db.select({ id: schema.channelGroups.id })
    .from(schema.channelGroups)
    .where(eq(schema.channelGroups.name, EXAMPLES_GROUP));

  if (!group) {
    [group] = await db.insert(schema.channelGroups).values({
      name: EXAMPLES_GROUP,
      description: 'Example channels demonstrating Mirthless features',
    }).returning({ id: schema.channelGroups.id });
    // eslint-disable-next-line no-console
    console.log(`  + Created "${EXAMPLES_GROUP}" group`);
  }
  const groupId = group!.id;

  // Helper: create channel if not exists, assign to group
  const create = async (
    name: string,
    fn: () => Promise<string>,
  ): Promise<string> => {
    const existing = await findChannel(db, name);
    if (existing) {
      // eslint-disable-next-line no-console
      console.log(`  = ${name} (exists)`);
      return existing;
    }
    const id = await fn();
    // Assign to Examples group
    await db.insert(schema.channelGroupMembers).values({
      channelGroupId: groupId,
      channelId: id,
    });
    // eslint-disable-next-line no-console
    console.log(`  + ${name}`);
    return id;
  };

  // ===== Phase 1: No cross-channel dependencies =====

  // 1. Echo (RAW)
  const echoId = await create('Example: Echo (RAW)', () =>
    insertChannel(db, {
      name: 'Example: Echo (RAW)',
      description: 'Simplest channel. Receives raw text and stores it as-is. Deploy, start, then use Send Message to test.',
      inboundDataType: 'RAW',
      outboundDataType: 'RAW',
      sourceConnectorType: 'CHANNEL',
      sourceConnectorProperties: {},
    }),
  );

  // 2. String Transform (RAW)
  const stringTransId = await create('Example: String Transform', async () => {
    const id = await insertChannel(db, {
      name: 'Example: String Transform',
      description: 'RAW transformer wraps the message with greeting text. Send "World" to get "Hello, World!".',
      inboundDataType: 'RAW',
      outboundDataType: 'RAW',
      sourceConnectorType: 'CHANNEL',
      sourceConnectorProperties: {},
    });
    await addSourceTransformer(db, id, 'RAW', 'RAW', [{
      name: 'Wrap message',
      script: [
        '// msg is the raw message string for RAW data type',
        "msg = 'Hello, ' + msg + '!';",
      ].join('\n'),
    }]);
    return id;
  });

  // 3. HL7 to JSON
  const hl7ToJsonId = await create('Example: HL7 to JSON', async () => {
    const id = await insertChannel(db, {
      name: 'Example: HL7 to JSON',
      description: 'Converts HL7v2 to JSON. msg is auto-parsed — use msg.get("PID.3") to access fields. Send an HL7 ADT message to test.',
      inboundDataType: 'HL7V2',
      outboundDataType: 'JSON',
      sourceConnectorType: 'CHANNEL',
      sourceConnectorProperties: {},
    });
    await addSourceTransformer(db, id, 'HL7V2', 'JSON', [{
      name: 'Convert HL7 to JSON',
      script: [
        '// msg is auto-parsed as HL7v2 — use msg.get() for field access',
        'var patient = {',
        "  mrn: msg.get('PID.3'),",
        "  lastName: msg.get('PID.5.1'),",
        "  firstName: msg.get('PID.5.2'),",
        "  dob: msg.get('PID.7'),",
        "  gender: msg.get('PID.8'),",
        "  messageType: msg.get('MSH.9.1'),",
        "  triggerEvent: msg.get('MSH.9.2'),",
        "  sendingFacility: msg.get('MSH.4'),",
        "  messageControlId: msg.get('MSH.10')",
        '};',
        'msg = JSON.stringify(patient, null, 2);',
      ].join('\n'),
    }]);
    return id;
  });

  // 4. JSON Processor
  await create('Example: JSON Processor', async () => {
    const id = await insertChannel(db, {
      name: 'Example: JSON Processor',
      description: 'JSON via HTTP POST on port 6671. msg is auto-parsed — access fields directly (msg.name). Writes to ./output/json-processor/.',
      inboundDataType: 'JSON',
      outboundDataType: 'JSON',
      sourceConnectorType: 'HTTP',
      sourceConnectorProperties: {
        host: '0.0.0.0', port: 6671, path: '/', method: 'POST',
        responseContentType: 'application/json', responseStatusCode: 200,
      },
      destinations: [{
        name: 'File Writer',
        connectorType: 'FILE',
        properties: {
          directory: './output/json-processor', outputPattern: 'msg-${messageId}.json',
          charset: 'utf-8', binary: false, tempFileEnabled: true, appendMode: false,
        },
      }],
    });
    await addSourceTransformer(db, id, 'JSON', 'JSON', [{
      name: 'Enrich JSON',
      script: [
        '// For JSON data type, msg is auto-parsed — access fields directly',
        '// Example: POST {"name":"John","age":30} → msg.name === "John"',
        '',
        "msg.processedAt = new Date().toISOString();",
        "msg.processedBy = 'Mirthless';",
      ].join('\n'),
    }]);
    return id;
  });

  // 5. XML Transform
  await create('Example: XML Transform', async () => {
    const id = await insertChannel(db, {
      name: 'Example: XML Transform',
      description: 'XML via HTTP POST on port 6672. msg is auto-parsed — access elements via dot notation. Writes to ./output/xml-transform/.',
      inboundDataType: 'XML',
      outboundDataType: 'XML',
      sourceConnectorType: 'HTTP',
      sourceConnectorProperties: {
        host: '0.0.0.0', port: 6672, path: '/', method: 'POST',
        responseContentType: 'application/xml', responseStatusCode: 200,
      },
      destinations: [{
        name: 'File Writer',
        connectorType: 'FILE',
        properties: {
          directory: './output/xml-transform', outputPattern: 'msg-${messageId}.xml',
          charset: 'utf-8', binary: false, tempFileEnabled: true, appendMode: false,
        },
      }],
    });
    await addSourceTransformer(db, id, 'XML', 'XML', [{
      name: 'Extract XML fields',
      script: [
        '// For XML data type, msg is auto-parsed — access elements via dot notation',
        '// Example: <patient><name>John</name></patient> → msg.patient.name === "John"',
        '',
        "if (msg.patient) {",
        "  channelMap['patientName'] = msg.patient.name || 'Unknown';",
        "}",
      ].join('\n'),
    }]);
    return id;
  });

  // 6. Error Handler
  await create('Example: Error Handler', async () => {
    const id = await insertChannel(db, {
      name: 'Example: Error Handler',
      description: 'Throws error when message contains "ERROR". Send normal text to succeed, or include "ERROR" to see error handling.',
      inboundDataType: 'RAW',
      outboundDataType: 'RAW',
      sourceConnectorType: 'CHANNEL',
      sourceConnectorProperties: {},
    });
    await addSourceTransformer(db, id, 'RAW', 'RAW', [{
      name: 'Check for errors',
      script: [
        '// Throws an error if the message contains "ERROR"',
        "if (msg.includes('ERROR')) {",
        "  throw new Error('Message contained ERROR keyword — intentional demo');",
        "}",
        "msg = 'Processed OK: ' + msg;",
      ].join('\n'),
    }]);
    return id;
  });

  // 7. Filter Demo
  await create('Example: Filter Demo', async () => {
    const id = await insertChannel(db, {
      name: 'Example: Filter Demo',
      description: 'HL7v2 with source filter: only ADT^A01 messages pass. All other message types get FILTERED status.',
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'CHANNEL',
      sourceConnectorProperties: {},
    });
    await addSourceFilter(db, id, [{
      name: 'Accept only ADT^A01',
      script: [
        '// Return true to accept, false to filter out',
        '// msg is auto-parsed as HL7v2',
        "return msg.get('MSH.9.1') === 'ADT' && msg.get('MSH.9.2') === 'A01';",
      ].join('\n'),
    }]);
    return id;
  });

  // 8. JS Scripted
  await create('Example: JS Scripted', () =>
    insertChannel(db, {
      name: 'Example: JS Scripted',
      description: 'JavaScript source generates heartbeat every 60s. JavaScript destination logs it. Demonstrates JS connectors.',
      inboundDataType: 'RAW',
      outboundDataType: 'RAW',
      sourceConnectorType: 'JAVASCRIPT',
      sourceConnectorProperties: {
        script: [
          '// Runs on each poll interval. Return a string to create a message.',
          'return JSON.stringify({',
          "  type: 'heartbeat',",
          '  timestamp: new Date().toISOString(),',
          "  source: 'Example: JS Scripted'",
          '});',
        ].join('\n'),
        pollingIntervalMs: 60000,
      },
      destinations: [{
        name: 'JS Logger',
        connectorType: 'JAVASCRIPT',
        properties: {
          script: [
            "logger.info('Heartbeat received: ' + msg);",
            "return 'Logged OK';",
          ].join('\n'),
        },
      }],
    }),
  );

  // ===== Phase 2: Cross-channel dependencies =====

  // 9. HL7 ADT Router
  await create('Example: HL7 ADT Router', async () => {
    const id = await insertChannel(db, {
      name: 'Example: HL7 ADT Router',
      description: 'HL7v2 via HTTP on port 6670. Filters ADT messages, extracts demographics, routes to HL7-to-JSON channel + file archive.',
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'HTTP',
      sourceConnectorProperties: {
        host: '0.0.0.0', port: 6670, path: '/', method: 'POST',
        responseContentType: 'text/plain', responseStatusCode: 200,
      },
      destinations: [
        {
          name: 'Route to HL7-to-JSON',
          connectorType: 'CHANNEL',
          properties: { targetChannelId: hl7ToJsonId, waitForResponse: false },
          queueMode: 'ON_FAILURE', retryCount: 3, retryIntervalMs: 10000,
        },
        {
          name: 'File Archive',
          connectorType: 'FILE',
          properties: {
            directory: './output/hl7-archive', outputPattern: 'adt-${messageId}.hl7',
            charset: 'utf-8', binary: false, tempFileEnabled: true, appendMode: false,
          },
        },
      ],
    });
    await addSourceFilter(db, id, [{
      name: 'Accept only ADT',
      script: "return msg.get('MSH.9.1') === 'ADT';",
    }]);
    await addSourceTransformer(db, id, 'HL7V2', 'HL7V2', [{
      name: 'Extract demographics',
      script: [
        '// Extract patient info into channelMap for logging/debugging',
        "channelMap['patientMrn'] = msg.get('PID.3');",
        "channelMap['patientName'] = (msg.get('PID.5.2') || '') + ' ' + (msg.get('PID.5.1') || '');",
        "channelMap['messageType'] = msg.get('MSH.9.1') + '^' + msg.get('MSH.9.2');",
      ].join('\n'),
    }]);
    return id;
  });

  // 10. Multi-Destination
  await create('Example: Multi-Destination', () =>
    insertChannel(db, {
      name: 'Example: Multi-Destination',
      description: 'RAW via HTTP on port 6673. Fans out to 3 destinations: HTTP echo, file writer, and channel connector to Echo.',
      inboundDataType: 'RAW',
      outboundDataType: 'RAW',
      sourceConnectorType: 'HTTP',
      sourceConnectorProperties: {
        host: '0.0.0.0', port: 6673, path: '/', method: 'POST',
        responseContentType: 'text/plain', responseStatusCode: 200,
      },
      destinations: [
        {
          name: 'HTTP Echo',
          connectorType: 'HTTP',
          properties: {
            url: 'https://httpbin.org/post', method: 'POST',
            headers: '', contentType: 'text/plain', charset: 'UTF-8', responseTimeout: 10000,
          },
          queueMode: 'ON_FAILURE', retryCount: 3, retryIntervalMs: 5000,
        },
        {
          name: 'File Writer',
          connectorType: 'FILE',
          properties: {
            directory: './output/multi-dest', outputPattern: 'msg-${messageId}.txt',
            charset: 'utf-8', binary: false, tempFileEnabled: true, appendMode: false,
          },
        },
        {
          name: 'Route to Echo',
          connectorType: 'CHANNEL',
          properties: { targetChannelId: echoId, waitForResponse: false },
        },
      ],
    }),
  );

  // Suppress unused variable warnings for channels not referenced in Phase 2
  void stringTransId;
}
