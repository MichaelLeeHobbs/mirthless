export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${String(ms)}ms`);
    this.name = 'TimeoutError';
  }
}

/** Does not cancel the underlying work: the promise keeps running, only the caller stops waiting. */
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
