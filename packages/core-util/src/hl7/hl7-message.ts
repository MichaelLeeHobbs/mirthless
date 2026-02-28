// ===========================================
// HL7v2 Message Parser
// ===========================================
// Core parser: parse, get, set, delete, toString.
// Uses a nested numeric-indexed internal representation
// proven from the reference implementation.

import { type Hl7Encoding, detectEncoding, encodingCharsString } from './hl7-encoding.js';
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
    if (!raw.startsWith('MSH')) {
      throw new Error('HL7 message must start with MSH');
    }

    const encoding = detectEncoding(raw);
    const segmentLines = raw.split(encoding.segmentSep).filter((s) => s.length > 0);
    const segments: SegmentData[] = [];

    for (const line of segmentLines) {
      segments.push(parseSegment(line, encoding));
    }

    return new Hl7Message(segments, encoding);
  }

  // ----- Get -----

  /** Get a value at the given HL7 path. Returns undefined if not found. */
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

  // ----- Set -----

  /** Set a value at the given HL7 path. Creates intermediate levels as needed. */
  set(path: string, value: string): void {
    const p = parsePath(path, false);

    // Ensure segment exists
    let segment = this.findSegment(p.segment, p.segmentIndex);
    if (!segment) {
      segment = { '0': p.segment };
      this.segments.push(segment);
    }

    if (p.field === undefined) return;

    // Resolve indices with defaults for set (auto-resolve=false means some may be undefined)
    const fieldKey = String(p.field);
    const repKey = String(p.fieldRepetition ?? 1);
    const compKey = String(p.component ?? 1);
    const subKey = String(p.subComponent ?? 1);

    if (!segment[fieldKey]) segment[fieldKey] = {};
    const fieldObj = segment[fieldKey] as Record<string, unknown>;

    if (!fieldObj[repKey]) fieldObj[repKey] = {};
    const repObj = fieldObj[repKey] as Record<string, unknown>;

    if (!repObj[compKey]) repObj[compKey] = {};
    const compObj = repObj[compKey] as Record<string, unknown>;

    compObj[subKey] = value;
  }

  // ----- Delete -----

  /** Delete a value or segment at the given HL7 path. */
  delete(path: string): void {
    const p = parsePath(path, true);

    if (p.field === undefined) {
      // Delete entire segment
      const idx = this.findSegmentIndex(p.segment, p.segmentIndex);
      if (idx !== -1) {
        this.segments.splice(idx, 1);
      }
      return;
    }

    const segment = this.findSegment(p.segment, p.segmentIndex);
    if (!segment) return;

    if (p.fieldRepetition === undefined || p.component === undefined || p.subComponent === undefined) {
      // Delete at field level
      delete segment[String(p.field)];
      return;
    }

    const fieldObj = segment[String(p.field)] as Record<string, unknown> | undefined;
    if (!fieldObj) return;

    const repObj = fieldObj[String(p.fieldRepetition)] as Record<string, unknown> | undefined;
    if (!repObj) return;

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
  fields.shift(); // Remove encoding chars field

  const result: SegmentData = { '0': 'MSH' };

  // MSH.1 = field separator
  result['1'] = { '1': { '1': { '1': enc.fieldSep } } };
  // MSH.2 = encoding characters
  result['2'] = { '1': { '1': { '1': encodingCharsString(enc) } } };

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
      // MSH.2 is the encoding characters string
      parts.push(encodingCharsString(enc));
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
