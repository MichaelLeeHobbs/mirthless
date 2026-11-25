import { z } from 'zod/v4';

/**
 * An id from outside the server. Postgres takes a UUID in either case and returns it
 * in lower case, and the server compares ids as text, so an id kept as typed finds its
 * row and misses the checks that compare it (D-348).
 */
// eslint-disable-next-line no-restricted-syntax -- The schema the rule points to.
export const idSchema = z.uuid().toLowerCase();
