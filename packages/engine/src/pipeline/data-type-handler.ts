// ===========================================
// Data Type Handler
// ===========================================
// Parse raw string content into sandbox-friendly objects based on data type,
// and serialize sandbox results back to strings for storage/transport.

import { Hl7Message } from '@galvaniflow/core-util';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { Hl7MessageProxy } from '../sandbox/bridge-functions.js';

const HL7_PROXY_BRAND = '__hl7Proxy';

// Inbound XML comes from the network, so entity expansion is explicitly bounded
// (billion-laughs / quadratic-blowup DoS). Standard entities (&amp; &lt; ...)
// still decode; DOCTYPE-declared entities are capped in count and expanded size.
//
// Element and attribute values are ALWAYS text. Nothing is converted to a number
// or boolean and nothing is trimmed: "000123" is an MRN, "02134" a ZIP code and
// "1.0" a dose, and turning them into 123, 2134 and 1 corrupts the message.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  // With trimming off, the indentation between child elements would show up as
  // text nodes. Drop text that is only whitespace unless it is an element's whole
  // content (a leaf), where the whitespace is the value.
  tagValueProcessor: (_name: string, value: string, _path: unknown, _hasAttributes: boolean, isLeaf: boolean): string =>
    (!isLeaf && value.trim() === '' ? '' : value),
  processEntities: {
    enabled: true,
    maxEntityCount: 100,
    maxEntitySize: 10_000,
    maxExpansionDepth: 10,
    maxTotalExpansions: 10_000,
    maxExpandedLength: 1_000_000,
  },
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

/**
 * Create a closure-based Hl7MessageProxy from an Hl7Message instance.
 * Uses explicit property descriptors to ensure all methods survive vm.createContext().
 */
export function createHl7Proxy(msg: Hl7Message): Hl7MessageProxy {
  // Build as a plain object with arrow-function properties.
  // Avoids getter/method-shorthand edge cases in V8 cross-realm contexts.
  const proxy: Record<string, unknown> = {
    [HL7_PROXY_BRAND]: true,
    get: (path: string): string | undefined => msg.get(path),
    set: (path: string, value: string): void => { msg.set(path, value); },
    delete: (path: string): void => { msg.delete(path); },
    toString: (): string => msg.toString(),
    messageType: msg.messageType,
    messageControlId: msg.messageControlId,
    getSegmentCount: (name: string): number => msg.getSegmentCount(name),
    getSegmentString: (name: string, index?: number): string | undefined => msg.getSegmentString(name, index),
  };
  return proxy as unknown as Hl7MessageProxy;
}

const NUMBER_LITERAL = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** Reduce a decimal literal to its significant digits and power of ten, so 1.50 and 1.5 compare equal. */
function significantDigits(literal: string): string | null {
  const match = NUMBER_LITERAL.exec(literal);
  if (!match) return null;
  const fraction = match[2] ?? '';
  const digits = ((match[1] ?? '') + fraction).replace(/^0+/, '');
  const kept = digits.replace(/0+$/, '');
  if (kept === '') return '0';
  const exponent = Number(match[3] ?? '0') - fraction.length + (digits.length - kept.length);
  return `${kept}e${String(exponent)}`;
}

/**
 * JSON.parse reviver. A number a double cannot hold exactly (an integer past
 * 2^53, a long decimal, a value that overflows) would silently change, so it is
 * kept as the text of its literal instead. Ordinary numbers stay numbers.
 */
function keepInexactNumbersAsText(_key: string, value: unknown, context?: { source?: string }): unknown {
  if (typeof value !== 'number' || context?.source === undefined) return value;
  const written = significantDigits(context.source);
  if (written !== null && Number.isFinite(value) && written === significantDigits(String(value))) return value;
  return context.source;
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
      return JSON.parse(content, keepInexactNumbersAsText) as unknown;
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

/**
 * Serialize a transformer's result, keeping the original text when the script
 * did not change the message.
 *
 * Parsing and re-serializing is not always an exact round trip (XML mixed
 * content and formatting, JSON number formatting), so a transformer that only
 * reads the message, for example to set a map value, must not rewrite it.
 */
export function serializeTransformed(value: unknown, original: string, dataType: string): string {
  const serialized = serializeFromSandbox(value, dataType);
  if (typeof value === 'string') return serialized;
  try {
    const untouched = serializeFromSandbox(parseForSandbox(original, dataType), dataType);
    return untouched === serialized ? original : serialized;
  } catch {
    // The original is not valid for this data type, so there is nothing to compare with.
    return serialized;
  }
}
