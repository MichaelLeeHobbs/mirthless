// ===========================================
// Before-Unload Guard
// ===========================================
// Warns on browser refresh / tab close while there are unsaved changes. The
// editors use react-router's useBlocker for in-app navigation, but that does NOT
// cover a hard reload or closing the tab — this closes that gap so a dirty channel,
// alert, template, global script, or settings form isn't silently discarded.

import { useEffect } from 'react';

/**
 * Attach a `beforeunload` handler while `when` is true, prompting the browser's
 * native "leave site?" confirmation before a refresh/close discards unsaved work.
 */
export function useBeforeUnload(when: boolean): void {
  useEffect(() => {
    if (!when) return undefined;
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      // Required by some browsers to trigger the native prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => { window.removeEventListener('beforeunload', handler); };
  }, [when]);
}
