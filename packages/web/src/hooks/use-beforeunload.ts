// react-router's useBlocker does not cover a hard reload or a tab close; this does.

import { useEffect } from 'react';

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
