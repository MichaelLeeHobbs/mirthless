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

// ----- Framing -----

/** Wrap a message in MLLP envelope. */
export function wrapMllp(message: string): Buffer {
  const payload = Buffer.from(message, 'utf-8');
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

  /**
   * Feed incoming data and return any complete messages extracted.
   * May return 0, 1, or multiple messages from a single chunk.
   */
  parse(chunk: Buffer): readonly string[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
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
        const payload = this.buffer.subarray(offset, fsIndex).toString('utf-8');
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
