import { describe, it, expect } from 'vitest';
import { SCRIPT_BODY_OPEN, scriptBodyPosition, wrapScriptBody } from '../script-check.js';

describe('wrapScriptBody', () => {
  it('puts the script on its own lines inside the function, columns unchanged', () => {
    const wrapped = wrapScriptBody('const a = 1;\n  return a;');
    expect(wrapped.split('\n')).toEqual([SCRIPT_BODY_OPEN, 'const a = 1;', '  return a;', '}']);
  });
});

describe('scriptBodyPosition', () => {
  const code = 'const a = 1;\nreturn a;';

  it('moves a position inside the script up one line, at the same column', () => {
    expect(scriptBodyPosition(code, 2, 7)).toEqual({ line: 1, column: 7 });
    expect(scriptBodyPosition(code, 3, 8)).toEqual({ line: 2, column: 8 });
  });

  it('puts a position on the wrapper\'s first line at the start of the script', () => {
    expect(scriptBodyPosition(code, 1, 20)).toEqual({ line: 1, column: 1 });
    expect(scriptBodyPosition(code, 0, 1)).toEqual({ line: 1, column: 1 });
  });

  it('puts a position on the closing brace or past it at the end of the script', () => {
    expect(scriptBodyPosition(code, 4, 1)).toEqual({ line: 2, column: 10 });
    expect(scriptBodyPosition(code, 9, 3)).toEqual({ line: 2, column: 10 });
    expect(scriptBodyPosition('', 3, 2)).toEqual({ line: 1, column: 1 });
  });

  it('counts lines as TypeScript does, which breaks lines at U+2028, U+2029 and a lone CR too', () => {
    const separated = 'const s = "a\u2028b";\rreturn s;';
    expect(scriptBodyPosition(separated, 3, 2)).toEqual({ line: 2, column: 2 });
    expect(scriptBodyPosition(separated, 4, 1)).toEqual({ line: 3, column: 1 });
    expect(scriptBodyPosition(separated, 5, 1)).toEqual({ line: 3, column: 10 });
    expect(scriptBodyPosition('a\u2029b\r\nc', 5, 1)).toEqual({ line: 3, column: 2 });
  });
});
