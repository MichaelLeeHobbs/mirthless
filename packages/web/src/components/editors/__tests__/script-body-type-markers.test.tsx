// #206: the hook that type-checks an editor's script through a hidden wrapped
// model. Monaco and its TypeScript worker are the external boundary, so they
// are faked here: the worker answers when the test says so, in any order.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

interface Disposable { dispose: () => void }
interface Deferred { readonly resolve: (diagnostics: unknown[]) => void; readonly reject: (err: unknown) => void }

const fake = vi.hoisted(() => {
  const state = {
    setModelMarkers: vi.fn(),
    hiddenModels: [] as Array<{ text: string; disposed: boolean }>,
    requests: [] as Array<{ resolve: (d: unknown[]) => void; reject: (e: unknown) => void }>,
    extraLibsListeners: [] as Array<() => void>,
  };
  const monaco = {
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    Uri: { parse: (s: string) => ({ toString: () => s }) },
    editor: {
      setModelMarkers: state.setModelMarkers,
      createModel: (text: string, _lang: string, uri: { toString: () => string }) => {
        const model = { text, disposed: false };
        state.hiddenModels.push(model);
        return {
          uri,
          setValue: (v: string) => { model.text = v; },
          // Every diagnostic in these tests is at offset 0 of the wrapper's second line.
          getPositionAt: () => ({ lineNumber: 2, column: 1 }),
          dispose: () => { model.disposed = true; },
        };
      },
    },
    typescript: {
      getTypeScriptWorker: async () => async () => ({
        getSemanticDiagnostics: () => new Promise<unknown[]>((resolve, reject) => { state.requests.push({ resolve, reject }); }),
      }),
      typescriptDefaults: {
        onDidExtraLibsChange: (listener: () => void) => {
          state.extraLibsListeners.push(listener);
          return { dispose: () => { state.extraLibsListeners.splice(state.extraLibsListeners.indexOf(listener), 1); } };
        },
      },
    },
  };
  return { state, monaco };
});

vi.mock('../monaco.js', () => ({ monaco: fake.monaco }));

const { useScriptBodyTypeMarkers, SCRIPT_BODY_MARKER_OWNER } = await import('../script-body-check.js');

/** The editor's visible model: text, a version that changes with it, and change listeners. */
function visibleModel(initial: string): {
  readonly editor: never; readonly model: object; readonly edit: (text: string) => void; readonly dispose: () => void;
} {
  let text = initial;
  let version = 1;
  let disposed = false;
  const listeners = new Set<() => void>();
  const model = {
    getValue: () => text,
    getVersionId: () => version,
    isDisposed: () => disposed,
    onDidChangeContent: (l: () => void): Disposable => { listeners.add(l); return { dispose: () => { listeners.delete(l); } }; },
  };
  return {
    editor: { getModel: () => model } as never,
    model,
    edit: (next) => { text = next; version += 1; for (const l of listeners) l(); },
    dispose: () => { disposed = true; },
  };
}

const diagnostic = (message: string): unknown => ({ category: 1, code: 2304, file: undefined, start: 0, length: 1, messageText: message });

/** Let the fake worker's promise chain run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

/** Run the delayed check and wait until it has asked the worker. */
async function runCheck(): Promise<Deferred> {
  const before = fake.state.requests.length;
  await vi.advanceTimersByTimeAsync(500);
  await settle();
  expect(fake.state.requests.length).toBe(before + 1);
  return fake.state.requests[before]!;
}

const markerMessages = (): string[][] => fake.state.setModelMarkers.mock.calls
  .filter((c) => c[1] === SCRIPT_BODY_MARKER_OWNER)
  .map((c) => (c[2] as Array<{ message: string }>).map((m) => m.message));

beforeEach(() => {
  vi.useFakeTimers();
  fake.state.setModelMarkers.mockClear();
  fake.state.hiddenModels.length = 0;
  fake.state.requests.length = 0;
  fake.state.extraLibsListeners.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useScriptBodyTypeMarkers', () => {
  it('checks the wrapped script and puts its errors on the visible model', async () => {
    const v = visibleModel("return [msg.get('MSH.10')];");
    renderHook(() => { useScriptBodyTypeMarkers(v.editor, true); });
    const request = await runCheck();
    expect(fake.state.hiddenModels[0]!.text).toBe("async function __galvanigraphScript() {\nreturn [msg.get('MSH.10')];\n}");
    request.resolve([diagnostic("Cannot find name 'msg'.")]);
    await settle();
    expect(markerMessages().at(-1)).toEqual(["Cannot find name 'msg'."]);
    expect(fake.state.setModelMarkers.mock.calls.at(-1)![0]).toBe(v.model);
  });

  it('keeps the newer check\'s answer when an older one finishes after it', async () => {
    const v = visibleModel('a');
    renderHook(() => { useScriptBodyTypeMarkers(v.editor, true); });
    const first = await runCheck();
    // A change of declarations (another surface, new templates) checks the same text again.
    for (const l of [...fake.state.extraLibsListeners]) l();
    const second = await runCheck();
    second.resolve([diagnostic('newer')]);
    await settle();
    first.resolve([diagnostic('older')]);
    await settle();
    expect(markerMessages()).toEqual([['newer']]);
  });

  it('drops an answer for text that changed while it was checked, and checks the new text', async () => {
    const v = visibleModel('a');
    renderHook(() => { useScriptBodyTypeMarkers(v.editor, true); });
    const stale = await runCheck();
    v.edit('b');
    stale.resolve([diagnostic('for the old text')]);
    await settle();
    expect(markerMessages()).toEqual([]);
    const fresh = await runCheck();
    fresh.resolve([]);
    await settle();
    expect(markerMessages()).toEqual([[]]);
  });

  it('says the editor could not check types when the worker fails', async () => {
    const v = visibleModel('a');
    renderHook(() => { useScriptBodyTypeMarkers(v.editor, true); });
    (await runCheck()).reject(new Error('worker crashed'));
    await settle();
    expect(markerMessages()).toEqual([['Types could not be checked here: worker crashed']]);
  });

  it('on unmount disposes the hidden model, clears its markers and ignores a late answer', async () => {
    const v = visibleModel('a');
    const { unmount } = renderHook(() => { useScriptBodyTypeMarkers(v.editor, true); });
    const pending = await runCheck();
    unmount();
    expect(fake.state.hiddenModels[0]!.disposed).toBe(true);
    expect(fake.state.extraLibsListeners).toEqual([]);
    expect(markerMessages()).toEqual([[]]);
    pending.resolve([diagnostic('late')]);
    await settle();
    expect(markerMessages()).toEqual([[]]);
    // No check is scheduled after unmount.
    v.edit('b');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.state.requests).toHaveLength(1);
  });

  it('while inactive (JavaScript, or another surface applied) shows no type errors and checks nothing', async () => {
    const v = visibleModel('a');
    renderHook(() => { useScriptBodyTypeMarkers(v.editor, false); });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.state.hiddenModels).toEqual([]);
    expect(fake.state.requests).toEqual([]);
    expect(markerMessages()).toEqual([[]]);
  });
});
