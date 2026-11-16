// #183: an editor whose text the host replaces (a list item removed or moved
// under an index-keyed editor, another tab's script, a generated sample) must
// not let undo bring back the text it held before. Replacing the model's whole
// value does that, since Monaco clears a model's undo stack on setValue.

import { describe, it, expect, vi } from 'vitest';
import { isExternalReplace, replaceExternalValue } from '../editor-hooks.js';
import { textFromEditor } from '../TextEditor.js';

// #183: Monaco gives back an edited HL7 sample with \n (or \r\n) line endings,
// so the test run parsed it with endings HL7 does not use.
describe('textFromEditor', () => {
  it('ends HL7 segments with \\r, whatever endings the editor used', () => {
    expect(textFromEditor('hl7', 'MSH|^~\\&|\nPID|1\r\nPV1|1')).toBe('MSH|^~\\&|\rPID|1\rPV1|1');
  });

  it('leaves other text as the editor gave it', () => {
    expect(textFromEditor('json', '{\n  "a": 1\n}')).toBe('{\n  "a": 1\n}');
    expect(textFromEditor('plaintext', 'a\r\nb')).toBe('a\r\nb');
  });
});

function fakeEditor(text: string): { editor: never; setValue: ReturnType<typeof vi.fn> } {
  const setValue = vi.fn();
  const editor = { getValue: () => text, getModel: () => ({ setValue }) };
  return { editor: editor as never, setValue };
}

describe('replaceExternalValue', () => {
  it('replaces the model value, which clears its undo history, when the host gives other text', () => {
    const { editor, setValue } = fakeEditor('rule two');
    expect(replaceExternalValue(editor, 'rule three')).toBe(true);
    expect(setValue).toHaveBeenCalledWith('rule three');
  });

  it('leaves the editor alone when the host echoes back what the user typed', () => {
    const { editor, setValue } = fakeEditor('return true;');
    expect(replaceExternalValue(editor, 'return true;')).toBe(false);
    expect(setValue).not.toHaveBeenCalled();
  });

  // #228: Monaco reports setValue as a content change, which reaches the host's onChange.
  it('marks the editor as being replaced only while the host\'s text goes in', () => {
    const seen: boolean[] = [];
    const editor = { getValue: () => 'tab one' } as Record<string, unknown>;
    editor['getModel'] = () => ({ setValue: () => { seen.push(isExternalReplace(editor as never)); } });
    replaceExternalValue(editor as never, 'tab two');
    expect(seen).toEqual([true]);
    expect(isExternalReplace(editor as never)).toBe(false);
    expect(isExternalReplace(null)).toBe(false);
  });

  it('counts text that differs only in line endings as the same (Monaco stores its own)', () => {
    const { editor, setValue } = fakeEditor('MSH|^~\\&|\nPID|1');
    expect(replaceExternalValue(editor, 'MSH|^~\\&|\rPID|1')).toBe(false);
    expect(replaceExternalValue(editor, 'MSH|^~\\&|\r\nPID|1')).toBe(false);
    expect(setValue).not.toHaveBeenCalled();
  });
});
