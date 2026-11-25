// MLLP frames a message as <VT>message<FS><CR> (0x0B + payload + 0x1C 0x0D).
// Some partners frame with other bytes (STX/ETX, Mirth's "Basic" mode), so the
// start and end bytes can be set.

import { DEFAULT_MAX_FRAME_BYTES } from '@galvanigraph/core-models';

export interface Framing {
  /** Bytes before each message; may be empty (the message starts right after the previous end). */
  readonly start: Buffer;
  /** Bytes after each message; never empty, or a frame could never end. */
  readonly end: Buffer;
}

export const MLLP_FRAMING: Framing = { start: Buffer.from([0x0b]), end: Buffer.from([0x1c, 0x0d]) };

/** Mirth's start/end-of-message hex (e.g. "0B", "1C0D"); absent values keep MLLP's. */
export function framingFromHex(startHex: string | undefined, endHex: string | undefined): Framing {
  const parse = (hex: string, what: string): Buffer => {
    const clean = hex.replace(/\s+/g, '');
    if (!/^([0-9a-fA-F]{2})*$/.test(clean)) throw new Error(`${what} bytes must be hex pairs, got "${hex}"`);
    return Buffer.from(clean, 'hex');
  };
  const start = startHex === undefined ? MLLP_FRAMING.start : parse(startHex, 'Start of message');
  const end = endHex === undefined ? MLLP_FRAMING.end : parse(endHex, 'End of message');
  if (end.length === 0) throw new Error('End of message bytes cannot be empty');
  return { start, end };
}

export { DEFAULT_MAX_FRAME_BYTES };

export function wrapMllp(message: string, charset: BufferEncoding = 'utf-8', framing: Framing = MLLP_FRAMING): Buffer {
  return Buffer.concat([framing.start, Buffer.from(message, charset), framing.end]);
}

export class MllpParser {
  private buffer: Buffer = Buffer.alloc(0);
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private inFrame = false;
  private readonly maxFrameBytes: number;
  private readonly charset: BufferEncoding;
  private readonly framing: Framing;
  /** The last bytes received, so end bytes split across chunks are seen. */
  private tail: Buffer = Buffer.alloc(0);

  /** A message longer than `maxFrameBytes` makes the parser reset and throw, so the caller can close the connection (DoS guard). */
  constructor(options?: { maxFrameBytes?: number; charset?: BufferEncoding; framing?: Framing }) {
    this.maxFrameBytes = options?.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.charset = options?.charset ?? 'utf-8';
    this.framing = options?.framing ?? MLLP_FRAMING;
  }

  parse(chunk: Buffer): readonly string[] {
    // A frame can only end in a chunk that completes the end bytes. Set any
    // other chunk in the middle of a frame aside instead of joining it to the
    // buffer now: joining on every chunk copies the whole frame each time.
    // Checking for the last end byte alone is not enough: MLLP's is CR, which
    // ends every HL7 segment.
    const canComplete = !this.inFrame || this.completesEnd(chunk);
    this.rememberTail(chunk);
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    if (!canComplete) {
      this.limitUnfinishedFrame();
      return [];
    }

    this.buffer = Buffer.concat([this.buffer, ...this.pending]);
    this.pending = [];
    this.pendingBytes = 0;
    const results: string[] = [];

    // `start` is where the unread data begins: the first payload byte when in
    // a frame. It only moves when a frame completes, so end bytes that only
    // partly appear inside a payload cost nothing of the payload.
    let start = 0;
    while (start < this.buffer.length) {
      if (!this.inFrame) {
        const begin = this.frameStart(start);
        if (begin === -1) {
          // No start bytes: nothing here belongs to a frame, except possibly
          // the first bytes of a multi-byte start the next chunk completes.
          start = Math.max(start, this.buffer.length - (this.framing.start.length - 1));
          break;
        }
        this.inFrame = true;
        start = begin;
      }

      const end = this.buffer.indexOf(this.framing.end, start);
      if (end === -1) break;

      if (end - start > this.maxFrameBytes) this.refuseFrame();
      results.push(this.buffer.subarray(start, end).toString(this.charset));
      this.inFrame = false;
      start = end + this.framing.end.length;
    }

    this.buffer = start >= this.buffer.length ? Buffer.alloc(0) : Buffer.from(this.buffer.subarray(start));
    this.limitUnfinishedFrame();

    return results;
  }

  private limitUnfinishedFrame(): void {
    // Its last bytes may be the first of the end bytes, which are not the message's.
    const limit = this.maxFrameBytes + this.framing.end.length - 1;
    if (this.inFrame && this.buffer.length + this.pendingBytes > limit) this.refuseFrame();
  }

  private refuseFrame(): never {
    this.reset();
    throw new Error(`MLLP frame exceeds maximum size of ${String(this.maxFrameBytes)} bytes`);
  }

  private completesEnd(chunk: Buffer): boolean {
    const end = this.framing.end;
    if (chunk.includes(end)) return true;
    if (this.tail.length === 0) return false;
    return Buffer.concat([this.tail, chunk.subarray(0, end.length - 1)]).includes(end);
  }

  /** End length - 1 is the most of the end bytes that can precede a chunk. */
  private rememberTail(chunk: Buffer): void {
    const keep = this.framing.end.length - 1;
    if (keep === 0) return;
    const joined = chunk.length >= keep ? chunk : Buffer.concat([this.tail, chunk]);
    this.tail = Buffer.from(joined.subarray(Math.max(0, joined.length - keep)));
  }

  /** The index after the start bytes (where the payload begins), not of the start bytes. */
  private frameStart(from: number): number {
    if (this.framing.start.length === 0) return from;
    const index = this.buffer.indexOf(this.framing.start, from);
    return index === -1 ? -1 : index + this.framing.start.length;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.pendingBytes = 0;
    this.tail = Buffer.alloc(0);
    this.inFrame = false;
  }
}
