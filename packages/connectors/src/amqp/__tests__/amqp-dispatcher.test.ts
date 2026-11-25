import { describe, it, expect, vi } from 'vitest';
import type { ConnectorMessage } from '../../base.js';
import { AmqpDispatcher, type AmqpDispatcherConfig } from '../amqp-dispatcher.js';
import { connectOptions, socketOptions, type AmqpPublisherFactory } from '../amqp-client.js';
import { FakeAmqpPublisher } from '../../__fixtures__/fake-amqp.js';

const config: AmqpDispatcherConfig = {
  host: 'rabbit', port: 5672, vhost: '/', username: 'u', password: 'p',
  exchange: 'hl7', routingKey: 'adt', headers: {}, contentType: 'text/plain',
};

const message = (variables?: Record<string, unknown>): ConnectorMessage => ({
  channelId: 'c1', messageId: 7, metaDataId: 2, content: 'MSH|^~\\&|LAB', dataType: 'HL7V2', variables,
});
const signal = (): AbortSignal => new AbortController().signal;

function publishers(): { factory: AmqpPublisherFactory; made: FakeAmqpPublisher[]; failNext: number } {
  const state = { made: [] as FakeAmqpPublisher[], failNext: 0, factory: (async () => {
    if (state.failNext > 0) { state.failNext -= 1; throw new Error('ECONNREFUSED'); }
    const p = new FakeAmqpPublisher();
    state.made.push(p);
    return p;
  }) as AmqpPublisherFactory };
  return state;
}

async function started(overrides: Partial<AmqpDispatcherConfig> = {}) {
  const pubs = publishers();
  const dispatcher = new AmqpDispatcher({ ...config, ...overrides }, pubs.factory);
  expect((await dispatcher.onDeploy()).ok).toBe(true);
  expect((await dispatcher.onStart()).ok).toBe(true);
  return { dispatcher, pubs };
}

describe('onDeploy', () => {
  it('rejects the default exchange without a routing key', async () => {
    const result = await new AmqpDispatcher({ ...config, exchange: '', routingKey: '' }).onDeploy();
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('routing key');
  });

  it('rejects a missing host and a bad port', async () => {
    expect((await new AmqpDispatcher({ ...config, host: '' }).onDeploy()).ok).toBe(false);
    expect((await new AmqpDispatcher({ ...config, port: 0 }).onDeploy()).ok).toBe(false);
  });
});

describe('send', () => {
  it('publishes with a message id that stays the same across attempts', async () => {
    const { dispatcher, pubs } = await started();
    const result = await dispatcher.send(message(), signal());
    expect(result.ok && result.value.status).toBe('SENT');
    const sent = pubs.made[0]?.published[0];
    expect(sent).toMatchObject({ exchange: 'hl7', routingKey: 'adt', contentType: 'text/plain', messageId: 'c1:7:2' });
    expect(sent?.content.toString()).toBe('MSH|^~\\&|LAB');
  });

  it('fills the routing key and header values from the message variables', async () => {
    const { dispatcher, pubs } = await started({ routingKey: 'adt.${site}', headers: { patient: '${patientId}', fixed: 'x' } });
    await dispatcher.send(message({ site: 'north', patientId: 'P42' }), signal());
    expect(pubs.made[0]?.published[0]).toMatchObject({ routingKey: 'adt.north', headers: { patient: 'P42', fixed: 'x' } });
  });

  it('errors instead of publishing when the routing key names a variable the message lacks', async () => {
    const { dispatcher, pubs } = await started({ routingKey: 'adt.${site}' });
    const result = await dispatcher.send(message({}), signal());
    expect(result.ok && result.value.status).toBe('ERROR');
    expect(pubs.made).toHaveLength(0);
  });

  it('returns an error when the broker returns or refuses the message', async () => {
    const { dispatcher, pubs } = await started();
    await dispatcher.send(message(), signal());
    const publisher = pubs.made[0];
    if (!publisher) throw new Error('no publisher');
    publisher.failPublishes = 1;
    const result = await dispatcher.send(message(), signal());
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('returned the message');
    expect(pubs.made).toHaveLength(1);
  });

  it('reconnects on the next send after the connection is lost', async () => {
    const { dispatcher, pubs } = await started();
    await dispatcher.send(message(), signal());
    const first = pubs.made[0];
    if (!first) throw new Error('no publisher');
    first.failPublishes = 1;
    first.dropOnFail = true;
    expect((await dispatcher.send(message(), signal())).ok).toBe(false);
    const retried = await dispatcher.send(message(), signal());
    expect(retried.ok && retried.value.status).toBe('SENT');
    expect(pubs.made).toHaveLength(2);
    expect(pubs.made[1]?.published).toHaveLength(1);
  });

  it('returns an error when the broker cannot be reached, and connects on a later send', async () => {
    const { dispatcher, pubs } = await started();
    pubs.failNext = 1;
    expect((await dispatcher.send(message(), signal())).ok).toBe(false);
    expect((await dispatcher.send(message(), signal())).ok).toBe(true);
  });

  it.each([
    ['halt', 'onHalt', 2_000],
    ['stop', 'onStop', 10_000],
  ] as const)('a %s ends although the broker never lets the connection open, which is closed when it does (#413)', async (_what, action, withinMs) => {
    let connected = (publisher: FakeAmqpPublisher): void => { void publisher; };
    const dispatcher = new AmqpDispatcher(config, () => new Promise((resolve) => { connected = resolve; }));
    await dispatcher.onStart();
    vi.useFakeTimers();
    try {
      const sending = dispatcher.send(message(), AbortSignal.abort());
      expect((await sending).ok).toBe(false);
      const controller = new AbortController();
      const hanging = dispatcher.send(message(), controller.signal);
      controller.abort();
      expect((await hanging).ok).toBe(false);

      const ending = dispatcher[action]();
      await vi.advanceTimersByTimeAsync(withinMs);
      expect((await ending).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    const late = new FakeAmqpPublisher();
    connected(late);
    await vi.waitFor(() => { expect(late.closed).toBe(true); });
    expect(late.published).toEqual([]);
  });

  it('a send left over from before a halt does not close the connection of the next start', async () => {
    const { dispatcher, pubs } = await started();
    const first = { fail: (err: Error): void => { void err; } };
    await dispatcher.send(message(), signal());
    const old = pubs.made[0]!;
    vi.spyOn(old, 'publish').mockReturnValue(new Promise((_resolve, reject) => { first.fail = reject; }));
    const leftOver = dispatcher.send(message(), signal());
    await Promise.resolve();
    await dispatcher.onHalt();
    await dispatcher.onStart();
    expect((await dispatcher.send(message(), signal())).ok).toBe(true);

    first.fail(new Error('Channel closed'));

    expect((await leftOver).ok).toBe(false);
    expect(pubs.made).toHaveLength(2);
    expect(pubs.made[1]?.closed).toBe(false);
  });

  it('refuses to send before start, after stop and with an aborted signal', async () => {
    expect((await new AmqpDispatcher(config, publishers().factory).send(message(), signal())).ok).toBe(false);
    const { dispatcher, pubs } = await started();
    const aborted = new AbortController();
    aborted.abort();
    expect((await dispatcher.send(message(), aborted.signal)).ok).toBe(false);
    await dispatcher.send(message(), signal());
    await dispatcher.onStop();
    expect(pubs.made[0]?.closed).toBe(true);
    expect((await dispatcher.send(message(), signal())).ok).toBe(false);
  });
});

describe('connection options', () => {
  it('uses amqp without TLS and keeps credentials out of a URL', () => {
    expect(connectOptions({ ...config })).toEqual({ protocol: 'amqp', hostname: 'rabbit', port: 5672, vhost: '/', heartbeat: 30, username: 'u', password: 'p' });
    expect(socketOptions({ ...config })).toEqual({ timeout: 30_000, clientProperties: { connection_name: 'galvanigraph' } });
  });

  it('leaves out credentials when no username is set', () => {
    expect(connectOptions({ ...config, username: '' })).not.toHaveProperty('username');
  });

  it('uses amqps with TLS, verifying the broker unless switched off', () => {
    const tls = { ca: 'CA-PEM', cert: 'CERT', key: 'KEY' };
    expect(connectOptions({ ...config, tls }).protocol).toBe('amqps');
    expect(socketOptions({ ...config, tls })).toMatchObject({
      servername: 'rabbit', rejectUnauthorized: true, ca: ['CA-PEM'], cert: 'CERT', key: 'KEY',
    });
    expect(socketOptions({ ...config, tls: { rejectUnauthorized: false } })).toMatchObject({ rejectUnauthorized: false });
    expect(socketOptions({ ...config, tls: { rejectUnauthorized: false } })).not.toHaveProperty('ca');
  });
});
