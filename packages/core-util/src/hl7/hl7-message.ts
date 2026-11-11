// ===========================================
// HL7v2 Message Parser
// ===========================================
// Core parser: parse, get, set, delete, toString.
// Uses a nested numeric-indexed internal representation
// proven from the reference implementation.

import {
  type Hl7Encoding, detectEncoding, encodingCharsString, splitSegments, escapeValue, unescapeValue, escapeStructural,
} from './hl7-encoding.js';
import { parsePath } from './hl7-path.js';

// ----- Internal types -----

/** Nested record: field → repetition → component → subComponent → value */
type SegmentData = Record<string, unknown>;

// ----- Hl7Message -----

export class Hl7Message {
  private readonly segments: SegmentData[];
  private readonly _encoding: Hl7Encoding;

  private constructor(segments: SegmentData[], encoding: Hl7Encoding) {
    this.segments = segments;
    this._encoding = encoding;
  }

  /** The detected encoding characters. */
  get encoding(): Hl7Encoding {
    return this._encoding;
  }

  /** MSH.9 message type (e.g. 'ADT^A01'). */
  get messageType(): string {
    return this.get('MSH.9') ?? '';
  }

  /** MSH.10 message control ID. */
  get messageControlId(): string {
    return this.get('MSH.10') ?? '';
  }

  // ----- Parse -----

  /** Parse an HL7v2 message string into an Hl7Message. */
  static parse(raw: string): Hl7Message {
    if (!raw || typeof raw !== 'string') {
      throw new Error('HL7 message must be a non-empty string');
    }
    // A byte order mark or blank lines before the header are not part of the message.
    const text = raw.replace(/^\s+/, '');
    if (!text.startsWith('MSH')) {
      throw new Error('HL7 message must start with MSH');
    }

    const encoding = detectEncoding(text);
    const segmentLines = splitSegments(text, encoding);
    const segments: SegmentData[] = [];

    for (const line of segmentLines) {
      segments.push(parseSegment(line, encoding));
    }

    return new Hl7Message(segments, encoding);
  }

  // ----- Get -----

  /**
   * Get a value at the given HL7 path, as it is encoded in the message (escape
   * sequences such as `\\T\\` are not decoded). Returns undefined if not found.
   * A path that stops above a single value returns the FIRST value below it:
   * `PID.5` on `DOE^JOHN` is `DOE`, `PID.3` on `1^^^MRN~2^^^SSN` is `1`. Use
   * {@link getRaw} for everything at that depth and {@link getText} to read free text.
   */
  get(path: string): string | undefined {
    const p = parsePath(path, true);

    const segment = this.findSegment(p.segment, p.segmentIndex);
    if (!segment) return undefined;
    if (p.field === undefined) return undefined;

    const fieldObj = segment[String(p.field)] as Record<string, unknown> | undefined;
    if (!fieldObj) return undefined;
    if (p.fieldRepetition === undefined) return asString(fieldObj);

    const repObj = fieldObj[String(p.fieldRepetition)] as Record<string, unknown> | undefined;
    if (!repObj) return undefined;
    if (p.component === undefined) return asString(repObj);

    const compObj = repObj[String(p.component)] as Record<string, unknown> | undefined;
    if (!compObj) return undefined;
    if (p.subComponent === undefined) return asString(compObj);

    const value = compObj[String(p.subComponent)];
    return asString(value);
  }

  /** Get the decoded text at a path: escape sequences become the characters they stand for. */
  getText(path: string): string | undefined {
    const raw = this.get(path);
    return raw === undefined ? undefined : unescapeValue(raw, this._encoding);
  }

  /**
   * Get everything at the given path as it is encoded in the message, at the
   * depth the path names: `PID.5` is the whole field with every repetition and
   * component (`DOE^JOHN~ROE^JANE`), `PID.3[2]` one repetition, `PID.5.2` one
   * component with its subcomponents. {@link get} returns only the first value.
   */
  getRaw(path: string): string | undefined {
    const p = parsePath(path, false);
    const segment = this.findSegment(p.segment, p.segmentIndex);
    if (!segment) return undefined;
    if (p.field === undefined) return serializeSegment(segment, this._encoding);
    if (p.segment === 'MSH' && p.field <= 2) return asString(segment[String(p.field)]);

    const fieldObj = segment[String(p.field)] as Record<string, unknown> | undefined;
    if (!fieldObj) return undefined;
    if (p.fieldRepetition === undefined) return serializeFieldRepetitions(fieldObj, this._encoding);

    const repObj = fieldObj[String(p.fieldRepetition)] as Record<string, unknown> | undefined;
    if (!repObj) return undefined;
    if (p.component === undefined) return serializeComponents(repObj, this._encoding);

    const compObj = repObj[String(p.component)] as Record<string, string> | undefined;
    if (!compObj) return undefined;
    if (p.subComponent === undefined) return serializeSubComponents(compObj, this._encoding);
    return compObj[String(p.subComponent)];
  }

  // ----- Set -----

  /**
   * Replace whatever the path names with the value, at the depth it names:
   * `PID.5` replaces the whole field (every repetition and component),
   * `PID.3[2]` one repetition, `PID.5.2` one component and `PID.5.2.1` one
   * subcomponent. Nothing that was there before is left behind. Missing
   * levels above the path are created.
   *
   * Component, repetition and subcomponent separators in the value are kept,
   * so a composite can be set in one call (`set('OBX.3', 'CODE^Text')`). A
   * field separator or line break is always encoded: it can never be part of a
   * value and would otherwise add fields or segments to the message. Use
   * {@link setText} to store free text.
   */
  set(path: string, value: string): void {
    const p = parsePath(path, false);
    const isDelimiterField = p.segment === 'MSH' && p.field !== undefined && p.field <= 2;
    if (isDelimiterField) {
      this.segmentFor(p)[String(p.field)] = { '1': { '1': { '1': value } } };
      return;
    }
    this.store(p, escapeStructural(value, this._encoding));
  }

  /** Replace whatever the path names with free text, encoding every delimiter so it stays one value. */
  setText(path: string, value: string): void {
    this.store(parsePath(path, false), escapeValue(value, this._encoding));
  }

  private segmentFor(p: ReturnType<typeof parsePath>): SegmentData {
    let segment = this.findSegment(p.segment, p.segmentIndex);
    if (!segment) {
      segment = { '0': p.segment };
      this.segments.push(segment);
    }
    return segment;
  }

  /** Replace the node the path names with the parsed value. */
  private store(p: ReturnType<typeof parsePath>, value: string): void {
    const segment = this.segmentFor(p);
    if (p.field === undefined) return;
    const enc = this._encoding;

    const fieldKey = String(p.field);
    if (p.fieldRepetition === undefined) {
      segment[fieldKey] = parseFieldRepetitions(value, enc);
      return;
    }
    if (!segment[fieldKey]) segment[fieldKey] = {};
    const fieldObj = segment[fieldKey] as Record<string, unknown>;

    const repKey = String(p.fieldRepetition);
    if (p.component === undefined) {
      fieldObj[repKey] = parseComponents(value, enc);
      return;
    }
    if (!fieldObj[repKey]) fieldObj[repKey] = {};
    const repObj = fieldObj[repKey] as Record<string, unknown>;

    const compKey = String(p.component);
    if (p.subComponent === undefined) {
      repObj[compKey] = parseSubComponents(value, enc);
      return;
    }
    if (!repObj[compKey]) repObj[compKey] = {};
    (repObj[compKey] as Record<string, unknown>)[String(p.subComponent)] = value;
  }

  // ----- Delete -----

  /**
   * Delete whatever the path names, at the depth it names: `PID` removes the
   * segment, `PID.5` the whole field with every repetition and component,
   * `PID.3[2]` one repetition, `PID.5.2` one component and `PID.5.2.1` one
   * subcomponent. Nothing below the named level is left behind.
   */
  delete(path: string): void {
    // No auto-resolve: the indices the caller left out say how much to delete.
    const p = parsePath(path, false);

    if (p.field === undefined) {
      const idx = this.findSegmentIndex(p.segment, p.segmentIndex);
      if (idx !== -1) {
        this.segments.splice(idx, 1);
      }
      return;
    }

    const segment = this.findSegment(p.segment, p.segmentIndex);
    if (!segment) return;

    if (p.fieldRepetition === undefined) {
      delete segment[String(p.field)];
      return;
    }

    const fieldObj = segment[String(p.field)] as Record<string, unknown> | undefined;
    if (!fieldObj) return;
    if (p.component === undefined) {
      delete fieldObj[String(p.fieldRepetition)];
      return;
    }

    const repObj = fieldObj[String(p.fieldRepetition)] as Record<string, unknown> | undefined;
    if (!repObj) return;
    if (p.subComponent === undefined) {
      delete repObj[String(p.component)];
      return;
    }

    const compObj = repObj[String(p.component)] as Record<string, unknown> | undefined;
    if (!compObj) return;
    delete compObj[String(p.subComponent)];
  }

  // ----- Segment queries -----

  /** Get a full segment as a string. */
  getSegmentString(name: string, index = 1): string | undefined {
    const segment = this.findSegment(name, index);
    if (!segment) return undefined;
    return serializeSegment(segment, this._encoding);
  }

  /** Count segments of the given type. */
  getSegmentCount(name: string): number {
    let count = 0;
    for (const seg of this.segments) {
      if (seg['0'] === name) count++;
    }
    return count;
  }

  // ----- Serialize -----

  /** Serialize the message back to HL7 wire format. */
  toString(): string {
    return this.segments
      .map((seg) => serializeSegment(seg, this._encoding))
      .join(this._encoding.segmentSep);
  }

  // ----- Helpers -----

  private findSegment(name: string, index: number): SegmentData | undefined {
    let count = 0;
    for (const seg of this.segments) {
      if (seg['0'] === name) {
        count++;
        if (count === index) return seg;
      }
    }
    return undefined;
  }

  private findSegmentIndex(name: string, index: number): number {
    let count = 0;
    for (let i = 0; i < this.segments.length; i++) {
      if (this.segments[i]!['0'] === name) {
        count++;
        if (count === index) return i;
      }
    }
    return -1;
  }
}

// ----- Parsing helpers -----

function parseSegment(line: string, enc: Hl7Encoding): SegmentData {
  if (line.startsWith('MSH')) {
    return parseMshSegment(line, enc);
  }
  const fields = line.split(enc.fieldSep);
  const name = fields.shift() ?? '';
  const result: SegmentData = { '0': name };

  for (let i = 0; i < fields.length; i++) {
    const fieldStr = fields[i]!;
    if (fieldStr === '') continue;
    result[String(i + 1)] = parseFieldRepetitions(fieldStr, enc);
  }

  return result;
}

function parseMshSegment(line: string, enc: Hl7Encoding): SegmentData {
  const fields = line.split(enc.fieldSep);
  fields.shift(); // Remove 'MSH'

  const result: SegmentData = { '0': 'MSH' };

  // MSH.1 = field separator
  result['1'] = { '1': { '1': { '1': enc.fieldSep } } };
  // MSH.2 = encoding characters, kept as sent: HL7 2.7 adds a fifth
  // (truncation) character after the four delimiters.
  const encodingField = fields.shift() ?? encodingCharsString(enc);
  result['2'] = { '1': { '1': { '1': encodingField } } };

  // Remaining fields start at index 3 (offset 2)
  for (let i = 0; i < fields.length; i++) {
    const fieldStr = fields[i]!;
    if (fieldStr === '') continue;
    result[String(i + 3)] = parseFieldRepetitions(fieldStr, enc);
  }

  return result;
}

function parseFieldRepetitions(fieldStr: string, enc: Hl7Encoding): Record<string, unknown> {
  const repetitions = fieldStr.split(enc.repetitionSep);
  const result: Record<string, unknown> = {};
  for (let i = 0; i < repetitions.length; i++) {
    result[String(i + 1)] = parseComponents(repetitions[i]!, enc);
  }
  return result;
}

function parseComponents(fieldStr: string, enc: Hl7Encoding): Record<string, unknown> {
  const components = fieldStr.split(enc.componentSep);
  const result: Record<string, unknown> = {};
  for (let i = 0; i < components.length; i++) {
    result[String(i + 1)] = parseSubComponents(components[i]!, enc);
  }
  return result;
}

function parseSubComponents(compStr: string, enc: Hl7Encoding): Record<string, string> {
  const subs = compStr.split(enc.subComponentSep);
  const result: Record<string, string> = {};
  for (let i = 0; i < subs.length; i++) {
    result[String(i + 1)] = subs[i]!;
  }
  return result;
}

// ----- Serialization helpers -----

function serializeSegment(segment: SegmentData, enc: Hl7Encoding): string {
  const name = segment['0'] as string;
  const isMsh = name === 'MSH';

  // Collect all numeric keys and find the max
  const keys: number[] = [];
  for (const k of Object.keys(segment)) {
    if (k === '0') continue;
    const n = parseInt(k, 10);
    if (!isNaN(n)) keys.push(n);
  }
  if (keys.length === 0) return name;

  const maxField = Math.max(...keys);
  const startField = isMsh ? 1 : 1;
  const parts: string[] = [name];

  for (let f = startField; f <= maxField; f++) {
    if (isMsh && f === 1) {
      // MSH.1 is the field separator itself — already used as the join char
      continue;
    }
    if (isMsh && f === 2) {
      // MSH.2 is the encoding characters string, as parsed or set
      parts.push(asString(segment['2']) ?? encodingCharsString(enc));
      continue;
    }
    const fieldObj = segment[String(f)] as Record<string, unknown> | undefined;
    if (!fieldObj) {
      parts.push('');
      continue;
    }
    parts.push(serializeFieldRepetitions(fieldObj, enc));
  }

  return parts.join(enc.fieldSep);
}

function serializeFieldRepetitions(fieldObj: Record<string, unknown>, enc: Hl7Encoding): string {
  const keys = numericKeys(fieldObj);
  if (keys.length === 0) return '';
  const maxRep = Math.max(...keys);
  const reps: string[] = [];
  for (let r = 1; r <= maxRep; r++) {
    const repObj = fieldObj[String(r)] as Record<string, unknown> | undefined;
    reps.push(repObj ? serializeComponents(repObj, enc) : '');
  }
  return reps.join(enc.repetitionSep);
}

function serializeComponents(repObj: Record<string, unknown>, enc: Hl7Encoding): string {
  const keys = numericKeys(repObj);
  if (keys.length === 0) return '';
  const maxComp = Math.max(...keys);
  const comps: string[] = [];
  for (let c = 1; c <= maxComp; c++) {
    const compObj = repObj[String(c)] as Record<string, string> | undefined;
    comps.push(compObj ? serializeSubComponents(compObj, enc) : '');
  }
  // Trim trailing empty components
  while (comps.length > 1 && comps[comps.length - 1] === '') {
    comps.pop();
  }
  return comps.join(enc.componentSep);
}

function serializeSubComponents(compObj: Record<string, string>, enc: Hl7Encoding): string {
  const keys = numericKeys(compObj);
  if (keys.length === 0) return '';
  const maxSub = Math.max(...keys);
  const subs: string[] = [];
  for (let s = 1; s <= maxSub; s++) {
    subs.push(compObj[String(s)] ?? '');
  }
  // Trim trailing empty subcomponents
  while (subs.length > 1 && subs[subs.length - 1] === '') {
    subs.pop();
  }
  return subs.join(enc.subComponentSep);
}

function numericKeys(obj: Record<string, unknown>): number[] {
  const keys: number[] = [];
  for (const k of Object.keys(obj)) {
    const n = parseInt(k, 10);
    if (!isNaN(n) && n > 0) keys.push(n);
  }
  return keys;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return undefined;
  // For nested objects, drill down to '1' keys until we hit a string
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const first = obj['1'];
    if (first !== undefined) return asString(first);
  }
  return undefined;
}
