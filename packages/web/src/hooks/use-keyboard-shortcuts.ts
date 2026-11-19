import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { isPaletteShortcut } from '../lib/command-search.js';

interface UseKeyboardShortcutsOptions {
  readonly onHelpOpen: () => void;
  readonly onPaletteOpen: () => void;
}

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  const role = document.activeElement?.getAttribute('role');
  if (role === 'textbox') return true;
  if (document.activeElement?.getAttribute('contenteditable') === 'true') return true;
  return false;
}

export function useKeyboardShortcuts({ onHelpOpen, onPaletteOpen }: UseKeyboardShortcutsOptions): void {
  const navigate = useNavigate();
  const pendingGRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleKeyDown = useCallback((e: KeyboardEvent): void => {
    // Ctrl/Cmd+K works everywhere, even while typing, like VS Code, except inside
    // a code editor, where Ctrl+K starts the editor's own chords (Ctrl+K Ctrl+C comments a line).
    if (isPaletteShortcut(e) && !document.activeElement?.closest('.monaco-editor')) {
      e.preventDefault();
      onPaletteOpen();
      return;
    }

    if (isInputFocused()) return;

    // MUI dialogs handle Escape themselves.
    if (e.key === 'Escape') return;

    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      onHelpOpen();
      return;
    }

    if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      pendingGRef.current = true;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { pendingGRef.current = false; }, 500);
      return;
    }

    if (pendingGRef.current) {
      pendingGRef.current = false;
      clearTimeout(timerRef.current);

      switch (e.key) {
        case 'd': navigate('/'); break;
        case 'c': navigate('/channels'); break;
        case 's': navigate('/settings'); break;
        case 'a': navigate('/alerts'); break;
        case 'u': navigate('/users'); break;
        default: break;
      }
    }
  }, [navigate, onHelpOpen, onPaletteOpen]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timerRef.current);
    };
  }, [handleKeyDown]);
}
