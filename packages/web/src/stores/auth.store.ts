import { create } from 'zustand';

/** User profile returned from the API after authentication */
interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly role: string;
  readonly permissions: ReadonlyArray<string>;
}

interface AuthState {
  readonly user: AuthUser | null;
  readonly accessToken: string | null;
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
}

interface AuthActions {
  readonly setAuth: (user: AuthUser, accessToken: string) => void;
  readonly setAccessToken: (accessToken: string) => void;
  readonly clearAuth: () => void;
  readonly setLoading: (isLoading: boolean) => void;
}

type AuthStore = AuthState & AuthActions;

const STORAGE_KEY = 'mirthless_auth';

function loadPersistedState(): Pick<AuthState, 'user' | 'accessToken' | 'isAuthenticated'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { user: null, accessToken: null, isAuthenticated: false };
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'user' in parsed &&
      'accessToken' in parsed
    ) {
      const state = parsed as { user: unknown; accessToken: unknown };
      if (typeof state.accessToken === 'string' && state.user !== null) {
        return {
          user: state.user as AuthUser,
          accessToken: state.accessToken,
          isAuthenticated: true,
        };
      }
    }
  } catch {
    // Corrupted storage — ignore and start fresh
  }
  return { user: null, accessToken: null, isAuthenticated: false };
}

function persistState(user: AuthUser | null, accessToken: string | null): void {
  if (user && accessToken) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, accessToken }));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

const initialState = loadPersistedState();

export const useAuthStore = create<AuthStore>((set) => ({
  user: initialState.user,
  accessToken: initialState.accessToken,
  isAuthenticated: initialState.isAuthenticated,
  isLoading: false,

  setAuth: (user: AuthUser, accessToken: string): void => {
    persistState(user, accessToken);
    set({ user, accessToken, isAuthenticated: true, isLoading: false });
  },

  setAccessToken: (accessToken: string): void => {
    set((state) => {
      persistState(state.user, accessToken);
      return { accessToken };
    });
  },

  clearAuth: (): void => {
    persistState(null, null);
    set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
  },

  setLoading: (isLoading: boolean): void => {
    set({ isLoading });
  },
}));
