// ===========================================
// Search Params
// ===========================================

/** A query parameter value; `undefined` and `''` mean "not set". */
export type SearchParamValue = string | number | undefined;

/**
 * URLSearchParams holding the entries of `params` that are set, in the order
 * the object lists them. `undefined` and empty strings are left out; numbers,
 * zero included, are sent as text.
 */
export function definedSearchParams(params: Readonly<Record<string, SearchParamValue>>): URLSearchParams {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') searchParams.set(key, String(value));
  }
  return searchParams;
}
