// ===========================================
// Bridge Functions
// ===========================================
// Host-side functions exposed to sandbox scripts.
// Returns plain objects with closures to avoid cross-realm
// class instance issues with private fields.

import { Hl7Message, createAck, type AckOptions } from '@mirthless/core-util';
import { isHl7MessageProxy, createHl7Proxy } from '../pipeline/data-type-handler.js';

// ----- Types -----

/** Proxy object returned by parseHL7 — closures over host-side Hl7Message. */
export interface Hl7MessageProxy {
  get(path: string): string | undefined;
  set(path: string, value: string): void;
  delete(path: string): void;
  toString(): string;
  readonly messageType: string;
  readonly messageControlId: string;
  getSegmentCount(name: string): number;
  getSegmentString(name: string, index?: number): string | undefined;
}

/** Options for httpFetch bridge function. */
export interface HttpFetchOptions {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeout?: number;
}

/** Result from httpFetch bridge function. */
export interface HttpFetchResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Result from routeMessage bridge function. */
export interface RouteMessageResult {
  readonly success: boolean;
  readonly response?: string;
}

/** Host-side dependency callbacks for IO bridge functions. */
export interface BridgeDependencies {
  readonly httpFetch?: (url: string, options: HttpFetchOptions) => Promise<HttpFetchResult>;
  readonly dbQuery?: (driver: string, connectionUrl: string, sql: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
  readonly routeMessage?: (channelName: string, rawData: string) => Promise<RouteMessageResult>;
  readonly getResource?: (name: string) => Promise<string | null>;
}

/** Bridge functions available in the sandbox. */
export interface BridgeFunctions {
  readonly parseHL7: (raw: string) => Hl7MessageProxy;
  readonly createACK: (originalRaw: string, ackCode: string, textMessage?: string) => string;
  readonly httpFetch?: (url: string, options?: HttpFetchOptions) => Promise<HttpFetchResult>;
  readonly dbQuery?: (driver: string, connectionUrl: string, sql: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
  readonly routeMessage?: (channelName: string, rawData: string) => Promise<RouteMessageResult>;
  readonly getResource?: (name: string) => Promise<string | null>;
}

// ----- SSRF Protection -----

/** Private/reserved IP ranges that should be blocked for SSRF prevention. */
const BLOCKED_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fd/i,
  /^fe80:/i,
  /^localhost$/i,
] as const;

/** Check if a hostname resolves to a private IP range. */
function isBlockedHost(hostname: string): boolean {
  return BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(hostname));
}

// ----- Implementation -----

/** Create bridge functions for sandbox injection. */
export function createBridgeFunctions(deps?: BridgeDependencies): BridgeFunctions {
  const bridges: BridgeFunctions = {
    parseHL7(raw: unknown): Hl7MessageProxy {
      // If already an Hl7MessageProxy (auto-parsed by data-type-handler), return as-is
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
        if (isBlockedHost(parsed.hostname)) {
          throw new Error(`SSRF blocked: requests to ${parsed.hostname} are not allowed`);
        }
        return deps.httpFetch!(url, options ?? {});
      },
    } : {}),

    ...(deps?.dbQuery ? {
      dbQuery: async (driver: string, connectionUrl: string, sql: string, params?: readonly unknown[]): Promise<readonly Record<string, unknown>[]> => {
        return deps.dbQuery!(driver, connectionUrl, sql, params ?? []);
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
  };

  return bridges;
}
