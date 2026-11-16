// ===========================================
// Worker entry
// ===========================================
// Where a worker thread's entry file is, next to the module that starts it.
// From TypeScript source (dev, tests) the worker is a .ts file loaded through
// tsx, which maps its `.js` imports to `.ts` files; the built package runs the
// compiled .js file directly.

/** The worker file `name` (without extension) beside `moduleUrl`, and how to start it. */
export function workerEntry(moduleUrl: string, name: string): { readonly url: URL; readonly execArgv: string[] } {
  const fromSource = moduleUrl.endsWith('.ts');
  return {
    url: new URL(`./${name}${fromSource ? '.ts' : '.js'}`, moduleUrl),
    execArgv: fromSource ? ['--import', 'tsx'] : [],
  };
}
