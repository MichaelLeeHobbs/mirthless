import { describe, it, expect } from 'vitest';
import { X12Message } from '../x12.js';

const ISA = 'ISA*00*          *00*          *ZZ*SUBMITTER      *ZZ*RECEIVER       *261110*1200*^*00501*000000020*0*P*:~';
const X12_270 = [
  ISA,
  'GS*HS*SUBMITTER*RECEIVER*20261110*1200*20*X*005010X279A1~',
  'ST*270*0020*005010X279A1~',
  'NM1*PR*2*ACME HEALTH*****PI*12345~',
  'NM1*1P*2*VNS IMAGING*****XX*1234567893~',
  'NM1*IL*1*DOE*JANE****MI*MEMBER123~',
  'EQ*30**HC:99213~',
  'SE*6*0020~',
  'GE*1*20~',
  'IEA*1*000000020~',
].join('');

describe('X12Message', () => {
  it('reads elements by segment occurrence and element number', () => {
    const msg = X12Message.parse(X12_270);
    expect(msg.get('NM1[3].9')).toBe('MEMBER123');
    expect(msg.get('NM1.3')).toBe('ACME HEALTH');
    expect(msg.get('ST.1')).toBe('270');
    expect(msg.get('ISA.6')).toBe('SUBMITTER      ');
  });

  it('reads components with the separator from ISA16', () => {
    const msg = X12Message.parse(X12_270);
    expect(msg.get('EQ.3.1')).toBe('HC');
    expect(msg.get('EQ.3.2')).toBe('99213');
    expect(msg.get('EQ.3')).toBe('HC:99213');
  });

  it('returns the segment text for a segment path, and undefined for what is not there', () => {
    const msg = X12Message.parse(X12_270);
    expect(msg.get('NM1[2]')).toBe('NM1*1P*2*VNS IMAGING*****XX*1234567893');
    expect(msg.get('NM1[4].1')).toBeUndefined();
    expect(msg.get('NM1.20')).toBeUndefined();
    expect(msg.get('EQ.3.5')).toBeUndefined();
    expect(msg.get('CLM.1')).toBeUndefined();
  });

  it('writes back exactly what it read', () => {
    expect(X12Message.parse(X12_270).toString()).toBe(X12_270);
  });

  it('keeps line breaks after each segment terminator, and other delimiters', () => {
    // Element |, component >, terminator ~ followed by CRLF.
    const isa = ISA.replaceAll('*', '|').replace(':~', '>~');
    const text = `${isa}\r\nST|270|1~\r\nEQ|30||HC>99213~\r\n`;
    const msg = X12Message.parse(`  \n${text}`);
    expect(msg.get('ST.1')).toBe('270');
    expect(msg.get('EQ.3.2')).toBe('99213');
    expect(msg.toString()).toBe(text);
  });

  it('sets elements and components, adding empty ones before them', () => {
    const msg = X12Message.parse(X12_270);
    msg.set('NM1[3].9', 'MEMBER999');
    msg.set('EQ.3.4', 'X');
    msg.set('SE.4', 'Z');
    expect(msg.get('NM1[3].9')).toBe('MEMBER999');
    expect(msg.get('EQ.3')).toBe('HC:99213::X');
    expect(msg.toString()).toContain('SE*6*0020**Z~');
  });

  it('refuses to set a segment that is not there, or a whole segment', () => {
    const msg = X12Message.parse(X12_270);
    expect(() => msg.set('CLM.1', 'x')).toThrow(/no CLM\[1\] segment/);
    expect(() => msg.set('NM1', 'x')).toThrow(/not the whole segment/);
  });

  it('deletes a segment or empties an element, and ignores paths that are not there', () => {
    const msg = X12Message.parse(X12_270);
    msg.delete('NM1[2]');
    msg.delete('EQ.1');
    msg.delete('CLM');
    msg.delete('NM1.30');
    expect(msg.getSegmentCount('NM1')).toBe(2);
    expect(msg.get('NM1[2].9')).toBe('MEMBER123');
    expect(msg.get('EQ')).toBe('EQ***HC:99213');
  });

  it('counts segments by id', () => {
    const msg = X12Message.parse(X12_270);
    expect(msg.getSegmentCount('NM1')).toBe(3);
    expect(msg.getSegmentCount('CLM')).toBe(0);
  });

  it('refuses text without a complete ISA, and paths it cannot read', () => {
    expect(() => X12Message.parse('GS*HS~')).toThrow(/ISA/);
    expect(() => X12Message.parse('ISA*00*short~')).toThrow(/106-character/);
    const msg = X12Message.parse(X12_270);
    expect(() => msg.get('nm1.1')).toThrow(/Invalid X12 path/);
    expect(() => msg.get('NM1[0].1')).toThrow(/start at 1/);
    expect(() => msg.get('NM1.0')).toThrow(/start at 1/);
  });
});
