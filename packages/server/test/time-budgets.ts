/**
 * For a unit test hook that loads every router. One went past its 60 s limit on a host busy with
 * other builds, in a server unit run that took 154 s in all (#322), so this is longer than that run.
 */
export const ROUTE_TREE_LOAD_MS = 180_000;
