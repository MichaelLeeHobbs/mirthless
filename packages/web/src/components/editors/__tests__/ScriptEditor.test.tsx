// ===========================================
// ScriptEditor Monaco registration tests
// ===========================================
// Monaco is an external boundary: the Editor is replaced with a stub that
// hands a fake `monaco` to `beforeMount`, and the fake records every call
// made on each language's defaults. Registration happens once per page load,
// so both tests observe the same two mounts.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SANDBOX_TYPE_DEFS } from '../../../lib/sandbox-types.js';
import { ScriptEditor } from '../ScriptEditor.js';

const { fakeMonaco, calls, ES2020 } = vi.hoisted(() => {
  const recorded: Record<'javascript' | 'typescript', unknown[][]> = { javascript: [], typescript: [] };
  const defaults = (language: 'javascript' | 'typescript'): Record<string, (...args: unknown[]) => void> => ({
    setDiagnosticsOptions: (...args) => { recorded[language].push(['setDiagnosticsOptions', ...args]); },
    setCompilerOptions: (...args) => { recorded[language].push(['setCompilerOptions', ...args]); },
    addExtraLib: (...args) => { recorded[language].push(['addExtraLib', ...args]); },
  });
  const target = 7;
  return {
    ES2020: target,
    calls: recorded,
    fakeMonaco: {
      languages: {
        typescript: {
          ScriptTarget: { ES2020: target },
          javascriptDefaults: defaults('javascript'),
          typescriptDefaults: defaults('typescript'),
        },
      },
    },
  };
});

vi.mock('@monaco-editor/react', () => ({
  default: ({ beforeMount }: { beforeMount: (monaco: unknown) => void }): ReactNode => {
    beforeMount(fakeMonaco);
    return null;
  },
}));

const DIAGNOSTICS = { noSemanticValidation: true, noSyntaxValidation: false };
const EXTRA_LIB_PATH = 'file:///sandbox-globals.d.ts';

describe('ScriptEditor Monaco registration', () => {
  beforeAll(() => {
    render(<ScriptEditor height="100px" value="" onChange={() => undefined} />);
    render(<ScriptEditor height="100px" value="" onChange={() => undefined} language="typescript" />);
  });

  it('registers JavaScript diagnostics, compiler options and the sandbox type lib exactly once across two mounts', () => {
    expect(calls.javascript).toEqual([
      ['setDiagnosticsOptions', DIAGNOSTICS],
      ['setCompilerOptions', { target: ES2020, allowNonTsExtensions: true, allowJs: true, checkJs: false }],
      ['addExtraLib', SANDBOX_TYPE_DEFS, EXTRA_LIB_PATH],
    ]);
  });

  it('registers TypeScript diagnostics, strict compiler options and the sandbox type lib exactly once across two mounts', () => {
    expect(calls.typescript).toEqual([
      ['setDiagnosticsOptions', DIAGNOSTICS],
      ['setCompilerOptions', { target: ES2020, allowNonTsExtensions: true, strict: true }],
      ['addExtraLib', SANDBOX_TYPE_DEFS, EXTRA_LIB_PATH],
    ]);
  });
});
