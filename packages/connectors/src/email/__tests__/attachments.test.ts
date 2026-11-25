import { describe, it, expect } from 'vitest';
import { countAttachments, MAX_DELIMITER_LINES, MAX_HEADER_BYTES, MAX_PARTS } from '../attachments.js';

const CRLF = '\r\n';
const email = (...lines: readonly string[]): Buffer => Buffer.from(lines.join(CRLF), 'latin1');
/** The lines of a part. */
const part = (headers: readonly string[], ...body: readonly string[]): readonly string[] => [...headers, '', ...body];
const TEXT = part(['Content-Type: text/plain; charset=utf-8'], 'Dear colleague');
const HTML = part(['Content-Type: text/html'], '<p>Dear colleague</p>');
const PDF = part(['Content-Type: application/pdf', 'Content-Disposition: attachment; filename=report.pdf'], '%PDF-1.4');

function multipart(type: string, boundary: string, ...parts: ReadonlyArray<readonly string[]>): readonly string[] {
  return part([`Content-Type: multipart/${type}; boundary="${boundary}"`], ...parts.flatMap((lines) => [`--${boundary}`, ...lines]), `--${boundary}--`);
}
const mixed = (...parts: ReadonlyArray<readonly string[]>): Buffer => email('Subject: ORU', ...multipart('mixed', 'b', ...parts));
const lines = (line: string, count: number): string => Array<string>(count).fill(line).join(CRLF);
const typed = (...headers: readonly string[]): readonly string[] => part(headers, 'x');

describe('the attachments of an email', () => {
  it.each<readonly [string, Buffer, number]>([
    ['nothing', Buffer.alloc(0), 0],
    ['only a header', email('Subject: ORU'), 0],
    ['text without a Content-Type', email('Subject: ORU', '', 'MSH|'), 0],
    ['text', email('Content-Type: text/plain', '', 'MSH|'), 0],
    ['text with a comment', email('Content-Type: text/plain(in short); charset=utf-8', '', 'MSH|'), 0],
    ['a Content-Type that is none', email('Content-Type: text', '', 'MSH|'), 0],
    ['an empty Content-Type', email('Content-Type:', '', 'MSH|'), 0],
    ['text and HTML of the same', email(...multipart('alternative', 'b', TEXT, HTML)), 0],
    ['a file', mixed(TEXT, PDF), 1],
    ['files beside text and HTML', mixed(multipart('alternative', 'a', TEXT, HTML), PDF, PDF), 2],
    ['a part without a name or a disposition', mixed(TEXT, typed('Content-Type: application/pdf')), 1],
    ['text that is an attachment', mixed(TEXT, typed('Content-Type: text/plain', 'Content-Disposition: ATTACHMENT')), 1],
    ['an attachment without a Content-Type', mixed(TEXT, typed('Content-Disposition: attachment')), 1],
    ['text with a file name', mixed(TEXT, typed('Content-Type: text/plain', 'Content-Disposition: inline; filename="oru.hl7"')), 1],
    ['text with a name in its type', mixed(TEXT, typed('Content-Type: text/html; name=report.html')), 1],
    ['text with a file name in another charset', mixed(TEXT, typed('Content-Type: text/plain', "Content-Disposition: inline; filename*=utf-8''b%C3%A9fund.txt")), 1],
    ['text with a file name in pieces', mixed(TEXT, typed('Content-Type: text/plain', 'Content-Disposition: inline; filename*0="or"; filename*1="u.hl7"')), 1],
    ['text with an empty file name', mixed(TEXT, typed('Content-Type: text/plain; name=""', 'Content-Disposition: inline; filename=')), 0],
    ['text of another kind', mixed(TEXT, typed('Content-Type: text/csv')), 1],
    ['an image in the HTML', email(...multipart('related', 'b', HTML, typed('Content-Type: image/png', 'Content-Disposition: inline'))), 1],
    ['nothing but a file', email('Content-Type: application/pdf', '', '%PDF'), 1],
    ['an email in it, whatever that holds', mixed(TEXT, part(['Content-Type: message/rfc822'], ...multipart('mixed', 'inner', TEXT, PDF, PDF))), 1],
    ['parts in parts', mixed(multipart('mixed', 'c', multipart('mixed', 'd', TEXT, PDF), PDF), PDF), 3],
    ['parts in parts whose boundaries begin alike', mixed(multipart('mixed', 'bb', TEXT, PDF), PDF), 2],
    ['a multipart without parts', mixed(), 0],
    ['a multipart without a boundary', email('Content-Type: multipart/mixed', '', '--b', ...PDF, '--undefined', ...PDF, '--b--'), 0],
    ['text before a header that is not of its name', mixed(TEXT, typed('Content-Type: text/plain', 'X-Other: y', ' ; name=oru.hl7')), 0],
    ['a digest of emails', email(...multipart('digest', 'b', part([], 'Subject: one', '', 'x'), part([], 'Subject: two', '', 'x'))), 2],
    ['a digest in it', mixed(TEXT, multipart('digest', 'c', part([], 'Subject: one', '', 'x'))), 1],
    ['an email in it whose boundary begins as its own', mixed(TEXT, part(['Content-Type: message/rfc822'], ...multipart('mixed', 'bb', TEXT, PDF))), 1],
    ['a digest in it with the same boundary', email('Content-Type: multipart/mixed; boundary=b', '', '--b', 'Content-Type: multipart/digest; boundary=b', '', '--b', '', 'Subject: one', '', 'x'), 1],
    ['a header and no line end', Buffer.from('Content-Type: text/html'), 0],
    ['a boundary with a needless backslash', email('Content-Type: multipart/mixed; boundary="x\\-y"', '', '--x-y', ...PDF, '--x-y--'), 1],
    ['a disposition and nothing between it and its parameter', mixed(TEXT, typed('Content-Type: text/plain', 'Content-Disposition: attachment filename=oru.txt')), 1],
    ['a type and nothing between it and its parameter', email('Content-Type: text/plain charset=utf-8', '', 'MSH|'), 0],
    ['a disposition with a comment', mixed(TEXT, typed('Content-Type: text/plain', 'Content-Disposition: attachment (the form)')), 1],
    ['an invisible space after a boundary, which makes it none', email('Content-Type: multipart/mixed; boundary=b', '', '--b', ...TEXT, '--b\xa0', ...PDF, '--b--'), 0],
    ['a signature', email(...multipart('signed', 'b', TEXT, typed('Content-Type: application/pgp-signature'))), 1],
  ])('are counted in an email with %s', (_what, source, count) => {
    expect(countAttachments(source)).toBe(count);
  });

  it.each<readonly [string, readonly string[]]>([
    ['in any case, with spaces and a comment', ['CONTENT-TYPE :  Multipart/MIXED (two) ; Boundary= \t"b" ; charset=x']],
    ['with a blank at its end', ['Content-Type: multipart/mixed; boundary=b ']],
    ['with white space around the slash, and a comment first', ['Content-Type: (two) multipart / mixed ; boundary=b']],
    ['with the boundary in pieces', ['Content-Type: multipart/mixed; boundary*0="b"; boundary*1=""']],
    ['with the boundary in a charset', ["Content-Type: multipart/mixed; boundary*=us-ascii'en'b"]],
    ['over several lines', ['Content-Type: multipart/mixed;', '\tcharset=x;', ' boundary="b"']],
    ['over several lines, with tabs', ['Content-Type: multipart/mixed;', ' charset=x;', '\tboundary="b"']],
    ['after other parameters, quoted ones with a semicolon too', ['Content-Type: multipart/mixed; a; =; c="x; boundary=no"; boundary=b']],
    ['with an escaped quote before it', ['Content-Type: multipart/mixed; c="x\\"; boundary=no"; boundary="b"']],
    ['twice, of which the first counts', ['Content-Type: multipart/mixed; boundary=b; boundary=c', 'Content-Type: text/plain']],
    ['after a header line that is none', ['not a header', ' nor this', 'Content-Type: multipart/mixed; boundary=b']],
  ])('are counted whatever way the header says what it is: %s', (_how, header) => {
    expect(countAttachments(email(...header, '', '--b', ...TEXT, '--b', ...PDF, '--b--'))).toBe(1);
  });

  it('are counted when the boundary is in pieces, or runs over a line', () => {
    const body = ['', '--x y', ...TEXT, '--x y', ...PDF, '--x y--'];
    expect(countAttachments(email('Content-Type: multipart/mixed; boundary*0="x "; boundary*1=y', ...body))).toBe(1);
    expect(countAttachments(email('Content-Type: multipart/mixed; boundary="x', ' y"', ...body))).toBe(1);
  });

  it('are not counted in what stands after an inner multipart that did not end', () => {
    const unended = Array.from({ length: 25 }, (_, i) => [`Content-Type: multipart/mixed; boundary=c${String(i)}`, '', 'preamble']);
    expect(countAttachments(mixed(...unended))).toBe(0);
    expect(countAttachments(mixed(['Content-Type: multipart/mixed; boundary=c', '', 'preamble'], part(['Content-Type: text/plain'], '--c', 'Content-Type: image/png', '', 'x')))).toBe(0);
  });

  it.each<readonly [string, readonly string[]]>([
    ['text before and after the parts, with hyphens', ['--not a part', '--bb', '--b', ...TEXT, '--b', ...PDF, '--b--', '--c', 'Content-Type: image/png', '', 'x']],
    ['spaces after a boundary', ['--b  ', ...TEXT, '--b\t', ...PDF, '--b-- ']],
    ['no end', ['--b', ...TEXT, '--b', ...PDF]],
    ['a part without a body', ['--b', 'Content-Type: text/plain', '--b', 'Content-Type: image/png', '', 'x', '--b--']],
    ['an inner multipart that does not end', ['--b', 'Content-Type: multipart/mixed; boundary=c', '', '--c', ...TEXT, '--b', ...PDF, '--b--']],
    ['an inner multipart with a boundary of its own after it has ended', ['--b', ...multipart('mixed', 'c', TEXT), '--c', ...PDF, '--b', ...PDF, '--b--']],
  ])('are counted in an email with %s', (_what, body) => {
    const source = email('Content-Type: multipart/mixed; boundary=b', '', ...body);
    expect(countAttachments(source)).toBe(1);
    expect(countAttachments(Buffer.from(source.toString('latin1').replaceAll(CRLF, '\n'), 'latin1'))).toBe(1);
  });

  it('are counted down to a depth, and one multipart beyond it is one', () => {
    let inner: readonly string[] = multipart('mixed', 'last', TEXT, PDF, PDF);
    for (let depth = 19; depth > 0; depth -= 1) inner = multipart('mixed', `b${String(depth)}`, inner);
    expect(countAttachments(email(...inner))).toBe(2);
    expect(countAttachments(email(...multipart('mixed', 'b0', inner)))).toBe(1);
  });

  it('are counted in an email with bytes that are not UTF-8', () => {
    expect(countAttachments(mixed(part(['Content-Type: text/plain'], 'M\xfcller'), typed('Content-Disposition: attachment; filename=M\xfcller.pdf')))).toBe(1);
  });

  describe('of an email that is made of more than one is', () => {
    const header = 'Content-Type: multipart/mixed; boundary=b';
    const parts = (count: number): Buffer => email(header, '', lines(`--b${CRLF}Content-Type: image/png${CRLF}`, count), '--b--');
    const withHeader = (bytes: number): Buffer => email(header, `X: ${'y'.repeat(bytes)}`, '', '--b', ...PDF, '--b--');
    const separators = (count: number): Buffer => email(header, '', '--b', ...part([], lines('-- ', count)), '--b', ...PDF, '--b--');

    it.each<readonly [string, Buffer, number | null]>([
      ['as many parts as are counted', parts(MAX_PARTS), MAX_PARTS],
      ['one part more', parts(MAX_PARTS + 1), null],
      ['very many parts', parts(300_000), null],
      ['a header within the limit', withHeader(MAX_HEADER_BYTES - 1_000), 1],
      ['a header over it', withHeader(MAX_HEADER_BYTES), null],
      ['headers over it together', email(header, '', lines(`--b${CRLF}X: ${'y'.repeat(2_000)}${CRLF}`, 600), '--b--'), null],
      ['as many lines that begin as a boundary as are looked at', separators(MAX_DELIMITER_LINES - 3), 1],
      ['one more', separators(MAX_DELIMITER_LINES - 2), null],
      ['very many of them', separators(1_000_000), null],
    ])('are not counted, and no number is given: %s', (_what, source, count) => {
      expect(countAttachments(source)).toBe(count);
    });
  });

  // Anyone can send one, and a search that starts over for each line or parameter takes seconds.
  it.each<readonly [string, () => Buffer, number | null]>([
    ['many parameters', () => email(`Content-Type: multipart/mixed; ${'a;'.repeat(500_000)} boundary=b`, '', '--b', ...PDF, '--b--'), 1],
    ['many quoted parameters', () => email(`Content-Type: multipart/mixed; boundary=b; ${';a="\\'.repeat(200_000)}`, '', '--b', ...PDF, '--b--'), 1],
    ['one quoted parameter of many escapes', () => email(`Content-Type: multipart/mixed; boundary=b; c="${'\\"'.repeat(500_000)}`, '', '--b', ...PDF, '--b--'), 1],
    ['a header of many lines', () => email(lines('X: y', 80_000), 'Content-Type: multipart/mixed; boundary=b', lines(' ;', 80_000), '', '--b', ...PDF, '--b--'), 1],
    ['a body of many lines that could be a boundary, each very long', () => email(...multipart('mixed', 'b', part([], lines(`--${' '.repeat(100_000)}x`, 50)), PDF)), 1],
    ['a body of very many lines that could not', () => email(...multipart('mixed', 'b', part([], lines('-', 5_000_000)), PDF)), 1],
    ['inner multiparts whose boundary never comes', () => email('Content-Type: multipart/mixed; boundary=b', '', lines(`--b${CRLF}Content-Type: multipart/mixed; boundary=c${CRLF}`, MAX_PARTS), lines('x', 5_000_000)), 0],
  ])('are counted in a time in step with the size of the email: %s', (_what, make, count) => {
    expect(countAttachments(make())).toBe(count);
  }, 5_000);
});
