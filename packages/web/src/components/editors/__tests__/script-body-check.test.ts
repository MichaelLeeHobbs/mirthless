// #206: the editor checks a script as the body of the function the engine runs
// it in, and puts TypeScript's errors for that wrapped text on the lines the
// user wrote.

import { describe, it, expect } from 'vitest';
import { wrapScriptBody } from '@galvanigraph/core-models';
import { flattenMessage, scriptBodyMarkers } from '../script-body-check.js';

/** 1-based line and column of an offset in `text`, as a Monaco model's getPositionAt gives it. */
function positionIn(text: string): (offset: number) => { lineNumber: number; column: number } {
  return (offset) => {
    const before = text.slice(0, offset).split('\n');
    return { lineNumber: before.length, column: (before.at(-1) ?? '').length + 1 };
  };
}

describe('scriptBodyMarkers', () => {
  const code = "logger.info('x');\nreturn [msg.get('MSH.10')];";
  const wrapped = wrapScriptBody(code);

  it('puts an error in a returned expression on the line and columns the user wrote', () => {
    const start = wrapped.indexOf('msg');
    const markers = scriptBodyMarkers(code, [{
      category: 1, code: 2304, file: undefined, start, length: 3, messageText: "Cannot find name 'msg'.",
    }], positionIn(wrapped));
    expect(markers).toEqual([{
      severity: 8, message: "Cannot find name 'msg'.", code: '2304',
      startLineNumber: 2, startColumn: 9, endLineNumber: 2, endColumn: 12,
    }]);
  });

  it('keeps an error on the wrapper inside the script', () => {
    const markers = scriptBodyMarkers(code, [{
      category: 0, code: 1, file: undefined, start: wrapped.length - 1, length: 1, messageText: 'at the closing brace',
    }], positionIn(wrapped));
    expect(markers[0]).toMatchObject({ severity: 4, startLineNumber: 2, endLineNumber: 2 });
  });
});

describe('flattenMessage', () => {
  it('returns a plain message as it is', () => {
    expect(flattenMessage('Cannot find name \'msg\'.')).toBe('Cannot find name \'msg\'.');
  });

  it('puts each chained message on its own line, indented by depth, in order', () => {
    expect(flattenMessage({
      messageText: 'Type A is not assignable to type B.', category: 1, code: 2322,
      next: [
        { messageText: 'Types of property x are incompatible.', category: 1, code: 2326, next: [{ messageText: 'deeper', category: 1, code: 1 }] },
        { messageText: 'second', category: 1, code: 2 },
      ],
    })).toBe('Type A is not assignable to type B.\n  Types of property x are incompatible.\n    deeper\n  second');
  });
});
