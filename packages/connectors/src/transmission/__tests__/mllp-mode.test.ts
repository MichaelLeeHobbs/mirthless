// ===========================================
// MLLP Mode Tests
// ===========================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { wrapMllp, MllpParser, DEFAULT_MAX_FRAME_BYTES, framingFromHex } from '../mllp-mode.js';

const VT = 0x0B;
const FS = 0x1C;
const CR = 0x0D;

describe('custom framing', () => {
  const stxEtx = framingFromHex('02', '03');

  it('wraps and parses STX/ETX frames, split across chunks, with ETX the only end byte', () => {
    const frame = wrapMllp('MSH|A', 'utf-8', stxEtx);
    expect([...frame]).toEqual([0x02, ...Buffer.from('MSH|A'), 0x03]);
    const parser = new MllpParser({ framing: stxEtx });
    expect(parser.parse(Buffer.concat([frame.subarray(0, 3)]))).toEqual([]);
    expect(parser.parse(Buffer.concat([frame.subarray(3), wrapMllp('MSH|B', 'utf-8', stxEtx)]))).toEqual(['MSH|A', 'MSH|B']);
  });

  it('frames with no start bytes take everything up to the end bytes', () => {
    const parser = new MllpParser({ framing: framingFromHex('', '0D0A') });
    expect(parser.parse(Buffer.from('one\r\ntwo\r\nthr'))).toEqual(['one', 'two']);
    expect(parser.parse(Buffer.from('ee\r\n'))).toEqual(['three']);
  });

  it('finds a multi-byte start split across two chunks', () => {
    const parser = new MllpParser({ framing: framingFromHex('0B0B', '1C0D') });
    expect(parser.parse(Buffer.from([0x41, 0x0b]))).toEqual([]);
    expect(parser.parse(Buffer.from([0x0b, 0x58, 0x1c, 0x0d]))).toEqual(['X']);
  });

  it('refuses frame bytes that are not hex pairs, or an empty end', () => {
    expect(() => framingFromHex('0', '03')).toThrow('hex pairs');
    expect(() => framingFromHex('02', 'ZZ')).toThrow('hex pairs');
    expect(() => framingFromHex('02', '')).toThrow('cannot be empty');
  });

  it('keeps MLLP bytes for a side not given', () => {
    expect(framingFromHex(undefined, undefined)).toEqual({ start: Buffer.from([VT]), end: Buffer.from([FS, CR]) });
  });
});

describe('wrapMllp', () => {
  it('wraps message in MLLP envelope', () => {
    const frame = wrapMllp('MSH|^~\\&|');

    expect(frame[0]).toBe(VT);
    expect(frame[frame.length - 2]).toBe(FS);
    expect(frame[frame.length - 1]).toBe(CR);
    expect(frame.subarray(1, frame.length - 2).toString('utf-8')).toBe('MSH|^~\\&|');
  });

  it('produces correct byte length', () => {
    const msg = 'Hello';
    const frame = wrapMllp(msg);

    // VT + payload + FS + CR
    expect(frame.length).toBe(msg.length + 3);
  });

  it('handles empty message', () => {
    const frame = wrapMllp('');

    expect(frame.length).toBe(3);
    expect(frame[0]).toBe(VT);
    expect(frame[1]).toBe(FS);
    expect(frame[2]).toBe(CR);
  });
});

describe('MllpParser', () => {
  let parser: MllpParser;

  beforeEach(() => {
    parser = new MllpParser();
  });

  it('parses a single complete MLLP frame', () => {
    const frame = wrapMllp('MSH|^~\\&|SENDER');

    const messages = parser.parse(frame);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe('MSH|^~\\&|SENDER');
  });

  it('parses multiple messages in one chunk', () => {
    const frame1 = wrapMllp('MSG1');
    const frame2 = wrapMllp('MSG2');
    const combined = Buffer.concat([frame1, frame2]);

    const messages = parser.parse(combined);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe('MSG1');
    expect(messages[1]).toBe('MSG2');
  });

  it('handles frame split across two TCP packets', () => {
    const frame = wrapMllp('SPLIT_MESSAGE');
    const mid = Math.floor(frame.length / 2);

    const part1 = frame.subarray(0, mid);
    const part2 = frame.subarray(mid);

    const msgs1 = parser.parse(part1);
    expect(msgs1).toHaveLength(0);

    const msgs2 = parser.parse(part2);
    expect(msgs2).toHaveLength(1);
    expect(msgs2[0]).toBe('SPLIT_MESSAGE');
  });

  it('handles split at FS boundary (FS arrives without CR)', () => {
    const frame = wrapMllp('BOUNDARY');
    // Split right between FS and CR
    const splitPoint = frame.length - 1; // CR is last byte

    const part1 = frame.subarray(0, splitPoint);
    const part2 = frame.subarray(splitPoint);

    const msgs1 = parser.parse(part1);
    expect(msgs1).toHaveLength(0);

    const msgs2 = parser.parse(part2);
    expect(msgs2).toHaveLength(1);
    expect(msgs2[0]).toBe('BOUNDARY');
  });

  it('handles byte-by-byte delivery', () => {
    const frame = wrapMllp('BYTE');

    let result: readonly string[] = [];
    for (let i = 0; i < frame.length; i++) {
      result = parser.parse(Buffer.from([frame[i]!]));
    }

    expect(result).toHaveLength(1);
    expect(result[0]).toBe('BYTE');
  });

  it('discards data before first VT', () => {
    const garbage = Buffer.from('garbage');
    const frame = wrapMllp('VALID');
    const combined = Buffer.concat([garbage, frame]);

    const messages = parser.parse(combined);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe('VALID');
  });

  it('reset clears internal state', () => {
    // Feed partial frame
    const frame = wrapMllp('INCOMPLETE');
    parser.parse(frame.subarray(0, 5));

    parser.reset();

    // New complete frame should work
    const messages = parser.parse(wrapMllp('FRESH'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe('FRESH');
  });
});

describe('MllpParser DoS guard', () => {
  it('exposes a sane default max frame size', () => {
    expect(DEFAULT_MAX_FRAME_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
  });

  it('throws and resets when an unterminated frame exceeds the cap', () => {
    const parser = new MllpParser({ maxFrameBytes: 64 });
    // Start-of-frame byte then 128 bytes with no end block.
    const chunk = Buffer.concat([Buffer.from([0x0b]), Buffer.alloc(128, 0x41)]);
    expect(() => parser.parse(chunk)).toThrow(/maximum size/);

    // After reset a fresh, well-formed frame parses normally.
    const messages = parser.parse(wrapMllp('OK'));
    expect(messages).toEqual(['OK']);
  });
});

describe('MllpParser charset', () => {
  it('round-trips latin1 (iso-8859-1) accented PHI without corruption', () => {
    const name = 'MSH|^~\\&|José Muñoz';
    const framed = wrapMllp(name, 'latin1');
    const parser = new MllpParser({ charset: 'latin1' });
    const messages = parser.parse(framed);
    expect(messages).toEqual([name]);
  });

  it('corrupts latin1 bytes when decoded as utf-8 (demonstrates why charset matters)', () => {
    const name = 'MSH|café';
    const framed = wrapMllp(name, 'latin1');
    const utf8Parser = new MllpParser({ charset: 'utf-8' });
    const messages = utf8Parser.parse(framed);
    expect(messages[0]).not.toBe(name);
  });
});

describe('MllpParser chunking', () => {
  const VT_B = 0x0b;
  const FS_B = 0x1c;
  const CR_B = 0x0d;
  const frame = (text: string): Buffer => Buffer.concat([Buffer.from([VT_B]), Buffer.from(text), Buffer.from([FS_B, CR_B])]);

  it('returns the same messages wherever the stream is cut', () => {
    // The second payload holds a file separator that is not the end of a frame.
    const stream = Buffer.concat([frame('MSH|one'), frame(`MSH|two${String.fromCharCode(FS_B)}x`), frame('MSH|three')]);
    for (let size = 1; size <= stream.length; size++) {
      const parser = new MllpParser();
      const out: string[] = [];
      for (let i = 0; i < stream.length; i += size) out.push(...parser.parse(stream.subarray(i, i + size)));
      expect(out).toEqual(['MSH|one', `MSH|two${String.fromCharCode(FS_B)}x`, 'MSH|three']);
    }
  });

  it('takes a large frame delivered in small chunks without copying it on every chunk', () => {
    const size = 8 * 1024 * 1024;
    const payload = Buffer.alloc(size, 0x41);
    const stream = Buffer.concat([Buffer.from([VT_B]), payload, Buffer.from([FS_B, CR_B])]);
    const parser = new MllpParser({ maxFrameBytes: 16 * 1024 * 1024 });
    const out: string[] = [];

    const started = Date.now();
    for (let i = 0; i < stream.length; i += 64) out.push(...parser.parse(stream.subarray(i, i + 64)));
    const elapsed = Date.now() - started;

    expect(out).toHaveLength(1);
    expect(out[0]!.length).toBe(size);
    // 131,072 chunks. Re-copying the buffer per chunk moves about 500 GB and
    // takes minutes; one copy at the end takes well under a second.
    expect(elapsed).toBeLessThan(5_000);
  }, 60_000);

  it('does not join a frame of CR-separated segments on every chunk (regression)', () => {
    // Every HL7 segment ends in CR, the last byte of MLLP's end, so a chunk
    // holding a CR is not a sign that the frame can end.
    const segment = `OBX|1|TX|||${'x'.repeat(70)}\r`;
    const payload = Buffer.from(segment.repeat(2_000));
    const stream = Buffer.concat([Buffer.from([VT_B]), payload, Buffer.from([FS_B, CR_B])]);
    const parser = new MllpParser();
    const concat = vi.spyOn(Buffer, 'concat');
    const out: string[] = [];
    try {
      for (let i = 0; i < stream.length; i += 100) out.push(...parser.parse(stream.subarray(i, i + 100)));
      const largeJoins = concat.mock.calls.filter(([list]) => list.reduce((n, b) => n + b.length, 0) > 1_000);
      expect(largeJoins.length).toBeLessThanOrEqual(1);
    } finally {
      concat.mockRestore();
    }
    expect(out).toEqual([payload.toString()]);
  });

  it('completes a frame whose end bytes arrive in separate chunks, and FS inside a payload is not an end', () => {
    const parser = new MllpParser();
    expect(parser.parse(Buffer.from([VT_B, 0x41, FS_B, 0x42, CR_B]))).toEqual([]);
    expect(parser.parse(Buffer.from([0x43, FS_B]))).toEqual([]);
    expect(parser.parse(Buffer.from([CR_B]))).toEqual([`A${String.fromCharCode(FS_B)}B\rC`]);
  });

  it('still rejects a frame that grows past the limit across chunks', () => {
    const parser = new MllpParser({ maxFrameBytes: 100 });
    parser.parse(Buffer.concat([Buffer.from([VT_B]), Buffer.alloc(60, 0x41)]));
    expect(() => parser.parse(Buffer.alloc(60, 0x41))).toThrow(/maximum size/);
    // And is usable again afterwards.
    expect(parser.parse(frame('MSH|ok'))).toEqual(['MSH|ok']);
  });
});
