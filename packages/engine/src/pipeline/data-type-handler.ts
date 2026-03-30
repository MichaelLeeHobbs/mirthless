// ===========================================
// Data Type Handler
// ===========================================
// Parse raw string content into sandbox-friendly objects based on data type,
// and serialize sandbox results back to strings for storage/transport.

import { Hl7Message } from '@mirthless/core-util';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { Hl7MessageProxy } from '../sandbox/bridge-functions.js';

const HL7_PROXY_BRAND = '__hl7Proxy';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseTagValue: true,
  trimValues: true,
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
});

/** Type guard: is this value an Hl7MessageProxy created by createHl7Proxy? */
export function isHl7MessageProxy(value: unknown): value is Hl7MessageProxy {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>)[HL7_PROXY_BRAND] === true;
}

/** Create a closure-based Hl7MessageProxy from an Hl7Message instance. */
export function createHl7Proxy(msg: Hl7Message): Hl7MessageProxy {
  const proxy: Hl7MessageProxy & Record<string, unknown> = {
    [HL7_PROXY_BRAND]: true,
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
  return proxy;
}

/**
 * Parse raw string content into a sandbox-friendly object based on data type.
 * Throws on malformed content for typed data types (HL7V2, JSON, XML).
 */
export function parseForSandbox(content: string, dataType: string): unknown {
  switch (dataType) {
    case 'HL7V2': {
      const parsed = Hl7Message.parse(content);
      return createHl7Proxy(parsed);
    }
    case 'JSON': {
      return JSON.parse(content) as unknown;
    }
    case 'XML': {
      return xmlParser.parse(content) as unknown;
    }
    // RAW, HL7V3, DICOM, DELIMITED, FHIR — pass through as string
    default:
      return content;
  }
}

/**
 * Serialize a sandbox result back to a string for storage/transport.
 * Handles strings (pass-through), HL7 proxies (.toString()), and objects (JSON.stringify).
 */
export function serializeFromSandbox(value: unknown, dataType: string): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (isHl7MessageProxy(value)) return value.toString();
  if (dataType === 'XML' && typeof value === 'object') {
    return xmlBuilder.build(value) as string;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
