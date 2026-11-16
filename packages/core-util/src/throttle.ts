// ===========================================
// Leading-and-trailing throttle
// ===========================================
// Used by the server to coalesce live socket events and by the web to limit
// the refetches those events start (D-306).

/** A throttled function and a way to drop its pending run. */
export interface Throttle {
  /** Run now when no window is open; otherwise run once when the open window ends. */
  readonly call: () => void;
  /** Drop a pending run and close the window. The throttle can be called again afterwards. */
  readonly cancel: () => void;
}

/**
 * Throttle `fn` to at most one run per `intervalMs`. The first call runs at once
 * and opens a window; calls inside the window collapse into one run when it ends,
 * which opens the next window. The last call is therefore never lost: it runs at
 * most `intervalMs` after it was made.
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
