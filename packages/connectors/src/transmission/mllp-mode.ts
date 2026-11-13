// ===========================================
// MLLP Transmission Mode
// ===========================================
// Framing for HL7 over TCP. MLLP frames a message as <VT>message<FS><CR>
// (0x0B + payload + 0x1C 0x0D). Some partners frame with other bytes (STX/ETX,
// Mirth's "Basic" mode), so the start and end bytes can be set.

// ----- Constants -----

/** The bytes around each message on the wire. */
export interface Framing {
  /** Bytes before each message; may be empty (the message starts right after the previous end). */
  readonly start: Buffer;
  /** Bytes after each message; never empty, or a frame could never end. */
  readonly end: Buffer;
}

/** MLLP: start VT (0x0B), end FS CR (0x1C 0x0D). */
export const MLLP_FRAMING: Framing = { start: Buffer.from([0x0b]), end: Buffer.from([0x1c, 0x0d]) };

/**
 * Framing from hex strings such as "0B" and "1C0D" (Mirth's start and end of
 * message bytes). Absent values keep MLLP's. Throws on text that is not whole
 * hex bytes or on an empty end, so a bad setting fails the deploy.
 */
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

/**
 * Default maximum frame size (bytes). Unauthenticated network input must be
 * bounded to prevent memory-exhaustion (DoS). 50 MiB comfortably exceeds any
 * realistic HL7v2 message while capping an attacker's ability to grow the
 * in-frame buffer without end.
 */
export const DEFAULT_MAX_FRAME_BYTES = 50 * 1024 * 1024;

// ----- Framing -----

/**
 * Wrap a message in its frame.
 * @param message - The message payload.
 * @param charset - Character encoding for the payload. Defaults to utf-8;
 *   latin1 (iso-8859-1) is common in real HL7 feeds with accented PHI.
 * @param framing - The frame bytes (default MLLP).
 */
export function wrapMllp(message: string, charset: BufferEncoding = 'utf-8', framing: Framing = MLLP_FRAMING): Buffer {
  return Buffer.concat([framing.start, Buffer.from(message, charset), framing.end]);
}

// ----- Parser -----

/**
 * Stateful frame parser.
 * Accumulates incoming TCP chunks and yields complete message payloads.
 * Handles frames split across multiple TCP packets.
 */
export class MllpParser {
  private buffer: Buffer = Buffer.alloc(0);
  /** Chunks of an unfinished frame that have not been joined to `buffer` yet. */
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private inFrame = false;
  private readonly maxFrameBytes: number;
  private readonly charset: BufferEncoding;
  private readonly framing: Framing;
  /** The last bytes received, so end bytes split across chunks are seen. */
  private tail: Buffer = Buffer.alloc(0);

  /**
   * @param options.maxFrameBytes - Hard cap on buffered bytes; on exceed the
   *   parser resets and throws so the caller can NAK/close (DoS guard).
   * @param options.charset - Payload decoding charset (default utf-8).
   * @param options.framing - The frame bytes (default MLLP).
   */
  constructor(options?: { maxFrameBytes?: number; charset?: BufferEncoding; framing?: Framing }) {
    this.maxFrameBytes = options?.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.charset = options?.charset ?? 'utf-8';
    this.framing = options?.framing ?? MLLP_FRAMING;
  }

  /**
   * Feed incoming data and return any complete messages extracted.
   * May return 0, 1, or multiple messages from a single chunk.
   * @throws Error when buffered data exceeds the configured max frame size.
   */
  parse(chunk: Buffer): readonly string[] {
    if (this.buffer.length + this.pendingBytes + chunk.length > this.maxFrameBytes) {
      this.reset();
      throw new Error(
        `MLLP frame exceeds maximum size of ${String(this.maxFrameBytes)} bytes`,
      );
    }
    // A frame can only end in a chunk that completes the end bytes. Set any
    // other chunk in the middle of a frame aside instead of joining it to the
    // buffer now: joining on every chunk copies the whole frame each time.
    // Checking for the last end byte alone is not enough: MLLP's is CR, which
    // ends every HL7 segment.
    const canComplete = !this.inFrame || this.completesEnd(chunk);
    this.rememberTail(chunk);
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    if (!canComplete) return [];

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
      if (end === -1) break; // incomplete frame: keep it for the next chunk

      results.push(this.buffer.subarray(start, end).toString(this.charset));
      this.inFrame = false;
      start = end + this.framing.end.length;
    }

    this.buffer = start >= this.buffer.length ? Buffer.alloc(0) : Buffer.from(this.buffer.subarray(start));

    return results;
  }

  /** Whether the end bytes appear in the chunk, or start in the bytes before it and finish in it. */
  private completesEnd(chunk: Buffer): boolean {
    const end = this.framing.end;
    if (chunk.includes(end)) return true;
    if (this.tail.length === 0) return false;
    return Buffer.concat([this.tail, chunk.subarray(0, end.length - 1)]).includes(end);
  }

  /** Keep the last (end length - 1) bytes received, the most of the end bytes that can precede a chunk. */
  private rememberTail(chunk: Buffer): void {
    const keep = this.framing.end.length - 1;
    if (keep === 0) return;
    const joined = chunk.length >= keep ? chunk : Buffer.concat([this.tail, chunk]);
    this.tail = Buffer.from(joined.subarray(joined.length - keep));
  }

  /** Where the payload of the next frame begins, or -1 when no frame starts in the buffer. */
  private frameStart(from: number): number {
    if (this.framing.start.length === 0) return from;
    const index = this.buffer.indexOf(this.framing.start, from);
    return index === -1 ? -1 : index + this.framing.start.length;
  }

  /** Reset parser state. */
  reset(): void {
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.pendingBytes = 0;
    this.tail = Buffer.alloc(0);
    this.inFrame = false;
  }
}
