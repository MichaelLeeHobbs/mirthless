// ===========================================
// Bridge Functions
// ===========================================
// Host-side HL7 functions exposed to sandbox scripts.
// Returns plain objects with closures to avoid cross-realm
// class instance issues with private fields.

import { Hl7Message, createAck, type AckOptions } from '@mirthless/core-util';

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

/** Bridge functions available in the sandbox. */
export interface BridgeFunctions {
  readonly parseHL7: (raw: string) => Hl7MessageProxy;
  readonly createACK: (originalRaw: string, ackCode: string, textMessage?: string) => string;
}

// ----- Implementation -----

/** Create bridge functions for sandbox injection. */
export function createBridgeFunctions(): BridgeFunctions {
  return {
    parseHL7(raw: string): Hl7MessageProxy {
      const msg = Hl7Message.parse(raw);

      return {
        get(path: string): string | undefined {
          return msg.get(path);
        },
        set(path: string, value: string): void {
          msg.set(path, value);
        },
        delete(path: string): void {
          msg.delete(path);
        },
        toString(): string {
          return msg.toString();
        },
        get messageType(): string {
          return msg.messageType;
        },
        get messageControlId(): string {
          return msg.messageControlId;
        },
        getSegmentCount(name: string): number {
          return msg.getSegmentCount(name);
        },
        getSegmentString(name: string, index?: number): string | undefined {
          return msg.getSegmentString(name, index);
        },
      };
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
  };
}
