import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../../styles/theme.js';
import { ScriptReferenceButton } from '../ScriptReferenceButton.js';
import { ShortcutsButton, EDITOR_SHORTCUTS } from '../ShortcutsButton.js';

afterEach(() => { cleanup(); });

const SOURCE = { dataType: 'HL7V2', destinationSet: true, templateContext: 'SOURCE_FILTER_TRANSFORMER' } as const;

function fakeEditor(): { focus: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn>; getContribution: () => unknown } {
  const insert = vi.fn();
  return { focus: vi.fn(), insert, getContribution: () => ({ insert }) };
}

describe('ScriptReferenceButton', () => {
  it('lists what the script can use, grouped, and inserts the chosen function as a snippet', () => {
    const editor = fakeEditor();
    render(<ThemeProvider theme={lightTheme}><ScriptReferenceButton editor={editor as never} surface={SOURCE} templates={[]} /></ThemeProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Reference' }));
    const panel = screen.getByRole('presentation');
    expect(within(panel).getByText('Message')).toBeTruthy();
    expect(within(panel).getByText('msg: Hl7MessageProxy')).toBeTruthy();

    fireEvent.click(within(panel).getByText('parseHL7(raw: string): Hl7MessageProxy'));
    expect(editor.insert).toHaveBeenCalledWith('parseHL7(${1:raw})');
  });

  it('filters by name or description', () => {
    render(<ThemeProvider theme={lightTheme}><ScriptReferenceButton editor={null} surface={SOURCE} templates={[]} /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Reference' }));
    fireEvent.change(screen.getByPlaceholderText('Search functions, variables and code templates'), { target: { value: 'ack' } });
    expect(screen.getByText(/^createACK\(/)).toBeTruthy();
    expect(screen.queryByText(/^parseHL7\(/)).toBeNull();
  });
});

describe('ShortcutsButton', () => {
  it('lists every editor shortcut', () => {
    render(<ThemeProvider theme={lightTheme}><ShortcutsButton /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    for (const [keys, action] of EDITOR_SHORTCUTS) {
      expect(screen.getByText(keys)).toBeTruthy();
      expect(screen.getByText(action)).toBeTruthy();
    }
  });
});
