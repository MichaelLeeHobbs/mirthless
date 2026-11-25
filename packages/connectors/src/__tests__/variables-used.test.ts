// Crash recovery does not send to a destination that names a variable the message's variables
// were not kept for, so a name missing from `variablesUsed` is data sent wrong and read as SENT (#390).

import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { variableNames, type ConnectorMessage, type DestinationConnectorRuntime } from '../base.js';
import { AmqpDispatcher } from '../amqp/amqp-dispatcher.js';
import { ChannelDispatcher } from '../channel/channel-dispatcher.js';
import { DatabaseDispatcher, type DatabaseDispatcherConfig } from '../database/database-dispatcher.js';
import type { DatabasePool } from '../database/connection-pool.js';
import { DATABASE_VENDOR } from '../database/database-vendor.js';
import { HttpDispatcher } from '../http/http-dispatcher.js';
import { JavaScriptDispatcher } from '../javascript/javascript-dispatcher.js';
import { KafkaDispatcher } from '../kafka/kafka-dispatcher.js';
import { SmtpDispatcher } from '../smtp/smtp-dispatcher.js';
import { createDestinationConnector } from '../registry.js';
import { FakeAmqpPublisher } from '../__fixtures__/fake-amqp.js';
import { FakeKafkaProducer } from '../__fixtures__/fake-kafka.js';

const signal = (): AbortSignal => new AbortController().signal;

function message(overrides: Partial<ConnectorMessage> = {}): ConnectorMessage {
  return { channelId: 'c1', messageId: 7, metaDataId: 1, content: 'payload', dataType: 'RAW', ...overrides };
}

/** Variables that hold every name, and the names that were looked up. */
function recorded(): { readonly variables: Readonly<Record<string, unknown>>; readonly names: Set<string> } {
  const names = new Set<string>();
  const variables = new Proxy<Record<string, unknown>>({}, {
    getOwnPropertyDescriptor: (_target, name) => {
      names.add(String(name));
      return { value: 'v', configurable: true, enumerable: true, writable: true };
    },
    get: () => 'v',
  });
  return { variables, names };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('variableNames', () => {
  it('names each placeholder once, and none for an empty one', () => {
    expect(variableNames(['a ${x} ${ y }', '${x}${}', 'plain'])).toEqual(['x', 'y']);
  });
});

describe('variablesUsed names every variable that a send looks up', () => {
  const CASES: readonly (readonly [string, () => DestinationConnectorRuntime, readonly string[]])[] = [
    ['HTTP', (): DestinationConnectorRuntime => new HttpDispatcher({
      url: 'http://${host}.test/${path}', method: 'POST', contentType: 'text/plain', responseTimeout: 1_000,
      headers: { trace: '${trace}', fixed: 'x' }, parameters: { mrn: '${mrn}', fixed: 'x' }, basicAuth: { username: '${u}', password: '${p}' },
    }), ['host', 'path', 'trace', 'mrn']],
    ['Kafka', (): DestinationConnectorRuntime => new KafkaDispatcher({
      brokers: 'k:9092', clientId: '${c}', saslMechanism: 'NONE', saslUsername: '', saslPassword: '', topic: 't-${site}', messageKey: '${mrn}', headers: { trace: '${trace}' },
    }, () => new FakeKafkaProducer()), ['site', 'mrn', 'trace']],
    ['AMQP', (): DestinationConnectorRuntime => new AmqpDispatcher({
      host: 'r', port: 5672, vhost: '/', username: 'u', password: 'p', exchange: '${e}', routingKey: 'adt.${site}', headers: { trace: '${trace}' }, contentType: 'text/plain',
    }, async () => new FakeAmqpPublisher()), ['site', 'trace']],
    ['SMTP', (): DestinationConnectorRuntime => new SmtpDispatcher({
      host: 'h', port: 25, secure: false, requireTLS: false, from: '${from}', to: '${to}', cc: '${cc}', bcc: '${bcc}',
      subject: '${subject} ${messageId} ${from}', bodyTemplate: '${msg} ${body} ${channelId} ${metaDataId}', contentType: 'text/plain', attachContent: true,
      attachments: [{ filename: '${file}', content: '${attached} ${msg}', mimeType: '${m}' }],
    }, () => ({ sendMail: async () => ({ messageId: 'x', accepted: ['a'], rejected: [] }), close: () => undefined })), ['from', 'to', 'cc', 'bcc', 'subject', 'body', 'file', 'attached']],
    // A built-in name of the templates is a variable in an address.
    ['SMTP addresses', (): DestinationConnectorRuntime => new SmtpDispatcher({
      host: 'h', port: 25, secure: false, requireTLS: false, from: 'a@b', to: '${messageId}@b', cc: '', bcc: '', subject: '${messageId}', bodyTemplate: '', contentType: 'text/plain', attachContent: false,
    }, () => ({ sendMail: async () => ({ messageId: 'x', accepted: ['a'], rejected: [] }), close: () => undefined })), ['messageId']],
    ['Channel', (): DestinationConnectorRuntime => new ChannelDispatcher({ targetChannelId: '${target}', waitForResponse: false }), ['target']],
  ];

  it.each(CASES)('%s', async (_name, create, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
    const connector = create();
    expect((await connector.onStart()).ok).toBe(true);
    const { variables, names } = recorded();

    expect((await connector.send(message({ variables }), signal())).ok).toBe(true);

    expect([...names].sort()).toEqual([...expected].sort());
    expect([...connector.variablesUsed(message())].sort()).toEqual([...expected].sort());
  });

  describe('Database', () => {
    const QUERY = 'INSERT INTO t VALUES (${mrn}, ${name}, ${content}, ${messageId}, ${channelId}, ${metaDataId}, ${dataType}, ${mrn}, ${dob})';
    const queryNames = ['mrn', 'name', 'content', 'messageId', 'channelId', 'metaDataId', 'dataType', 'mrn', 'dob'];

    /** The connector, and the names its query bound no value for when the message has no variables. */
    async function sent(content: string): Promise<{ readonly connector: DatabaseDispatcher; readonly unbound: readonly string[] }> {
      const params: unknown[] = [];
      const pool = {
        create: async () => ({ ok: true, value: undefined, error: null }),
        query: async (_sql: string, values: readonly unknown[]) => { params.push(...values); return { ok: true, value: { rows: [], rowCount: 1 }, error: null }; },
      } as unknown as DatabasePool;
      const config: DatabaseDispatcherConfig = {
        host: 'h', port: 1, database: 'd', username: 'u', password: 'p', query: QUERY, useTransaction: false, returnGeneratedKeys: false, vendor: DATABASE_VENDOR.MYSQL,
      };
      const connector = new DatabaseDispatcher(config, pool);
      await connector.onStart();
      expect((await connector.send(message({ content }), signal())).ok).toBe(true);
      expect(params).toHaveLength(queryNames.length);
      return { connector, unbound: [...new Set(queryNames.filter((_name, index) => params[index] === undefined))] };
    }

    it.each([
      ['text content', 'payload', ['mrn', 'name', 'dob']],
      ['JSON content that holds some of them', '{"name":"A","dob":null}', ['mrn']],
      ['JSON content that is a list', '["mrn"]', ['mrn', 'name', 'dob']],
    ])('%s', async (_what, content, expected) => {
      const { connector, unbound } = await sent(content);
      expect(connector.variablesUsed(message({ content }))).toEqual(expected);
      expect(unbound).toEqual(expected);
      expect(connector.variablesUsed(message({ content, variables: { mrn: '1' } }))).toEqual(expected);
    });

    it('a query without placeholders uses none', () => {
      const connector = createDestinationConnector('DATABASE', { host: 'h', port: 5432, database: 'd', username: 'u', password: 'p', query: 'SELECT 1' });
      expect(connector.variablesUsed(message())).toEqual([]);
    });
  });

  describe('JavaScript', () => {
    const runner = async (): Promise<{ ok: true; value: string; error: null }> => ({ ok: true, value: '', error: null });

    it('is what the engine found its script to read', () => {
      const connector = new JavaScriptDispatcher({ script: 'return $c("mrn");' });
      connector.setScriptRunner(runner, ['$c']);
      expect(connector.variablesUsed()).toEqual(['$c']);
      connector.setScriptRunner(runner, []);
      expect(connector.variablesUsed()).toEqual([]);
    });

    it('may be any when the engine did not say', () => {
      const connector = new JavaScriptDispatcher({ script: 'return 1;' });
      connector.setScriptRunner(runner);
      expect(connector.variablesUsed()).not.toEqual([]);
    });
  });
});

describe('every dispatcher', () => {
  const src = new URL('../', import.meta.url);
  const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((file) => /-dispatcher\.ts$/.test(file));

  it('is looked at', () => {
    expect(files).toHaveLength(12);
  });

  it.each(files)('%s names variables if it reads them', (file) => {
    const source = readFileSync(new URL(file.replaceAll('\\', '/'), src), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const reads = /\bfillVariables\(|\bmessage\.variables\b|\bDestScriptRunner\b/.test(source);
    const namesNone = /variablesUsed\([^)]*\): readonly string\[\] \{\s*return \[\];/.test(source);
    expect(namesNone).toBe(!reads);
  });
});
