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
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.maxFrameBytes) {
      this.reset();
      throw new Error(
        `MLLP frame exceeds maximum size of ${String(this.maxFrameBytes)} bytes`,
      );
    }
    const results: string[] = [];

    let offset = 0;
    while (offset < this.buffer.length) {
      if (!this.inFrame) {
        // Look for start byte
        const vtIndex = this.buffer.indexOf(VT, offset);
        if (vtIndex === -1) {
          // No start byte found, discard everything
          offset = this.buffer.length;
          break;
        }
        this.inFrame = true;
        offset = vtIndex + 1;
      }

      if (this.inFrame) {
        // Look for end sequence: FS + CR
        const fsIndex = this.buffer.indexOf(FS, offset);
        if (fsIndex === -1) {
          // Incomplete frame, keep buffer from current position
          break;
        }

        // Verify CR follows FS
        if (fsIndex + 1 >= this.buffer.length) {
          // Need more data to confirm CR
          break;
        }

        if (this.buffer[fsIndex + 1] !== CR) {
          // FS without CR — skip past FS and continue searching
          offset = fsIndex + 1;
          continue;
        }

        // Complete frame found
        const payload = this.buffer.subarray(offset, fsIndex).toString(this.charset);
        results.push(payload);
        this.inFrame = false;
        offset = fsIndex + 2; // Skip past FS + CR
      }
    }

    // Keep unprocessed bytes
    if (offset >= this.buffer.length) {
      this.buffer = Buffer.alloc(0);
    } else {
      this.buffer = Buffer.from(this.buffer.subarray(offset));
    }

    return results;
  }

  /** Reset parser state. */
  reset(): void {
    this.buffer = Buffer.alloc(0);
    this.inFrame = false;
  }
}
