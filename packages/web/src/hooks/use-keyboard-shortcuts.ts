// ===========================================
// Keyboard Shortcuts Hook
// ===========================================
// Global keyboard shortcuts: ? for help, g+d dashboard, g+c channels, g+s settings, Escape close.

import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface UseKeyboardShortcutsOptions {
  readonly onHelpOpen: () => void;
}

/** Returns true if focus is on an input element that captures typing. */
function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  const role = document.activeElement?.getAttribute('role');
  if (role === 'textbox') return true;
  if (document.activeElement?.getAttribute('contenteditable') === 'true') return true;
  return false;
}

export function useKeyboardShortcuts({ onHelpOpen }: UseKeyboardShortcutsOptions): void {
  const navigate = useNavigate();
  const pendingGRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleKeyDown = useCallback((e: KeyboardEvent): void => {
    if (isInputFocused()) return;

    // Escape — close any open dialogs (browser-native for MUI)
    if (e.key === 'Escape') return;

    // ? — open help dialog
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      onHelpOpen();
      return;
    }

    // g prefix — navigation shortcuts
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
  }, [navigate, onHelpOpen]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timerRef.current);
    };
  }, [handleKeyDown]);
}
