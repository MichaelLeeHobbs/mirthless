// ===========================================
// UI Store Tests (theme persistence)
// ===========================================

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

  it('reads the saved theme from galvaniflow_theme', async () => {
    localStorage.setItem('galvaniflow_theme', 'light');
    const store = await freshStore();
    expect(store.getState().themeMode).toBe('light');
  });

  it('falls back to the pre-rename mirthless_theme key', async () => {
    localStorage.setItem('mirthless_theme', 'light');
    const store = await freshStore();
    expect(store.getState().themeMode).toBe('light');
  });

  it('prefers galvaniflow_theme over the legacy key', async () => {
    localStorage.setItem('mirthless_theme', 'light');
    localStorage.setItem('galvaniflow_theme', 'dark');
    const store = await freshStore();
    expect(store.getState().themeMode).toBe('dark');
  });

  it('persists a toggle under galvaniflow_theme', async () => {
    const store = await freshStore();
    store.getState().toggleThemeMode();
    expect(localStorage.getItem('galvaniflow_theme')).toBe('light');
  });
});
