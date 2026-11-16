// The editor chrome every host shares. Monaco itself is stubbed (test/setup.ts),
// so these tests cover the toolbar, status line and full-screen behaviour.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lightTheme } from '../../../styles/theme.js';
import { ProblemStatus } from '../ProblemStatus.js';
import { ScriptEditor, AUTO_HEIGHT, autoHeight } from '../ScriptEditor.js';
import { TextEditor } from '../TextEditor.js';
import { problemKind, settledProblems, suggestRoom, type Problem } from '../editor-hooks.js';

afterEach(() => { cleanup(); });

/** Matches the one element whose whole text is `text`, even when it spans nested elements. */
function fullText(text: string): (content: string, el: Element | null) => boolean {
  return (_content, el) => el?.textContent === text && [...el.children].every((c) => c.textContent !== text);
}

function wrap(node: React.ReactNode): void {
  // ScriptEditor reads code templates for completion; no request is made here.
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={lightTheme}>{node}</ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('ProblemStatus', () => {
  it('says there are no problems when the script is clean', () => {
    wrap(<ProblemStatus editor={null} problems={[]} />);
    expect(screen.getByText('No problems')).toBeTruthy();
  });

  it('counts errors and warnings and names the first problem with its line', () => {
    const problems: Problem[] = [
      { severity: 'error', kind: 'type', message: "Type 'string' is not assignable to type 'number'.", line: 1, column: 7 },
      { severity: 'error', kind: 'type', message: "Property 'inf' does not exist on type 'SandboxLogger'.", line: 2, column: 8 },
      { severity: 'error', kind: 'syntax', message: "')' expected.", line: 3, column: 1 },
      { severity: 'warning', kind: 'type', message: 'Unreachable code detected.', line: 5, column: 1 },
    ];
    wrap(<ProblemStatus editor={null} problems={problems} />);
    expect(screen.getByText('1 syntax error, 2 type errors, 1 warning')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to first problem, line 1' }).textContent)
      .toContain("Line 1: Type 'string' is not assignable to type 'number'.");
  });

  it('counts one syntax error and the rest as following it, since one missing bracket cascades', () => {
    const problems: Problem[] = Array.from({ length: 8 }, (_, i) => (
      { severity: 'error', kind: 'syntax', message: "',' expected.", line: i + 1, column: 1 }
    ));
    wrap(<ProblemStatus editor={null} problems={problems} />);
    expect(screen.getByText('1 syntax error (7 more after it), 0 warnings')).toBeTruthy();
  });

  it('always counts warnings beside errors, so none is taken for unchecked', () => {
    const problems: Problem[] = [{ severity: 'error', kind: 'type', message: 'x', line: 1, column: 1 }];
    wrap(<ProblemStatus editor={null} problems={problems} />);
    expect(screen.getByText('1 type error, 0 warnings')).toBeTruthy();
  });

  it('jumps the editor to the first problem when clicked', () => {
    const editor = { setPosition: vi.fn(), revealLineInCenter: vi.fn(), focus: vi.fn() };
    const problems: Problem[] = [{ severity: 'error', kind: 'syntax', message: 'x', line: 4, column: 2 }];
    wrap(<ProblemStatus editor={editor as never} problems={problems} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to first problem, line 4' }));
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 4, column: 2 });
    expect(editor.focus).toHaveBeenCalled();
  });
});

describe('autoHeight', () => {
  it('fits the script between about five lines and the cap, where it starts to scroll', () => {
    expect(autoHeight(60)).toBe(AUTO_HEIGHT.min);
    expect(autoHeight(200.4)).toBe(201);
    expect(autoHeight(5000)).toBe(AUTO_HEIGHT.max);
  });

  it('grows by the completion list while it is open, so the list stays inside the editor', () => {
    expect(autoHeight(40, 0)).toBe(AUTO_HEIGHT.min);
    expect(autoHeight(40, 200)).toBe(240);
    expect(autoHeight(400, 200)).toBe(AUTO_HEIGHT.max);
  });
});

describe('settledProblems', () => {
  const typing: Problem = { severity: 'error', kind: 'syntax', message: 'Identifier expected.', line: 2, column: 8 };
  const other: Problem = { severity: 'error', kind: 'type', message: 'x', line: 1, column: 3 };

  it('leaves out the syntax error on the token being completed while the list is open', () => {
    expect(settledProblems([other, typing], { line: 2, column: 8 }, true)).toEqual([other]);
  });

  it('keeps it once the list closes, and keeps problems elsewhere', () => {
    expect(settledProblems([other, typing], { line: 2, column: 8 }, false)).toEqual([other, typing]);
    expect(settledProblems([other, typing], { line: 3, column: 1 }, true)).toEqual([other, typing]);
  });
});

describe('suggestRoom', () => {
  it('is the open completion list height plus a margin, and nothing when it is closed', () => {
    const host = document.createElement('div');
    expect(suggestRoom(host)).toBe(0);
    const list = document.createElement('div');
    list.className = 'suggest-widget';
    Object.defineProperty(list, 'offsetHeight', { value: 180 });
    host.append(list);
    expect(suggestRoom(host)).toBe(0);
    list.classList.add('visible');
    expect(suggestRoom(host)).toBe(188);
  });

  it('makes room for the documentation panel when it is taller than the list', () => {
    const host = document.createElement('div');
    const list = document.createElement('div');
    list.className = 'suggest-widget visible';
    Object.defineProperty(list, 'offsetHeight', { value: 30 });
    const docs = document.createElement('div');
    docs.className = 'suggest-details-container';
    Object.defineProperty(docs, 'offsetHeight', { value: 120 });
    host.append(list, docs);
    expect(suggestRoom(host)).toBe(128);
  });
});

describe('problemKind', () => {
  it('reads TypeScript 1xxx codes as syntax errors and 2xxx and up as type errors', () => {
    expect(problemKind('1005')).toBe('syntax');
    expect(problemKind({ value: '2322' })).toBe('type');
    expect(problemKind('7006')).toBe('type');
    expect(problemKind(undefined)).toBe('syntax');
  });
});

describe('ScriptEditor chrome', () => {
  it('names the editor group and shows the language in the status line', () => {
    wrap(<ScriptEditor value="" onChange={vi.fn()} label="Deploy script" language="TYPESCRIPT" />);
    expect(screen.getByRole('group', { name: 'Deploy script' })).toBeTruthy();
    expect(screen.getByText(fullText('TypeScript · type-checked before deploy'))).toBeTruthy();
  });

  it('says a JavaScript script is checked for syntax only', () => {
    wrap(<ScriptEditor value="" onChange={vi.fn()} language="JAVASCRIPT" />);
    expect(screen.getByText(fullText('JavaScript · syntax only'))).toBeTruthy();
  });

  it('reports a language switch to the host as the stored language code', () => {
    const onLanguageChange = vi.fn();
    wrap(<ScriptEditor value="" onChange={vi.fn()} showLanguageToggle language="JAVASCRIPT" onLanguageChange={onLanguageChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'TypeScript' }));
    expect(onLanguageChange).toHaveBeenCalledWith('TYPESCRIPT');
  });

  it('labels a read-only editor and hides formatting and the language switch', () => {
    wrap(<ScriptEditor value="" onChange={vi.fn()} readOnly showLanguageToggle />);
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Format document' })).toBeNull();
    // The status line still names the language; a disabled switch only looked editable.
    expect(screen.queryByRole('button', { name: 'TypeScript' })).toBeNull();
  });

  it('names every toolbar action in visible text, not only an icon', () => {
    wrap(<ScriptEditor value="" onChange={vi.fn()} label="Deploy script" />);
    expect(screen.getByRole('button', { name: 'Format document' }).textContent).toBe('Format');
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' }).textContent).toBe('Shortcuts');
    expect(screen.getByRole('button', { name: 'Expand to full screen' }).textContent).toBe('Full screen');
  });

  it('opens full screen and comes back', () => {
    wrap(<ScriptEditor value="" onChange={vi.fn()} label="Deploy script" />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand to full screen' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('TextEditor chrome', () => {
  it('counts lines across HL7 segment breaks', () => {
    wrap(<TextEditor label="Message" value={'MSH|^~\\&|A\rPID|1\rPV1|1'} language="hl7" />);
    expect(screen.getByText('3 lines, 22 characters')).toBeTruthy();
    expect(screen.getByText('HL7 v2')).toBeTruthy();
    expect(screen.getByText('Read only')).toBeTruthy();
  });

  it('labels its copy action in visible text', () => {
    wrap(<TextEditor label="Message" value="MSH|^~\\&|" language="hl7" />);
    expect(screen.getByRole('button', { name: 'Copy to clipboard' }).textContent).toBe('Copy');
  });

  it('is editable, with no read-only badge, when the host passes onChange', () => {
    wrap(<TextEditor label="Message" value="" onChange={vi.fn()} />);
    expect(screen.queryByText('Read only')).toBeNull();
    expect((screen.getByRole('button', { name: 'Copy to clipboard' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
