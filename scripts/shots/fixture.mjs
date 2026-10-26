// ===========================================
// Fake API for `pnpm shots`
// ===========================================
// Answers /api/v1 requests with realistic synthetic data so pages render
// populated and signed in without a server or database. No real PHI: every
// name, id and message here is made up.
//
// `route(pathname, search, method)` returns the `data` for the standard
// { success: true, data } envelope, or `undefined` for an empty list. Add a
// branch here when a page needs data it doesn't get yet.

const NOW = Date.parse('2026-10-26T14:00:00Z');
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString();

const CHANNELS = [
  ['c1', 'ADT Inbound - Epic', 'TCP_MLLP', 'HL7V2', 'HL7V2', 'STARTED', 48211, 12, 48190, 9, 0],
  ['c2', 'ORU Results to EHR', 'TCP_MLLP', 'HL7V2', 'HL7V2', 'STARTED', 19034, 0, 19002, 32, 4],
  ['c3', 'Lab Orders (ORM) - Sunquest', 'TCP_MLLP', 'HL7V2', 'HL7V2', 'PAUSED', 7420, 3, 7398, 0, 19],
  ['c4', 'FHIR Patient Sync', 'HTTP', 'JSON', 'FHIR', 'STARTED', 3311, 0, 3311, 0, 0],
  ['c5', 'Radiology Reports to PACS', 'DICOM', 'DICOM', 'HL7V2', 'STOPPED', 0, 0, 0, 0, 0],
  ['c6', 'Nightly Billing Export (file drop with a long name)', 'FILE', 'DELIMITED', 'XML', 'STARTED', 512, 40, 470, 2, 0],
  ['c7', 'Pharmacy RDE Feed', 'TCP_MLLP', 'HL7V2', 'HL7V2', 'UNDEPLOYED', 0, 0, 0, 0, 0],
];

const stats = CHANNELS.map(([id, name, src, inT, outT, , received, filtered, sent, errored, queued], i) => ({
  channelId: id, channelName: name, enabled: true, sourceConnectorType: src,
  inboundDataType: inT, outboundDataType: outT, revision: 3 + i, updatedAt: ago(60 * (i + 1)),
  received, filtered, sent, errored, queued,
}));

const status = CHANNELS.map(([channelId, , , , , state]) => ({ channelId, state }));

const tags = [
  { id: 't1', name: 'production', color: '#2e7d32', assignmentCount: 4 },
  { id: 't2', name: 'lab', color: '#f9a825', assignmentCount: 2 },
  { id: 't3', name: 'critical-path', color: '#c62828', assignmentCount: 2 },
  { id: 't4', name: 'untagged-colour', color: null, assignmentCount: 0 },
];

const groups = [
  { id: 'g1', name: 'Clinical', description: 'ADT, results and orders', revision: 2, memberCount: 3, createdAt: ago(9000), updatedAt: ago(600) },
  { id: 'g2', name: 'Imaging', description: null, revision: 1, memberCount: 1, createdAt: ago(9000), updatedAt: ago(900) },
];

const channelDetail = {
  id: 'c1', name: 'ADT Inbound - Epic', description: 'Admissions, discharges and transfers from Epic.',
  enabled: true, revision: 3, inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', sourceConnectorType: 'TCP_MLLP',
  createdAt: ago(90000), updatedAt: ago(60), responseMode: 'AUTO_AFTER_DESTINATIONS', responseConnectorName: null,
  initialState: 'STARTED', messageStorageMode: 'DEVELOPMENT', encryptData: false, removeContentOnCompletion: false,
  removeAttachmentsOnCompletion: false, pruningEnabled: true, pruningMaxAgeDays: 30, pruningArchiveEnabled: false,
  scriptTimeoutSeconds: 30, sourceConnectorProperties: { host: '0.0.0.0', port: 6661 }, scripts: [],
  destinations: [
    { id: 'd1', metaDataId: 1, name: 'To EHR', enabled: true, connectorType: 'TCP_MLLP', properties: { host: 'ehr.example.test', port: 7001 },
      queueMode: 'ON_FAILURE', retryCount: 3, retryIntervalMs: 10000, rotateQueue: false, queueThreadCount: 1, waitForPrevious: false },
  ],
  metadataColumns: [], tags: [tags[0]], filters: [], transformers: [],
};

const messages = Array.from({ length: 14 }, (_, i) => ({
  messageId: 48211 - i, correlationId: `corr-${String(48211 - i)}`, receivedAt: ago(i * 3 + 1), processed: true,
  processedAt: ago(i * 3), connectors: [
    { metaDataId: 0, connectorName: 'Source', status: i % 5 === 3 ? 'FILTERED' : 'TRANSFORMED', sendAttempts: 0 },
    { metaDataId: 1, connectorName: 'To EHR', status: i % 7 === 2 ? 'ERROR' : 'SENT', sendAttempts: i % 7 === 2 ? 3 : 1 },
  ],
}));

const traffic = messages.map((m, i) => ({
  messageId: m.messageId, channelId: CHANNELS[i % 4][0], channelName: CHANNELS[i % 4][1], receivedAt: m.receivedAt,
  processed: true, status: m.connectors[1].status, connectorName: 'To EHR',
}));

const users = [
  ['u1', 'admin', 'Avery', 'Nguyen', 'admin', true, 2],
  ['u2', 'jmorales', 'Jordan', 'Morales', 'deployer', true, 180],
  ['u3', 'kpatel', 'Kiran', 'Patel', 'developer', true, 4000],
  ['u4', 'svc-monitor', null, null, 'viewer', false, null],
].map(([id, username, firstName, lastName, role, enabled, lastLogin]) => ({
  id, username, email: `${username}@example.test`, firstName, lastName, role, enabled,
  lastLoginAt: lastLogin === null ? null : ago(lastLogin), createdAt: ago(200000),
}));

const alerts = [
  ['a1', 'Channel errors', 'Any errored message on a production channel', true, 'CHANNEL_ERROR', 4, 2],
  ['a2', 'Queue backlog', null, true, 'QUEUE_THRESHOLD', 2, 1],
  ['a3', 'No traffic for 30 minutes', 'ADT should never go quiet', false, 'NO_MESSAGES', 1, 1],
].map(([id, name, description, enabled, triggerType, channelCount, actionCount]) => ({
  id, name, description, enabled, triggerType, revision: 1, channelCount, actionCount, createdAt: ago(50000), updatedAt: ago(3000),
}));

const events = Array.from({ length: 12 }, (_, i) => ({
  id: 900 - i, level: ['INFORMATION', 'WARNING', 'ERROR'][i % 3], name: ['USER_LOGIN', 'CHANNEL_DEPLOYED', 'MESSAGE_ERROR', 'SETTINGS_CHANGED'][i % 4],
  outcome: i % 3 === 2 ? 'FAILURE' : 'SUCCESS', userId: i % 2 ? 'u1' : null, channelId: i % 4 === 1 ? 'c1' : null,
  ipAddress: '10.0.4.12', createdAt: ago(i * 11),
}));

const settings = [
  ['s1', 'server.name', 'Mirthless (staging)', 'string', 'Shown in the header', 'general'],
  ['s2', 'smtp.host', 'smtp.example.test', 'string', 'Outgoing mail server', 'smtp'],
  ['s3', 'smtp.port', '587', 'number', null, 'smtp'],
  ['s4', 'pruner.enabled', 'true', 'boolean', 'Run the data pruner nightly', 'pruner'],
].map(([id, key, value, type, description, category]) => ({ id, key, value, type, description, category, createdAt: ago(90000), updatedAt: ago(500) }));

const systemInfo = {
  server: { version: '0.1.0', nodeVersion: 'v22.11.0', env: 'production', pid: 4127, uptime: 389_200 },
  os: { platform: 'linux', arch: 'x64', totalMemory: 16 * 2 ** 30, freeMemory: 9.4 * 2 ** 30 },
  memory: { rss: 512 * 2 ** 20, heapUsed: 214 * 2 ** 20, heapTotal: 300 * 2 ** 20, external: 12 * 2 ** 20 },
  engine: { deployed: 6, started: 4, stopped: 1, paused: 1 },
  database: { connected: true },
};

const logs = [
  [30, 'INFO', 'engine', 'Channel "ADT Inbound - Epic" started'],
  [40, 'WARN', 'connector.tcp', 'Connection to ehr.example.test:7001 reset; retrying (1/3)'],
  [50, 'ERROR', 'pipeline', 'Destination "To EHR" failed after 3 attempts: ECONNREFUSED'],
  [20, 'DEBUG', 'pruner', 'Next pruner run scheduled for 02:00'],
  [30, 'INFO', 'http', 'GET /api/v1/channels/statistics 200 4ms'],
].map(([level, levelLabel, logger, message], i) => ({ timestamp: ago(i * 2), level, levelLabel, logger, message }));

const libraries = [
  { id: 'l1', name: 'HL7 helpers', description: 'Segment and field utilities', revision: 4, templateCount: 2, createdAt: ago(90000), updatedAt: ago(800) },
  { id: 'l2', name: 'Date formatting', description: null, revision: 1, templateCount: 1, createdAt: ago(90000), updatedAt: ago(5000) },
];
const templates = [
  ['t1', 'l1', 'getPatientName', 'Formats PID-5 as "Last, First"'],
  ['t2', 'l1', 'normalizeMrn', null],
  ['t3', 'l2', 'toIsoDate', 'HL7 TS to ISO 8601'],
].map(([id, libraryId, name, description]) => ({
  id, libraryId, name, description, type: 'FUNCTION', language: 'JAVASCRIPT',
  code: `function ${name}(value) {\n  return value;\n}`, contexts: ['SOURCE_FILTER_TRANSFORMER'], revision: 1, createdAt: ago(9000), updatedAt: ago(900),
}));

const alertDetail = {
  ...{ id: 'a1', name: 'Channel errors', description: 'Any errored message on a production channel', enabled: true, triggerType: 'CHANNEL_ERROR', revision: 1, channelCount: 2, actionCount: 1, createdAt: ago(50000), updatedAt: ago(3000) },
  trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null }, channelIds: ['c1', 'c2'],
  actions: [{ id: 'aa1', actionType: 'EMAIL', recipients: ['oncall@example.test'], properties: null }],
  subjectTemplate: 'Mirthless: ${channelName} errored', bodyTemplate: '${error}', reAlertIntervalMs: 900000, maxAlerts: 5,
};

const page = (data) => ({ data, pagination: { page: 1, pageSize: 25, total: data.length, totalPages: 1 } });

/** The `data` to answer a GET with; `undefined` answers an empty list. */
export function route(pathname, search) {
  const p = pathname.replace(/^\/api\/v1/, '');
  if (p === '/channels/statistics') return stats;
  if (p === '/channels/status') return status;
  if (p === '/channels/c1') return channelDetail;
  if (p === '/channels/c1/messages') return { items: messages, total: 48211, limit: 25, offset: 0 };
  if (p === '/messages') return { items: search.includes('status=ERROR') ? traffic.filter((t) => t.status === 'ERROR') : traffic, total: traffic.length, limit: 25, offset: 0 };
  if (p === '/tags') return tags;
  if (p === '/tags/assignments') return [{ tagId: 't1', channelId: 'c1' }, { tagId: 't1', channelId: 'c2' }, { tagId: 't2', channelId: 'c3' }, { tagId: 't3', channelId: 'c2' }];
  if (p === '/channel-groups') return groups;
  if (p === '/channel-groups/memberships') return [{ channelGroupId: 'g1', channelId: 'c1' }, { channelGroupId: 'g1', channelId: 'c2' }, { channelGroupId: 'g1', channelId: 'c3' }, { channelGroupId: 'g2', channelId: 'c5' }];
  if (p === '/users') return users;
  if (p === '/alerts') return page(alerts);
  if (p === '/events') return page(events);
  if (p === '/settings') return settings;
  if (p === '/system') return systemInfo;
  if (p === '/system/logs') return { entries: logs, total: logs.length };
  if (p === '/admin/prune/schedule') return { enabled: true, cronExpression: '0 2 * * *', lastRunAt: ago(720), lastRunResult: { channelsPruned: 4, totalDeleted: 18230, completedAt: ago(715) } };
  if (p === '/code-templates/libraries') return libraries;
  if (p === '/code-templates') return templates;
  if (p === '/global-scripts') return { deploy: '// Runs when any channel deploys\n', undeploy: '', preprocessor: 'return message;\n', postprocessor: '' };
  if (p === '/resources') return [
    { id: 'r1', name: 'facility-codes.json', description: 'Facility code lookup', mimeType: 'application/json', sizeBytes: 18234, createdAt: ago(90000), updatedAt: ago(4000) },
    { id: 'r2', name: 'zip-to-county.csv', description: null, mimeType: 'text/csv', sizeBytes: 1048576, createdAt: ago(90000), updatedAt: ago(40000) },
  ];
  if (p === '/collections') return [
    { id: 'k1', name: 'pending-orders', description: 'Orders waiting for a result, by accession', indexedFields: ['accession', 'facility'], defaultTtlSeconds: 2592000, createdAt: ago(90000), updatedAt: ago(100) },
  ];
  if (p === '/datasources') return [
    { id: 'ds1', name: 'ehr-replica', description: 'Read-only EHR reporting replica', driver: 'postgres', host: 'ehr-replica.example.test', port: 5432, database: 'ehr', user: 'mirthless_ro', readOnly: true, maxConnections: 5, statementTimeoutMs: 10000, maxRows: 1000, createdAt: ago(90000), updatedAt: ago(9000) },
  ];
  if (p === '/global-map') return [
    { key: 'lastAdtSequence', value: '48211', updatedAt: ago(1) },
    { key: 'ehr.maintenanceWindow', value: 'false', updatedAt: ago(600) },
  ];
  if (p === '/config-map') return [
    { category: 'endpoints', name: 'ehr.host', value: 'ehr.example.test' },
    { category: 'endpoints', name: 'ehr.port', value: '7001' },
    { category: 'flags', name: 'sendAcks', value: 'true' },
  ];
  if (p === '/certificates') return [
    { id: 'cert1', name: 'ehr-mllp-tls', description: 'TLS for the EHR MLLP link', type: 'CERTIFICATE', fingerprint: 'AB:CD:EF:01:23:45:67:89', issuer: 'CN=Example Test CA', subject: 'CN=ehr.example.test', notBefore: ago(400000), notAfter: new Date(NOW + 20 * 86400000).toISOString(), hasPrivateKey: true, createdAt: ago(400000), updatedAt: ago(400000) },
  ];
  if (p === '/extensions') return [
    { id: 'x1', name: 'HL7 v2 data type', version: '0.1.0', type: 'DATA_TYPE', description: 'Parse and serialize HL7 v2', enabled: true, capabilities: ['parse', 'serialize'] },
    { id: 'x2', name: 'DICOM connector', version: '0.1.0', type: 'CONNECTOR', description: 'C-STORE SCP and SCU', enabled: true, capabilities: ['source', 'destination'] },
  ];
  if (p === '/alerts/a1') return alertDetail;
  return undefined;
}
