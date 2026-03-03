// ===========================================
// Context Menu Hook
// ===========================================
// Reusable hook for right-click context menus.

import { useState, useCallback, type MouseEvent } from 'react';

export interface ContextMenuState {
  readonly mouseX: number;
  readonly mouseY: number;
}

interface UseContextMenuReturn<T> {
  readonly menuState: ContextMenuState | null;
  readonly menuTarget: T | null;
  readonly handleContextMenu: (event: MouseEvent, target: T) => void;
  readonly handleClose: () => void;
}

export function useContextMenu<T>(): UseContextMenuReturn<T> {
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);
  const [menuTarget, setMenuTarget] = useState<T | null>(null);

  const handleContextMenu = useCallback((event: MouseEvent, target: T): void => {
    event.preventDefault();
    setMenuState({ mouseX: event.clientX, mouseY: event.clientY });
    setMenuTarget(target);
  }, []);

  const handleClose = useCallback((): void => {
    setMenuState(null);
    setMenuTarget(null);
  }, []);

  return { menuState, menuTarget, handleContextMenu, handleClose };
}
