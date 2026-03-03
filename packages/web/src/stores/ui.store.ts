import { create } from 'zustand';

type ThemeMode = 'dark' | 'light';

const THEME_STORAGE_KEY = 'mirthless_theme';

function loadThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
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
