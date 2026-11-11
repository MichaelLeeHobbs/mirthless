// ===========================================
// Order-Preserving XML Serializer Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { parseForSandbox, serializeFromSandbox, serializeTransformed } from '../data-type-handler.js';

type Obj = Record<string, unknown>;

/** Parse, let `edit` change the object the way a transformer would, and serialize. */
function transform(original: string, edit: (msg: Obj) => void): string {
  const msg = parseForSandbox(original, 'XML') as Obj;
  edit(msg);
  return serializeTransformed(msg, original, 'XML');
}

describe('XML keeps the original document order when a script edits it', () => {
  it('keeps interleaved repeated elements in place', () => {
    const out = transform('<r><a>1</a><b>2</b><a>3</a></r>', (m) => { ((m['r'] as Obj)['a'] as string[])[1] = '9'; });

    expect(out).toBe('<r><a>1</a><b>2</b><a>9</a></r>');
  });

  it('keeps mixed content around an edited child element', () => {
    const out = transform('<p>pre <i>mid</i> post</p>', (m) => { (m['p'] as Obj)['i'] = 'MID'; });

    expect(out).toBe('<p>pre <i>MID</i> post</p>');
  });

  it('keeps comments, the XML declaration, CDATA and indentation', () => {
    const original = '<?xml version="1.0" encoding="UTF-8"?><r>\n  <!-- keep me -->\n  <a>1</a>\n  <c><![CDATA[<raw>]]></c>\n  <b>2</b>\n</r>';

    const out = transform(original, (m) => { (m['r'] as Obj)['b'] = '3'; });

    expect(out).toBe(original.replace('<b>2</b>', '<b>3</b>'));
  });

  it('keeps attributes and writes edited and added ones', () => {
    const out = transform('<r id="1"><a x="1">v</a></r>', (m) => {
      const r = m['r'] as Obj;
      r['@_id'] = '2';
      (r['a'] as Obj)['@_y'] = 'new';
    });

    expect(out).toBe('<r id="2"><a x="1" y="new">v</a></r>');
  });

  it('drops an element the script deleted and leaves the rest in order', () => {
    const out = transform('<r><a>1</a><b>2</b><c>3</c></r>', (m) => { delete (m['r'] as Obj)['b']; });

    expect(out).toBe('<r><a>1</a><c>3</c></r>');
  });

  it('drops one occurrence of a repeated element', () => {
    const out = transform('<r><a>1</a><b>2</b><a>3</a></r>', (m) => { ((m['r'] as Obj)['a'] as string[]).pop(); });

    expect(out).toBe('<r><a>1</a><b>2</b></r>');
  });

  it('appends elements the script added, after the existing children', () => {
    const out = transform('<r><a>1</a></r>', (m) => {
      const r = m['r'] as Obj;
      r['z'] = { '@_k': 'v', n: 'new' };
      r['a'] = ['1', '2'];
    });

    expect(out).toBe('<r><a>1</a><a>2</a><z k="v"><n>new</n></z></r>');
  });

  it('writes changed text in place of the old text', () => {
    const out = transform('<r><a>old</a><b k="1">old</b></r>', (m) => {
      const r = m['r'] as Obj;
      r['a'] = 'new';
      (r['b'] as Obj)['#text'] = 'newer';
    });

    expect(out).toBe('<r><a>new</a><b k="1">newer</b></r>');
  });

  it('replaces a leaf with children and children with a leaf', () => {
    const out = transform('<r><a>text</a><b><c>1</c></b></r>', (m) => {
      const r = m['r'] as Obj;
      r['a'] = { child: 'x' };
      r['b'] = 'flat';
    });

    expect(out).toBe('<r><a><child>x</child></a><b>flat</b></r>');
  });

  it('empties an element set to an empty string or null', () => {
    const out = transform('<r><a>1</a><b>2</b></r>', (m) => {
      const r = m['r'] as Obj;
      r['a'] = '';
      r['b'] = null;
    });

    expect(out).toBe('<r><a></a><b></b></r>');
  });

  it('encodes special characters in new text and attributes', () => {
    const out = transform('<r><a>1</a></r>', (m) => { (m['r'] as Obj)['a'] = { '@_q': 'a&b', '#text': '1 < 2' }; });

    expect(out).toBe('<r><a q="a&amp;b">1 &lt; 2</a></r>');
  });

  it('never turns a value into a number on the way through', () => {
    const out = transform('<r><mrn>000123</mrn><zip>02134</zip><x>1</x></r>', (m) => { (m['r'] as Obj)['x'] = '2'; });

    expect(out).toBe('<r><mrn>000123</mrn><zip>02134</zip><x>2</x></r>');
  });

  it('returns the original text untouched when nothing changed', () => {
    const original = '<r>\n  <a/>\n  <b>x &apos; y</b>\n</r>';

    expect(transform(original, () => undefined)).toBe(original);
  });

  it('builds a document from an object when there is no original', () => {
    expect(serializeFromSandbox({ r: { '@_v': '1', a: ['1', '2'], b: { c: 'x' } } }, 'XML'))
      .toBe('<r v="1"><a>1</a><a>2</a><b><c>x</c></b></r>');
  });

  it('builds a document when the original is not XML at all', () => {
    expect(serializeFromSandbox({ r: { a: '1' } }, 'XML', 'MSH|^~\\&|not xml')).toBe('<r><a>1</a></r>');
  });

  it('handles a deeply nested document', () => {
    const depth = 90;
    const original = `${'<n>'.repeat(depth)}x${'</n>'.repeat(depth)}`;
    let msg: unknown = 'y';
    for (let i = 0; i < depth; i++) msg = { n: msg };

    const out = serializeFromSandbox(msg, 'XML', original);

    expect(out.startsWith('<n><n><n>')).toBe(true);
    expect(out).toContain('<n>y</n>');
  });
});
