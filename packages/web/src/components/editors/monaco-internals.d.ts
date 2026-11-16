// Types for the two Monaco internals monaco.ts uses to show documentation
// beside completion suggestions by default. Monaco ships no declarations for
// these deep paths; only what is used is declared.

declare module 'monaco-editor/esm/vs/platform/storage/common/storage.js' {
  /** Service identifier for Monaco's storage service. */
  export const IStorageService: unknown;
}

declare module 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js' {
  interface StorageService {
    store(key: string, value: boolean | string, scope: number, target: number): void;
  }
  export const StandaloneServices: {
    get(id: unknown): StorageService;
    withServices(callback: () => void): { dispose(): void };
  };
}
