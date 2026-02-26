import { create } from 'zustand';

type ThemeMode = 'dark' | 'light';

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
  themeMode: 'dark',
  sidebarOpen: true,

  toggleThemeMode: (): void => {
    set((state) => ({
      themeMode: state.themeMode === 'dark' ? 'light' : 'dark',
    }));
  },

  toggleSidebar: (): void => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },

  setSidebarOpen: (open: boolean): void => {
    set({ sidebarOpen: open });
  },
}));
