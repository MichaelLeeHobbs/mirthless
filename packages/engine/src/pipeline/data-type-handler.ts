import { Hl7Message, X12Message, parseDelimited, serializeDelimited } from '@galvanigraph/core-util';
import { delimitedOptionsSchema, type DelimitedOptions } from '@galvanigraph/core-models';
import { XMLParser } from 'fast-xml-parser';
import { buildXmlInOriginalOrder } from './xml-order.js';
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

export function isHl7MessageProxy(value: unknown): value is Hl7MessageProxy {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>)[HL7_PROXY_BRAND] === true;
}

/**
 * Create a closure-based Hl7MessageProxy from an Hl7Message instance.
 * Uses explicit property descriptors to ensure all methods survive vm.createContext().
 */
export function createHl7Proxy(msg: Hl7Message): Hl7MessageProxy {
  // The type and control id are getters so they follow a script's edits to MSH.
  const proxy: Record<string, unknown> = {
    [HL7_PROXY_BRAND]: true,
    get: (path: string): string | undefined => msg.get(path),
    getRaw: (path: string): string | undefined => msg.getRaw(path),
    getText: (path: string): string | undefined => msg.getText(path),
    set: (path: string, value: string): void => { msg.set(path, value); },
    setText: (path: string, value: string): void => { msg.setText(path, value); },
    delete: (path: string): void => { msg.delete(path); },
    toString: (): string => msg.toString(),
    get messageType(): string { return msg.messageType; },
    get messageControlId(): string { return msg.messageControlId; },
    getSegmentCount: (name: string): number => msg.getSegmentCount(name),
    getSegmentString: (name: string, index?: number): string | undefined => msg.getSegmentString(name, index),
  };
  return proxy as unknown as Hl7MessageProxy;
}

const X12_PROXY_BRAND = '__x12Proxy';

export interface X12MessageProxy {
  get(path: string): string | undefined;
  set(path: string, value: string): void;
  delete(path: string): void;
  getSegmentCount(id: string): number;
  toString(): string;
}

export function isX12MessageProxy(value: unknown): value is X12MessageProxy {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>)[X12_PROXY_BRAND] === true;
}

/** A plain object of closures over the host-side X12Message, so it survives the sandbox boundary. */
export function createX12Proxy(msg: X12Message): X12MessageProxy {
  const proxy: Record<string, unknown> = {
    [X12_PROXY_BRAND]: true,
    get: (path: string): string | undefined => msg.get(path),
    set: (path: string, value: string): void => { msg.set(path, value); },
    delete: (path: string): void => { msg.delete(path); },
    getSegmentCount: (id: string): number => msg.getSegmentCount(id),
    toString: (): string => msg.toString(),
  };
  return proxy as unknown as X12MessageProxy;
}

const NUMBER_LITERAL =/^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

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

class NumberLiteral {
  constructor(readonly text: string, readonly seen: unknown) {}
}

/** `JSON.rawJSON` (Node 22+): emit text as it stands inside JSON.stringify output. */
const rawJson = (JSON as unknown as { rawJSON(text: string): unknown }).rawJSON;

/** Undefined when `original` is not JSON. */
function parseNumberLiterals(original: string): unknown {
  try {
    return JSON.parse(original, function (this: unknown, key: string, value: unknown, context?: { source?: string }): unknown {
      if (typeof value !== 'number' || context?.source === undefined) return value;
      return new NumberLiteral(context.source, keepInexactNumbersAsText(key, value, context));
    }) as unknown;
  } catch {
    return undefined;
  }
}

function childOf(source: unknown, key: string | number): unknown {
  if (source === null || typeof source !== 'object' || source instanceof NumberLiteral) return undefined;
  return Object.hasOwn(source, key) ? (source as Record<string | number, unknown>)[key] : undefined;
}

function put(holder: object, key: string | number, value: unknown): void {
  Object.defineProperty(holder, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * A number the script left alone (the same path still holds what it was given)
 * is written exactly as in the original: `1.50` stays `1.50`, and an integer past
 * 2^53, which scripts see as text, goes back out as a number. A number the script
 * changed, moved or added is written as JSON.stringify writes it.
 */
function stringifyJsonKeepingNumbers(value: unknown, original: string): string {
  const literals = parseNumberLiterals(original);
  if (literals === undefined) return JSON.stringify(value);
  const out: { root?: unknown } = {};
  const stack: Array<{ holder: object; key: string | number; edited: unknown; source: unknown }> = [
    { holder: out, key: 'root', edited: value, source: literals },
  ];
  while (stack.length > 0) {
    const { holder, key, edited, source } = stack.pop()!;
    if (source instanceof NumberLiteral && edited === source.seen) {
      put(holder, key, rawJson(source.text));
    } else if (Array.isArray(edited)) {
      const copy: unknown[] = new Array<unknown>(edited.length);
      put(holder, key, copy);
      edited.forEach((item, index) => { stack.push({ holder: copy, key: index, edited: item, source: childOf(source, index) }); });
    } else if (edited !== null && typeof edited === 'object') {
      const copy = {};
      put(holder, key, copy);
      // Reverse, so keys are added to the copy in their original order.
      for (const name of Object.keys(edited).reverse()) {
        stack.push({ holder: copy, key: name, edited: (edited as Record<string, unknown>)[name], source: childOf(source, name) });
      }
    } else {
      put(holder, key, edited);
    }
  }
  return JSON.stringify(out.root);
}

export interface DataTypeOptions {
  readonly delimited?: DelimitedOptions | undefined;
}

const DEFAULT_DELIMITED = delimitedOptionsSchema.parse({});

/** Throws on malformed content for typed data types (HL7V2, JSON, XML, DELIMITED, X12). */
export function parseForSandbox(content: string, dataType: string, options?: DataTypeOptions): unknown {
  switch (dataType) {
    case 'DELIMITED':
      return parseDelimited(content, options?.delimited ?? DEFAULT_DELIMITED);
    case 'X12':
      return createX12Proxy(X12Message.parse(content));
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
    default:
      return content;
  }
}

function parseXmlOrUndefined(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return xmlParser.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * @param original - The text the value was parsed from. For XML the output keeps
 *   its element order, comments and whitespace; for JSON the spelling of every
 *   number the script left alone.
 */
export function serializeFromSandbox(value: unknown, dataType: string, original?: string, options?: DataTypeOptions): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (isHl7MessageProxy(value) || isX12MessageProxy(value)) return value.toString();
  if (dataType === 'DELIMITED' && typeof value === 'object') {
    return serializeDelimited(value, options?.delimited ?? DEFAULT_DELIMITED);
  }
  if (dataType === 'XML' && typeof value === 'object') {
    return buildXmlInOriginalOrder(value, parseXmlOrUndefined(original), original);
  }
  if (dataType === 'JSON' && typeof value === 'object' && original !== undefined) {
    return stringifyJsonKeepingNumbers(value, original);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Keeps the original text when the script did not change the message: parsing
 * and re-serializing is not an exact round trip (XML entity and empty-element
 * spelling, JSON number formatting), so a transformer that only reads the
 * message must not rewrite it.
 */
export function serializeTransformed(value: unknown, original: string, dataType: string, options?: DataTypeOptions): string {
  const serialized = serializeFromSandbox(value, dataType, original, options);
  if (typeof value === 'string') return serialized;
  try {
    const untouched = serializeFromSandbox(parseForSandbox(original, dataType, options), dataType, original, options);
    return untouched === serialized ? original : serialized;
  } catch {
    // The original is not valid for this data type, so there is nothing to compare with.
    return serialized;
  }
}
