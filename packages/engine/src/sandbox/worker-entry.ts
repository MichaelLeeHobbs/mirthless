// ===========================================
// Worker entry
// ===========================================
// Where a worker thread's entry file is, next to the module that starts it.
// From TypeScript source (dev, tests) the worker is a .ts file loaded through
// tsx, which maps its `.js` imports to `.ts` files; the built package runs the
// compiled .js file directly.

/** Where tsx keeps its compile cache; without these it writes to a folder named "undefined". */
const TEMP_VARIABLES = ['TMPDIR', 'TMP', 'TEMP'] as const;

/**
 * The worker file `name` (without extension) beside `moduleUrl`, and how to
 * start it. Workers run without the server's environment (database URL, JWT
 * secret): the built package gets none at all, and tsx from source only the
 * temp-directory variables it needs.
 */
export function workerEntry(moduleUrl: string, name: string): {
  readonly url: URL; readonly execArgv: string[]; readonly env: Record<string, string>;
} {
  const fromSource = moduleUrl.endsWith('.ts');
  const env: Record<string, string> = {};
  if (fromSource) {
    for (const key of TEMP_VARIABLES) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
  }
  return {
    url: new URL(`./${name}${fromSource ? '.ts' : '.js'}`, moduleUrl),
    execArgv: fromSource ? ['--import', 'tsx'] : [],
    env,
  };
}
