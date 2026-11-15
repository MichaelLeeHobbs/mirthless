// The editor chrome every host shares. Monaco itself is stubbed (test/setup.ts),
// so these tests cover the toolbar, status line and full-screen behaviour.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../../styles/theme.js';
import { ProblemStatus } from '../ProblemStatus.js';
import { ScriptEditor } from '../ScriptEditor.js';
import { TextEditor } from '../TextEditor.js';
import type { Problem } from '../editor-hooks.js';

afterEach(() => { cleanup(); });

function wrap(node: React.ReactNode): void {
  render(<ThemeProvider theme={lightTheme}>{node}</ThemeProvider>);
}

describe('ProblemStatus', () => {
  it('says there are no problems when the script is clean', () => {
    wrap(<ProblemStatus editor={null} problems={[]} />);
    expect(screen.getByText('No problems')).toBeTruthy();
  });

  it('counts errors and warnings and names the first problem with its line', () => {
    const problems: Problem[] = [
      { severity: 'error', message: "Type 'string' is not assignable to type 'number'.", line: 1, column: 7 },
      { severity: 'error', message: "Property 'inf' does not exist on type 'SandboxLogger'.", line: 2, column: 8 },
      { severity: 'warning', message: 'Unreachable code detected.', line: 5, column: 1 },
    ];
    wrap(<ProblemStatus editor={null} problems={problems} />);
    expect(screen.getByText('2 errors, 1 warning')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to first problem, line 1' }).textContent)
      .toContain("Line 1: Type 'string' is not assignable to type 'number'.");
  });

  it('jumps the editor to the first problem when clicked', () => {
    const editor = { setPosition: vi.fn(), revealLineInCenter: vi.fn(), focus: vi.fn() };
    const problems: Problem[] = [{ severity: 'error', message: 'x', line: 4, column: 2 }];
    wrap(<ProblemStatus editor={editor as never} problems={problems} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to first problem, line 4' }));
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 4, column: 2 });
    expect(editor.focus).toHaveBeenCalled();
  });
});

describe('ScriptEditor chrome', () => {
  it('names the editor group and shows the language in the status line', () => {
    wrap(<ScriptEditor value="" onChange={vi.fn()} label="Deploy script" language="typescript" />);
    expect(screen.getByRole('group', { name: 'Deploy script' })).toBeTruthy();
    expect(screen.getByText('TypeScript')).toBeTruthy();
  });

  it('reports a language switch to the host', () => {
    const onLanguageChange = vi.fn();
    wrap(<ScriptEditor value="" onChange={vi.fn()} showLanguageToggle language="javascript" onLanguageChange={onLanguageChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'TypeScript' }));
    expect(onLanguageChange).toHaveBeenCalledWith('typescript');
  });

  it('labels a read-only editor and hides formatting', () => {
    wrap(<ScriptEditor value="" onChange={vi.fn()} readOnly showLanguageToggle />);
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Format document' })).toBeNull();
    expect((screen.getByRole('button', { name: 'TypeScript' }) as HTMLButtonElement).disabled).toBe(true);
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

  it('is editable, with no read-only badge, when the host passes onChange', () => {
    wrap(<TextEditor label="Message" value="" onChange={vi.fn()} />);
    expect(screen.queryByText('Read only')).toBeNull();
    expect((screen.getByRole('button', { name: 'Copy to clipboard' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
