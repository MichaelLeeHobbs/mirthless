/**
 * For a unit test hook that loads every router. One went past its 60 s limit on a host busy with
 * other builds, in a server unit run that took 154 s in all (#322), so this is longer than that run.
 */
export const ROUTE_TREE_LOAD_MS = 180_000;

/**
 * Any test or hook of the integration suite. None relies on failing sooner, and on a busy host one
 * that takes a second alone went past 30 s (#405).
 */
export const INTEGRATION_LIMIT_MS = 120_000;

/** One wait on a condition, or for a connection. Below the limit above, so a wait that fails says which it was. */
export const INTEGRATION_WAIT_MS = 60_000;
