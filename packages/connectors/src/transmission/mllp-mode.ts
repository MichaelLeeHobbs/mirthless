// ===========================================
// MLLP Transmission Mode
// ===========================================
// Minimal Lower Layer Protocol framing for HL7 over TCP.
// Frame format: <VT>message<FS><CR> = 0x0B + payload + 0x1C + 0x0D

// ----- Constants -----

/** Start of MLLP frame: Vertical Tab (VT, 0x0B) */
const VT = 0x0B;

/** End of MLLP frame: File Separator (FS, 0x1C) */
const FS = 0x1C;

/** Carriage Return (CR, 0x0D) */
const CR = 0x0D;

/**
 * Default maximum frame size (bytes). Unauthenticated network input must be
 * bounded to prevent memory-exhaustion (DoS). 50 MiB comfortably exceeds any
 * realistic HL7v2 message while capping an attacker's ability to grow the
 * in-frame buffer without end.
 */
export const DEFAULT_MAX_FRAME_BYTES = 50 * 1024 * 1024;

// ----- Framing -----

/**
 * Wrap a message in an MLLP envelope.
 * @param message - The message payload.
 * @param charset - Character encoding for the payload. Defaults to utf-8;
 *   latin1 (iso-8859-1) is common in real HL7 feeds with accented PHI.
 */
export function wrapMllp(message: string, charset: BufferEncoding = 'utf-8'): Buffer {
  const payload = Buffer.from(message, charset);
  const frame = Buffer.allocUnsafe(payload.length + 3);
  frame[0] = VT;
  payload.copy(frame, 1);
  frame[payload.length + 1] = FS;
  frame[payload.length + 2] = CR;
  return frame;
}

// ----- Parser -----

/**
 * Stateful MLLP frame parser.
 * Accumulates incoming TCP chunks and yields complete message payloads.
 * Handles frames split across multiple TCP packets.
 */
export class MllpParser {
  private buffer: Buffer = Buffer.alloc(0);
  /** Chunks of an unfinished frame that have not been joined to `buffer` yet. */
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  /** The last byte received was FS, so the next byte decides if the frame ended. */
  private endsWithFs = false;
  private inFrame = false;
  private readonly maxFrameBytes: number;
  private readonly charset: BufferEncoding;

  /**
   * @param options.maxFrameBytes - Hard cap on buffered bytes; on exceed the
   *   parser resets and throws so the caller can NAK/close (DoS guard).
   * @param options.charset - Payload decoding charset (default utf-8).
   */
  constructor(options?: { maxFrameBytes?: number; charset?: BufferEncoding }) {
    this.maxFrameBytes = options?.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.charset = options?.charset ?? 'utf-8';
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
    // A chunk in the middle of a frame cannot complete it unless it holds the
    // end byte (or follows one). Set it aside instead of joining it to the
    // buffer now: joining on every chunk copies the whole frame each time.
    const canComplete = !this.inFrame || this.endsWithFs || chunk.includes(FS);
    if (chunk.length > 0) this.endsWithFs = chunk[chunk.length - 1] === FS;
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    if (!canComplete) return [];

    this.buffer = Buffer.concat([this.buffer, ...this.pending]);
    this.pending = [];
    this.pendingBytes = 0;
    const results: string[] = [];

    // `start` is where the unread data begins: the first payload byte when in
    // a frame. It only moves when a frame completes, so a file separator inside
    // a payload (one not followed by CR) costs nothing of the payload.
    let start = 0;
    while (start < this.buffer.length) {
      if (!this.inFrame) {
        const vtIndex = this.buffer.indexOf(VT, start);
        if (vtIndex === -1) {
          // No start byte: nothing here belongs to a frame.
          start = this.buffer.length;
          break;
        }
        this.inFrame = true;
        start = vtIndex + 1;
      }

      const end = this.findFrameEnd(start);
      if (end === -1) break; // incomplete frame: keep it for the next chunk

      results.push(this.buffer.subarray(start, end).toString(this.charset));
      this.inFrame = false;
      start = end + 2; // past FS + CR
    }

    this.buffer = start >= this.buffer.length ? Buffer.alloc(0) : Buffer.from(this.buffer.subarray(start));
    this.endsWithFs = this.buffer.length > 0 && this.buffer[this.buffer.length - 1] === FS;

    return results;
  }

  /** Index of the FS that ends the frame starting at `from` (the FS followed by CR), or -1. */
  private findFrameEnd(from: number): number {
    let fsIndex = this.buffer.indexOf(FS, from);
    while (fsIndex !== -1) {
      if (fsIndex + 1 >= this.buffer.length) return -1; // need the next byte to know
      if (this.buffer[fsIndex + 1] === CR) return fsIndex;
      fsIndex = this.buffer.indexOf(FS, fsIndex + 1);
    }
    return -1;
  }

  /** Reset parser state. */
  reset(): void {
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.pendingBytes = 0;
    this.endsWithFs = false;
    this.inFrame = false;
  }
}
