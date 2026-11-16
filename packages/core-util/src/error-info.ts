// ===========================================
// Error Info
// ===========================================

/**
 * Turn any caught value into a loggable record with the fields the logging
 * standard names: `errMsg`, plus `name` and `stack` when the value has them.
 * An error-shaped plain object (a rejected `{ message }` from a library) keeps
 * its message instead of logging as "[object Object]". Never throws: a value
 * whose getters or Proxy traps throw falls back to its string form, then to
 * "Unprintable error value".
 */
export function errorInfo(err: unknown): Readonly<Record<string, unknown>> {
  try {
    const fields = readErrorFields(err);
    if (fields !== null) { return fields; }
  } catch {
    // A getter or Proxy trap threw: fall through to the string form.
  }
  try {
    return { errMsg: String(err) };
  } catch {
    return { errMsg: 'Unprintable error value' };
  }
}

/** The fields of an Error or error-shaped object, or null for anything else. May throw. */
function readErrorFields(err: unknown): Readonly<Record<string, unknown>> | null {
  if (err instanceof Error) {
    return { errMsg: err.message, name: err.name, stack: err.stack };
  }
  if (typeof err !== 'object' || err === null) { return null; }
  const { message, name, stack } = err as { message?: unknown; name?: unknown; stack?: unknown };
  if (typeof message !== 'string') { return null; }
  return {
    errMsg: message,
    ...(typeof name === 'string' ? { name } : {}),
    ...(typeof stack === 'string' ? { stack } : {}),
  };
}
