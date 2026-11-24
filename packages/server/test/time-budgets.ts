/**
 * For a hook that loads routes/index.ts or app.ts. Either is over 400 modules with no single
 * dependency to blame, and took 4 to 14 s when this was set. On a host busy with other builds a
 * load went past 60 s while the whole server run took 154 s (#322), so this is longer than that run.
 */
export const ROUTE_TREE_LOAD_MS = 180_000;
