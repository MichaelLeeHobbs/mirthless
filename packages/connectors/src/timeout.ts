// ===========================================
// Async Timeout Utilities
// ===========================================
// Bounds connector operations that have no native cancellation (nodemailer
// sendMail, IMAP client calls) so a hung remote endpoint cannot wedge a
// connector forever. All async I/O must have a timeout.

/** Error thrown when an operation exceeds its timeout budget. */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${String(ms)}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Race a promise against a timeout. If the promise settles first its result is
 * returned; otherwise a {@link TimeoutError} is thrown. The timer is always
 * cleared so a resolved promise does not leave the event loop pinned.
 *
 * Note: this does NOT cancel the underlying work (the promise keeps running);
 * it only stops the caller from waiting on it — acceptable for the poll/send
 * paths where the alternative is an unbounded hang.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Race a promise against BOTH a timeout and an AbortSignal. Rejects with a
 * {@link TimeoutError} on timeout, or with the signal's reason (or a generic
 * abort error) if the signal fires first. Used where a caller already owns an
 * AbortSignal (e.g. a destination send) but the underlying client cannot honor
 * it directly.
 */
export async function withTimeoutSignal<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return withTimeout(promise, ms, label);
  if (signal.aborted) {
    throw signalReason(signal, label);
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = (): void => reject(signalReason(signal, label));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([withTimeout(promise, ms, label), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function signalReason(signal: AbortSignal, label: string): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  return new Error(`${label} aborted`);
}
