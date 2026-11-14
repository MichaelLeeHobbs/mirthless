// ===========================================
// Error Info
// ===========================================

/**
 * Turn any caught value into a loggable record with the fields the logging
 * standard names: `errMsg`, plus `name` and `stack` when the value has them.
 * An error-shaped plain object (a rejected `{ message }` from a library) keeps
 * its message instead of logging as "[object Object]". Never throws.
 */
export function errorInfo(err: unknown): Readonly<Record<string, unknown>> {
  if (err instanceof Error) {
    return { errMsg: err.message, name: err.name, stack: err.stack };
  }
  if (typeof err === 'object' && err !== null) {
    const { message, name, stack } = err as { message?: unknown; name?: unknown; stack?: unknown };
    if (typeof message === 'string') {
      return {
        errMsg: message,
        ...(typeof name === 'string' ? { name } : {}),
        ...(typeof stack === 'string' ? { stack } : {}),
      };
    }
  }
  try {
    return { errMsg: String(err) };
  } catch {
    return { errMsg: 'Unprintable error value' };
  }
}
