// Server-side because the connectors package has no DB access. Connector props
// store certificate ids only, never inline PEM; the PEM `tls` bag built here
// uses exactly the keys readTlsServerOptions/readTlsClientOptions read. A missing
// id, or a certificate without the private key its role needs, is an error, so
// a channel never deploys (or a test passes) without the TLS it asked for.

import { tryCatch, type Result } from 'stderr-lib';
import { isPlainObject } from '@galvanigraph/core-util';
import { sql } from 'drizzle-orm';
import { ALL_CHANNELS, type FoldedGrants, type Permission } from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { db } from '../lib/db.js';
import { grantedChannels } from '../lib/channel-scope.js';

/** Error text for a stored `tls` value that is present but not a plain object (D-277). */
const TLS_NOT_AN_OBJECT = 'Connector tls settings must be an object';
import { CertificateService } from './certificate.service.js';

async function loadMaterial(
  id: string,
): Promise<{ certificatePem: string; privateKeyPem: string | null }> {
  const result = await CertificateService.getMaterialById(id);
  if (!result.ok) {
    throw new ServiceError('INVALID_INPUT', `Referenced certificate ${id} could not be resolved: ${result.error.message}`);
  }
  return result.value;
}

function readTlsBag(props: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const tls = props['tls'];
  if (tls === undefined || tls === null || tls === false) return {};
  if (!isPlainObject(tls)) throw new ServiceError('INVALID_INPUT', TLS_NOT_AN_OBJECT);
  return tls;
}

function optionalId(bag: Record<string, unknown>, key: string): string | undefined {
  const value = bag[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** A CA (`caCertId`) is public, so naming one is harmless. */
const PRIVATE_KEY_CERT_KEYS = ['clientCertId', 'serverCertId'] as const;

export function privateKeyCertificateIds(props: unknown): readonly string[] {
  if (!isPlainObject(props)) return [];
  const bag = readTlsBag(props);
  return [...new Set(PRIVATE_KEY_CERT_KEYS.map((k) => optionalId(bag, k)).filter((id): id is string => id !== undefined))];
}

/** Matched key by key on the parsed tls bag, so a certificate pinned as a CA does not count. */
export async function certificatesNotUsedBy(channelIds: readonly string[], certificateIds: readonly string[]): Promise<readonly string[]> {
  if (certificateIds.length === 0) return [];
  if (channelIds.length === 0) return certificateIds;
  const ids = sql.join(channelIds.map((id) => sql`${id}::uuid`), sql`, `);
  const used = await db.execute<{ props: unknown }>(sql`
    SELECT c.source_connector_properties AS props FROM channels c WHERE c.id IN (${ids}) AND c.deleted_at IS NULL
    UNION ALL
    SELECT cc.properties AS props FROM channel_connectors cc JOIN channels c ON c.id = cc.channel_id
      WHERE cc.channel_id IN (${ids}) AND c.deleted_at IS NULL
  `);
  const inUse = new Set<string>();
  for (const row of used.rows) {
    try {
      for (const id of privateKeyCertificateIds(row.props)) inUse.add(id);
    } catch {
      // A stored tls value that is not an object references no certificate.
    }
  }
  return certificateIds.filter((id) => !inUse.has(id));
}

/**
 * A writer or deployer holding `permission` on some groups only may put a
 * certificate's private key to use only where their channels already use it
 * (D-310): the store's keys could otherwise authenticate as another group's
 * client or listener. `connectorProps` are every connector's properties the
 * request would save or test. An all-channel holder passes.
 */
export async function assertCertificatesInScope(grants: FoldedGrants | undefined, permission: Permission, connectorProps: readonly unknown[]): Promise<void> {
  const scope = await grantedChannels(grants, permission);
  if (scope === ALL_CHANNELS) return;
  const wanted = [...new Set(connectorProps.flatMap((p) => privateKeyCertificateIds(p)))];
  const unused = await certificatesNotUsedBy(scope, wanted);
  if (unused.length > 0) {
    throw new ServiceError('FORBIDDEN', 'A client or server certificate can be used only where the channels in your access already use it');
  }
}

export async function resolveHttpDestinationTls(
  props: Readonly<Record<string, unknown>>,
): Promise<Result<Record<string, unknown>>> {
  return tryCatch(async () => (props['scheme'] === 'HTTPS' ? resolveClientTls(props) : { ...props }));
}

/** A Kafka or AMQP source and destination are both TLS clients of the broker. */
export async function resolveQueueTls(
  props: Readonly<Record<string, unknown>>,
): Promise<Result<Record<string, unknown>>> {
  return tryCatch(async () => (props['useTls'] === true ? resolveClientTls(props) : { ...props }));
}

async function resolveClientTls(props: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const bag = readTlsBag(props);
  const caCertId = optionalId(bag, 'caCertId');
  const clientCertId = optionalId(bag, 'clientCertId');
  const pemTls: Record<string, unknown> = { rejectUnauthorized: bag['rejectUnauthorized'] !== false };

  if (caCertId) {
    pemTls['ca'] = (await loadMaterial(caCertId)).certificatePem;
  }
  if (clientCertId) {
    const client = await loadMaterial(clientCertId);
    if (!client.privateKeyPem) {
      throw new ServiceError('INVALID_INPUT', `Client certificate ${clientCertId} has no private key; cannot use for mutual TLS`);
    }
    pemTls['cert'] = client.certificatePem;
    pemTls['key'] = client.privateKeyPem;
  }
  return { ...props, tls: pemTls };
}

export async function resolveHttpSourceTls(
  props: Readonly<Record<string, unknown>>,
): Promise<Result<Record<string, unknown>>> {
  return tryCatch(async () => {
    if (props['scheme'] !== 'HTTPS') {
      return { ...props };
    }
    const bag = readTlsBag(props);
    const serverCertId = optionalId(bag, 'serverCertId');
    if (!serverCertId) {
      throw new ServiceError('INVALID_INPUT', 'HTTPS source connector requires a serverCertId');
    }
    const server = await loadMaterial(serverCertId);
    if (!server.privateKeyPem) {
      throw new ServiceError('INVALID_INPUT', `Server certificate ${serverCertId} has no private key; cannot terminate TLS`);
    }
    const pemTls: Record<string, unknown> = {
      cert: server.certificatePem,
      key: server.privateKeyPem,
      requireClientCert: bag['requireClientCert'] === true,
    };
    const caCertId = optionalId(bag, 'caCertId');
    if (caCertId) {
      pemTls['ca'] = (await loadMaterial(caCertId)).certificatePem;
    }
    return { ...props, tls: pemTls };
  });
}
