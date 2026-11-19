// Plain objects with closures, not class instances: private fields break across the vm realm.

import { Hl7Message, createAck, type AckOptions } from '@galvanigraph/core-util';
import { isHl7MessageProxy, createHl7Proxy } from '../pipeline/data-type-handler.js';
import { isAllowedHost, isBlockedHostname } from './ssrf.js';

export interface Hl7MessageProxy {
  get(path: string): string | undefined;
  /** Everything at a path as encoded in the message: the whole field, repetition or component. */
  getRaw(path: string): string | undefined;
  /** The decoded text at a path (escape sequences resolved). */
  getText(path: string): string | undefined;
  set(path: string, value: string): void;
  /** Store free text at a path, encoding every delimiter. */
  setText(path: string, value: string): void;
  delete(path: string): void;
  toString(): string;
  readonly messageType: string;
  readonly messageControlId: string;
  getSegmentCount(name: string): number;
  getSegmentString(name: string, index?: number): string | undefined;
}

export interface HttpFetchOptions {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeout?: number;
}

export interface HttpFetchResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface RouteMessageResult {
  readonly success: boolean;
  readonly messageId?: number;
  readonly filtered?: boolean;
  readonly response?: string;
}

export type CollectionScalar = string | number | boolean;

/** Dates are ISO strings across the bridge. */
export interface CollectionRecordData {
  readonly id: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly payload: string | null;
  readonly expireAt: string | null;
  readonly createdAt: string;
}

export interface CollectionStoreOptions {
  readonly expireAt?: string;
  readonly ttlSeconds?: number;
}

export interface CollectionFindOptions {
  readonly filter?: Readonly<Record<string, CollectionScalar | ReadonlyArray<CollectionScalar>>>;
  readonly latest?: boolean;
  readonly limit?: number;
  readonly order?: 'asc' | 'desc';
}

/** Only the keys given change; expireAt null = never. */
export interface CollectionUpdateChanges {
  readonly fields?: Readonly<Record<string, CollectionScalar>>;
  readonly payload?: string;
  readonly expireAt?: string | null;
}

export interface CollectionBridge {
  readonly store: (
    name: string,
    fields: Readonly<Record<string, CollectionScalar>>,
    payload: string,
    options: CollectionStoreOptions,
  ) => Promise<CollectionRecordData>;
  readonly find: (
    name: string,
    match: Readonly<Record<string, CollectionScalar>>,
    options: CollectionFindOptions,
  ) => Promise<readonly CollectionRecordData[]>;
  readonly update: (name: string, id: string, changes: CollectionUpdateChanges) => Promise<CollectionRecordData | null>;
  /** False when the record no longer exists. */
  readonly delete: (name: string, id: string) => Promise<boolean>;
}

export interface BridgeDependencies {
  readonly httpFetch?: (url: string, options: HttpFetchOptions) => Promise<HttpFetchResult>;
  /** Hosts scripts may reach although their address is private. */
  readonly httpAllowedHosts?: ReadonlyArray<string>;
  readonly dbQuery?: (dataSourceName: string, sql: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
  readonly routeMessage?: (channelName: string, rawData: string) => Promise<RouteMessageResult>;
  readonly getResource?: (name: string) => Promise<string | null>;
  readonly collections?: CollectionBridge;
}

export interface BridgeFunctions {
  readonly parseHL7: (raw: string) => Hl7MessageProxy;
  readonly createACK: (originalRaw: string, ackCode: string, textMessage?: string) => string;
  readonly httpFetch?: (url: string, options?: HttpFetchOptions) => Promise<HttpFetchResult>;
  readonly dbQuery?: (dataSourceName: string, sql: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
  readonly routeMessage?: (channelName: string, rawData: string) => Promise<RouteMessageResult>;
  readonly getResource?: (name: string) => Promise<string | null>;
  readonly collections?: CollectionBridge;
}

export function createBridgeFunctions(deps?: BridgeDependencies): BridgeFunctions {
  const bridges: BridgeFunctions = {
    parseHL7(raw: unknown): Hl7MessageProxy {
      // msg may already be a proxy: data-type-handler auto-parses HL7.
      if (isHl7MessageProxy(raw)) return raw;
      if (typeof raw !== 'string') throw new Error('parseHL7 expects a string or HL7 message proxy');
      const msg = Hl7Message.parse(raw);
      return createHl7Proxy(msg);
    },

    createACK(originalRaw: string, ackCode: string, textMessage?: string): string {
      const original = Hl7Message.parse(originalRaw);
      const options: AckOptions = {
        ackCode: ackCode as AckOptions['ackCode'],
      };
      if (textMessage !== undefined) {
        return createAck(original, { ...options, textMessage });
      }
      return createAck(original, options);
    },

    ...(deps?.httpFetch ? {
      httpFetch: async (url: string, options?: HttpFetchOptions): Promise<HttpFetchResult> => {
        const parsed = new URL(url);
        if (!isAllowedHost(parsed.hostname, deps.httpAllowedHosts) && isBlockedHostname(parsed.hostname)) {
          throw new Error(`SSRF blocked: requests to ${parsed.hostname} are not allowed`);
        }
        return deps.httpFetch!(url, options ?? {});
      },
    } : {}),

    ...(deps?.dbQuery ? {
      dbQuery: async (dataSourceName: string, sql: string, params?: readonly unknown[]): Promise<readonly Record<string, unknown>[]> => {
        return deps.dbQuery!(dataSourceName, sql, params ?? []);
      },
    } : {}),

    ...(deps?.routeMessage ? {
      routeMessage: async (channelName: string, rawData: string): Promise<RouteMessageResult> => {
        return deps.routeMessage!(channelName, rawData);
      },
    } : {}),

    ...(deps?.getResource ? {
      getResource: async (name: string): Promise<string | null> => {
        return deps.getResource!(name);
      },
    } : {}),

    ...(deps?.collections ? { collections: deps.collections } : {}),
  };

  return bridges;
}
