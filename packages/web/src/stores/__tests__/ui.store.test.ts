import { describe, it, expect, beforeEach, vi } from 'vitest';

type UiStoreModule = typeof import('../ui.store.js');

/** Re-import the store so it reads localStorage again at creation. */
async function freshStore(): Promise<UiStoreModule['useUiStore']> {
  vi.resetModules();
  const mod: UiStoreModule = await import('../ui.store.js');
  return mod.useUiStore;
}

describe('ui store theme mode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to dark when nothing is saved', async () => {
    const store = await freshStore();
    expect(store.getState().themeMode).toBe('dark');
  });

  it('reads the saved theme from galvanigraph_theme', async () => {
    localStorage.setItem('galvanigraph_theme', 'light');
    const store = await freshStore();
    expect(store.getState().themeMode).toBe('light');
  });

  it.each(['galvaniflow_theme', 'mirthless_theme'])('falls back to the pre-rename %s key', async (legacy) => {
    localStorage.setItem(legacy, 'light');
    const store = await freshStore();
    expect(store.getState().themeMode).toBe('light');
  });

  it('prefers galvanigraph_theme over the legacy keys', async () => {
    localStorage.setItem('mirthless_theme', 'light');
    localStorage.setItem('galvaniflow_theme', 'light');
    localStorage.setItem('galvanigraph_theme', 'dark');
    const store = await freshStore();
    expect(store.getState().themeMode).toBe('dark');
  });

  it('prefers galvaniflow_theme over mirthless_theme', async () => {
    localStorage.setItem('mirthless_theme', 'dark');
    localStorage.setItem('galvaniflow_theme', 'light');
    const store = await freshStore();
    expect(store.getState().themeMode).toBe('light');
  });

  it('persists a toggle under galvanigraph_theme', async () => {
    const store = await freshStore();
    store.getState().toggleThemeMode();
    expect(localStorage.getItem('galvanigraph_theme')).toBe('light');
  });
});
