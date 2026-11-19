// Leading-and-trailing throttle (D-306).

export interface Throttle {
  readonly call: () => void;
  /** Drops a pending run; the throttle can be called again afterwards. */
  readonly cancel: () => void;
}

/**
 * At most one run per `intervalMs`, the first at once. The last call is never
 * lost: it runs at most `intervalMs` after it was made.
 */
export function createThrottle(fn: () => void, intervalMs: number): Throttle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  const openWindow = (): void => {
    timer = setTimeout(() => {
      timer = null;
      if (!pending) return;
      pending = false;
      openWindow();
      fn();
    }, intervalMs);
  };

  return {
    call: (): void => {
      if (timer !== null) {
        pending = true;
        return;
      }
      // The window opens first, so a throwing fn leaves the throttle in step.
      openWindow();
      fn();
    },
    cancel: (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = false;
    },
  };
}
