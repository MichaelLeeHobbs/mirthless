import { describe, it, expect } from 'vitest';
import { amqpDestinationPropertiesSchema, amqpSourcePropertiesSchema } from '../queue-connector.schema.js';
import { databaseDestinationPropertiesSchema, databaseSourcePropertiesSchema } from '../database-connector.schema.js';
import { dicomDestinationPropertiesSchema } from '../dicom-connector.schema.js';
import { emailSourcePropertiesSchema } from '../email-connector.schema.js';
import { sftpDestinationPropertiesSchema, sftpSourcePropertiesSchema } from '../sftp-connector.schema.js';
import { smtpDestinationPropertiesSchema } from '../smtp-connector.schema.js';
import { tcpMllpDestinationPropertiesSchema } from '../tcp-mllp-connector.schema.js';

const login = { username: 'u', password: 'p' };

/** Every connector that connects to a named host, with the least it needs besides. */
const CONNECTORS = [
  ['AMQP source', amqpSourcePropertiesSchema, { queue: 'q' }],
  ['AMQP destination', amqpDestinationPropertiesSchema, { routingKey: 'k' }],
  ['DATABASE source', databaseSourcePropertiesSchema, { database: 'd', selectQuery: 'SELECT 1' }],
  ['DATABASE destination', databaseDestinationPropertiesSchema, { database: 'd', query: 'SELECT 1' }],
  ['DICOM destination', dicomDestinationPropertiesSchema, { port: 104 }],
  ['EMAIL source', emailSourcePropertiesSchema, login],
  ['SFTP source', sftpSourcePropertiesSchema, { ...login, remoteDirectory: '/in', strictHostKey: false }],
  ['SFTP destination', sftpDestinationPropertiesSchema, { ...login, remoteDirectory: '/out', strictHostKey: false }],
  ['SMTP destination', smtpDestinationPropertiesSchema, { from: 'a@example.test', to: 'b@example.test' }],
  ['TCP_MLLP destination', tcpMllpDestinationPropertiesSchema, { port: 2575 }],
] as const;

describe('the host of a connector', () => {
  it.each(CONNECTORS)('%s: loses its surrounding spaces', (_name, schema, rest) => {
    expect(schema.parse({ ...rest, host: ' partner.example ' })).toMatchObject({ host: 'partner.example' });
  });

  it.each(CONNECTORS)('%s: is required, and only spaces are none', (_name, schema, rest) => {
    for (const host of ['', '   ']) {
      const result = schema.safeParse({ ...rest, host });
      expect(result.success ? [] : result.error.issues.map((i) => [i.path, i.message])).toEqual([[['host'], 'required']]);
    }
  });
});
