// The server takes an id in either case and answers with it in lower case. Pages compare ids
// as text and key the query cache by them, so an id typed in capitals loads its page and
// misses the rest of what is about it (#406, D-368).

// eslint-disable-next-line no-restricted-syntax -- The hook the rule points to.
import { useParams, useSearchParams } from 'react-router';

/** Undefined on a route without an `:id`. */
export function useAddressId(): string | undefined {
  return useParams<{ id: string }>().id?.toLowerCase();
}

export function useAddressQueryId(name: string): string | null {
  const [search] = useSearchParams();
  return search.get(name)?.toLowerCase() ?? null;
}
