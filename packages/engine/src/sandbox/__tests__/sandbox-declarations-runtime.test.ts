// The TypeScript declarations scripts are checked against (core-models
// scriptDeclarations) must name exactly the globals the sandbox gives a script.
// A global the runtime has but the declarations lack refuses valid TypeScript
// at deploy; one the declarations have but the runtime lacks passes the check
// and fails when the channel runs. This test asks the sandbox itself.

import { describe, it, expect } from 'vitest';
import { scriptDeclarations } from '@galvanigraph/core-models';
import { VmSandboxExecutor } from '../sandbox-executor.js';
import { createSandboxContext, type SandboxContext } from '../sandbox-context.js';
import { compileScript } from '../script-compiler.js';
import { DestinationSet, createDestinationSetProxy } from '../../pipeline/destination-set.js';

/** Globals every JavaScript realm has; scripts may use them, and they are not ours to declare. */
const REALM_GLOBALS = new Set(Object.getOwnPropertyNames(globalThis));

/** The server always gives the sandbox every IO bridge; these stand in for them. */
const BRIDGES = {
  httpFetch: async () => ({ status: 200, headers: {}, body: '' }),
  dbQuery: async () => ({ rows: [], rowCount: 0 }),
  routeMessage: async () => ({ success: true }),
  getResource: async () => null,
  collections: { find: async () => [], store: async () => ({}), update: async () => null, delete: async () => false },
} as unknown as ConstructorParameters<typeof VmSandboxExecutor>[0];

async function runtimeGlobals(context: SandboxContext): Promise<string[]> {
  const compiled = await compileScript('return Object.getOwnPropertyNames(globalThis);', { sourcefile: 'globals.ts' });
  if (!compiled.ok) throw compiled.error;
  const result = await new VmSandboxExecutor(BRIDGES).execute(compiled.value, context, { timeout: 5_000 });
  if (!result.ok) throw result.error;
  // Names starting with __ are the sandbox's own plumbing, not part of the script API.
  return (result.value.returnValue as string[]).filter((n) => !REALM_GLOBALS.has(n) && !n.startsWith('__')).sort();
}

/** Top-level names a declaration file declares (var, const, function). */
function declaredGlobals(declarations: string): string[] {
  const names = [...declarations.matchAll(/^declare (?:var|const|let|function) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]!);
  return [...new Set(names)].sort();
}

/** What the runtime has that is not declared, and what is declared that the runtime lacks. */
function drift(declared: readonly string[], runtime: readonly string[]): { undeclared: string[]; missing: string[] } {
  return {
    undeclared: runtime.filter((n) => !declared.includes(n)),
    missing: declared.filter((n) => !runtime.includes(n)),
  };
}

describe('script declarations match the sandbox', () => {
  it('in a pipeline script (filter, transformer, pre- and postprocessor)', async () => {
    const context = createSandboxContext('MSH|^~\\&|', 'MSH|^~\\&|', 'MSH|^~\\&|');
    const ds = new DestinationSet([{ name: 'To EHR', metaDataId: 1 }]);
    const withDestinations: SandboxContext = { ...context, extras: { destinationSet: createDestinationSetProxy(ds) } };
    const declared = declaredGlobals(scriptDeclarations({ dataType: 'HL7V2', destinationSet: true }));
    expect(drift(declared, await runtimeGlobals(withDestinations))).toEqual({ undeclared: [], missing: [] });
  });

  it('in a deploy or undeploy script, which runs with the channel id and name but no message', async () => {
    const context: SandboxContext = { ...createSandboxContext('', '', ''), extras: { channelId: 'c1', channelName: 'ADT' } };
    // The engine passes msg, tmp and rawData empty there, so they are deliberately not declared.
    const runtime = (await runtimeGlobals(context)).filter((n) => !['msg', 'tmp', 'rawData'].includes(n));
    expect(drift(declaredGlobals(scriptDeclarations({ message: false })), runtime)).toEqual({ undeclared: [], missing: [] });
  });

  // The server runs a JavaScript destination's script with these extras (engine.ts, wireJavaScriptDestinations).
  it('in a JavaScript destination script, which also gets the channel identity and the connector message', async () => {
    const connectorMessage = { channelId: 'c1', messageId: 7, metaDataId: 1, content: 'MSH|^~\\&|', dataType: 'HL7V2' };
    const context: SandboxContext = {
      ...createSandboxContext('MSH|^~\\&|', 'MSH|^~\\&|', 'MSH|^~\\&|'),
      extras: { channelId: 'c1', channelName: 'ADT', connectorMessage },
    };
    const declared = declaredGlobals(scriptDeclarations({ dataType: 'HL7V2', connectorMessage: true }));
    expect(drift(declared, await runtimeGlobals(context))).toEqual({ undeclared: [], missing: [] });
  });
});
