/** `undefined` and `''` mean "not set". */
export type SearchParamValue = string | number | undefined;

export function definedSearchParams(params: Readonly<Record<string, SearchParamValue>>): URLSearchParams {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') searchParams.set(key, String(value));
  }
  return searchParams;
}
