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
  /**
   * True when the server requires the signed-in user to change their password
   * before using the app (e.g. a seeded/flagged admin). The self-change endpoint
   * clears the flag server-side; the UI mirrors that via clearMustChangePassword.
   */
  readonly mustChangePassword: boolean;
}

interface AuthActions {
  readonly setAuth: (user: AuthUser, accessToken: string, mustChangePassword?: boolean) => void;
  readonly setAccessToken: (accessToken: string) => void;
  readonly clearAuth: () => void;
  readonly setLoading: (isLoading: boolean) => void;
  readonly clearMustChangePassword: () => void;
}

type AuthStore = AuthState & AuthActions;

const STORAGE_KEY = 'mirthless_auth';

function loadPersistedState(): Pick<AuthState, 'user' | 'accessToken' | 'isAuthenticated' | 'mustChangePassword'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { user: null, accessToken: null, isAuthenticated: false, mustChangePassword: false };
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'user' in parsed &&
      'accessToken' in parsed
    ) {
      const state = parsed as { user: unknown; accessToken: unknown; mustChangePassword?: unknown };
      if (typeof state.accessToken === 'string' && state.user !== null) {
        return {
          user: state.user as AuthUser,
          accessToken: state.accessToken,
          isAuthenticated: true,
          mustChangePassword: state.mustChangePassword === true,
        };
      }
    }
  } catch {
    // Corrupted storage — ignore and start fresh
  }
  return { user: null, accessToken: null, isAuthenticated: false, mustChangePassword: false };
}

function persistState(user: AuthUser | null, accessToken: string | null, mustChangePassword: boolean): void {
  if (user && accessToken) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, accessToken, mustChangePassword }));
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
  mustChangePassword: initialState.mustChangePassword,

  setAuth: (user: AuthUser, accessToken: string, mustChangePassword = false): void => {
    persistState(user, accessToken, mustChangePassword);
    set({ user, accessToken, isAuthenticated: true, isLoading: false, mustChangePassword });
  },

  setAccessToken: (accessToken: string): void => {
    set((state) => {
      persistState(state.user, accessToken, state.mustChangePassword);
      return { accessToken };
    });
  },

  clearAuth: (): void => {
    persistState(null, null, false);
    set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false, mustChangePassword: false });
  },

  setLoading: (isLoading: boolean): void => {
    set({ isLoading });
  },

  clearMustChangePassword: (): void => {
    set((state) => {
      persistState(state.user, state.accessToken, false);
      return { mustChangePassword: false };
    });
  },
}));
