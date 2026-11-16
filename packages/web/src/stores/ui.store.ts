import { create } from 'zustand';

type ThemeMode = 'dark' | 'light';

const THEME_STORAGE_KEY = 'galvanigraph_theme';
/**
 * Keys used under the product's earlier names, newest first: GalvaniFlow (D-309)
 * and Mirthless (D-205). Read only, so existing users keep their theme.
 * `index.html` reads the same keys before first paint.
 */
const LEGACY_THEME_STORAGE_KEYS: readonly string[] = ['galvaniflow_theme', 'mirthless_theme'];

function loadThemeMode(): ThemeMode {
  try {
    const stored = [THEME_STORAGE_KEY, ...LEGACY_THEME_STORAGE_KEYS]
      .map((key) => localStorage.getItem(key))
      .find((value) => value !== null);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage may be unavailable
  }
  return 'dark';
}

function persistThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // localStorage may be unavailable
  }
}

interface UiState {
  readonly themeMode: ThemeMode;
  readonly sidebarOpen: boolean;
}

interface UiActions {
  readonly toggleThemeMode: () => void;
  readonly toggleSidebar: () => void;
  readonly setSidebarOpen: (open: boolean) => void;
}

type UiStore = UiState & UiActions;

export const useUiStore = create<UiStore>((set) => ({
  themeMode: loadThemeMode(),
  sidebarOpen: true,

  toggleThemeMode: (): void => {
    set((state) => {
      const next = state.themeMode === 'dark' ? 'light' : 'dark';
      persistThemeMode(next);
      return { themeMode: next };
    });
  },

  toggleSidebar: (): void => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },

  setSidebarOpen: (open: boolean): void => {
    set({ sidebarOpen: open });
  },
}));
