// ===========================================
// MLLP Mode Tests
// ===========================================

import { describe, it, expect, beforeEach } from 'vitest';
import { wrapMllp, MllpParser, DEFAULT_MAX_FRAME_BYTES } from '../mllp-mode.js';

const VT = 0x0B;
const FS = 0x1C;
const CR = 0x0D;

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
