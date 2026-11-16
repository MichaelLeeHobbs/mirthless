import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { useKeyboardShortcuts } from '../use-keyboard-shortcuts.js';

function setup(): { onPaletteOpen: ReturnType<typeof vi.fn> } {
  const onPaletteOpen = vi.fn();
  renderHook(() => { useKeyboardShortcuts({ onHelpOpen: vi.fn(), onPaletteOpen }); }, {
    wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>,
  });
  return { onPaletteOpen };
}

function pressCtrlK(target: HTMLElement): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
}

afterEach(() => { document.body.innerHTML = ''; });

describe('useKeyboardShortcuts Ctrl+K', () => {
  it('opens Jump to from an ordinary text field', () => {
    const { onPaletteOpen } = setup();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    pressCtrlK(input);
    expect(onPaletteOpen).toHaveBeenCalledTimes(1);
  });

  it('leaves Ctrl+K to the code editor when focus is inside it', () => {
    const { onPaletteOpen } = setup();
    const editor = document.createElement('div');
    editor.className = 'monaco-editor';
    const textarea = document.createElement('textarea');
    editor.append(textarea);
    document.body.append(editor);
    textarea.focus();
    pressCtrlK(textarea);
    expect(onPaletteOpen).not.toHaveBeenCalled();
  });
});
