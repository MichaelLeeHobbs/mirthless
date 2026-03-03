// ===========================================
// HL7v2 Message Generator
// ===========================================
// Generates realistic HL7v2 messages for testing.
// Uses seeded PRNG for deterministic output.

import { Hl7Message } from './hl7-message.js';
import { formatTimestamp } from './hl7-timestamp.js';
import {
  MESSAGE_TYPES,
  type HL7MessageType,
  FIRST_NAMES,
  LAST_NAMES,
  SEX_CODES,
  PATIENT_CLASS_CODES,
  FACILITY_NAMES,
  ROOM_NAMES,
  BED_NAMES,
  ORDER_CODES,
  ORDER_NAMES,
  OBX_IDENTIFIERS,
  OBX_NAMES,
  OBX_VALUE_TYPES,
  DOCTOR_NAMES,
} from './hl7-code-tables.js';

// ----- Types -----

export interface GenerateOptions {
  readonly messageType: HL7MessageType;
  readonly count?: number;
  readonly seed?: number;
}

// ----- Seeded PRNG (mulberry32) -----

function createPrng(seed: number): () => number {
  let state = seed | 0;
  return (): number => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

// ----- Helpers -----

function generateRandomDigits(rng: () => number, length: number): string {
  let id = '';
  for (let i = 0; i < length; i++) {
    id += String(Math.floor(rng() * 10));
  }
  return id;
}

function generateDob(rng: () => number): string {
  const year = 1940 + Math.floor(rng() * 60);
  const month = String(1 + Math.floor(rng() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(rng() * 28)).padStart(2, '0');
  return `${String(year)}${month}${day}`;
}

// ----- Build MSH -----

function buildMsh(msgDef: typeof MESSAGE_TYPES[HL7MessageType], rng: () => number, timestamp: string): string {
  const sendFac = pick(FACILITY_NAMES, rng);
  const recvFac = pick(FACILITY_NAMES, rng);
  const controlId = generateRandomDigits(rng, 10);
  const parts = [
    'MSH',
    '^~\\&',
    'MIRTHLESS',
    sendFac,
    'RECEIVER',
    recvFac,
    timestamp,
    '',
    `${msgDef.type}^${msgDef.trigger}`,
    controlId,
    'P',
    '2.5.1',
  ];
  return parts.join('|');
}

// ----- Build segments -----

function buildEvn(timestamp: string): string {
  return `EVN||${timestamp}`;
}

function buildPid(rng: () => number): string {
  const patId = generateRandomDigits(rng, 8);
  const lastName = pick(LAST_NAMES, rng);
  const firstName = pick(FIRST_NAMES, rng);
  const dob = generateDob(rng);
  const sex = pick(SEX_CODES, rng);
  const parts = [
    'PID', '', '', patId, '',
    `${lastName}^${firstName}`, '', dob, sex,
  ];
  return parts.join('|');
}

function buildPv1(rng: () => number): string {
  const patClass = pick(PATIENT_CLASS_CODES, rng);
  const room = pick(ROOM_NAMES, rng);
  const bed = pick(BED_NAMES, rng);
  const doctor = pick(DOCTOR_NAMES, rng);
  const parts = [
    'PV1', '', patClass,
    `${room}^${bed}`, '', '', '',
    doctor,
  ];
  return parts.join('|');
}

function buildOrc(rng: () => number, timestamp: string): string {
  const orderId = generateRandomDigits(rng, 10);
  return `ORC|NW|${orderId}|||CM|||||||${pick(DOCTOR_NAMES, rng)}|||${timestamp}`;
}

function buildObr(rng: () => number, timestamp: string): string {
  const idx = Math.floor(rng() * ORDER_CODES.length);
  const code = ORDER_CODES[idx]!;
  const name = ORDER_NAMES[idx]!;
  return `OBR|1|||${code}^${name}|||${timestamp}`;
}

function buildObx(rng: () => number): string {
  const idx = Math.floor(rng() * OBX_IDENTIFIERS.length);
  const id = OBX_IDENTIFIERS[idx]!;
  const name = OBX_NAMES[idx]!;
  const valType = pick(OBX_VALUE_TYPES, rng);
  const value = valType === 'NM' ? String(Math.floor(rng() * 200)) : name;
  return `OBX|1|${valType}|${id}^${name}||${value}||||||F`;
}

function buildSch(rng: () => number, timestamp: string): string {
  const apptId = generateRandomDigits(rng, 10);
  return `SCH|${apptId}||||ROUTINE|||||30|MIN|||||${pick(DOCTOR_NAMES, rng)}|||BOOKED|||${timestamp}`;
}

function buildAig(rng: () => number): string {
  const doctor = pick(DOCTOR_NAMES, rng);
  return `AIG|1||${doctor}|DOCTOR`;
}

// ----- Build message -----

function buildSegment(name: string, rng: () => number, timestamp: string): string {
  switch (name) {
    case 'EVN': return buildEvn(timestamp);
    case 'PID': return buildPid(rng);
    case 'PV1': return buildPv1(rng);
    case 'ORC': return buildOrc(rng, timestamp);
    case 'OBR': return buildObr(rng, timestamp);
    case 'OBX': return buildObx(rng);
    case 'SCH': return buildSch(rng, timestamp);
    case 'AIG': return buildAig(rng);
    default: return name;
  }
}

/**
 * Generate one or more HL7v2 messages.
 * Returns an array of HL7 message strings.
 */
export function generateHL7Messages(options: GenerateOptions): readonly string[] {
  const count = Math.min(Math.max(options.count ?? 1, 1), 100);
  const seed = options.seed ?? Date.now();
  const rng = createPrng(seed);
  const msgDef = MESSAGE_TYPES[options.messageType];

  const results: string[] = [];
  const timestamp = formatTimestamp(new Date(2026, 0, 1, 0, 0, 0));
  for (let i = 0; i < count; i++) {
    const segmentStrings: string[] = [];

    for (const segName of msgDef.segments) {
      if (segName === 'MSH') {
        segmentStrings.push(buildMsh(msgDef, rng, timestamp));
      } else {
        segmentStrings.push(buildSegment(segName, rng, timestamp));
      }
    }

    const rawMessage = segmentStrings.join('\r');
    // Parse and re-serialize to validate the message
    const parsed = Hl7Message.parse(rawMessage);
    results.push(parsed.toString());
  }

  return results;
}
