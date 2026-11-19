import { create } from 'zustand';
import type { GrantEntry } from '@galvanigraph/core-models';

export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly role: string;
  readonly permissions: ReadonlyArray<string>;
  /** Absent from older servers (D-310). */
  readonly grants?: ReadonlyArray<GrantEntry>;
  /** ISO time the first temporary access ends; absent from older servers. */
  readonly nextExpiryAt?: string | null;
}

interface AuthState {
  readonly user: AuthUser | null;
  readonly accessToken: string | null;
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  /** The self-change endpoint clears this on the server; mirror it with clearMustChangePassword. */
  readonly mustChangePassword: boolean;
  /**
   * When a refresh found the user's access had changed (ISO), so a 403 or 404
   * may mean "no longer yours" rather than "deleted" (D-310). Not persisted.
   */
  readonly accessChangedAt: string | null;
}

interface AuthActions {
  readonly setAccessChanged: (at: string | null) => void;
  readonly setAuth: (user: AuthUser, accessToken: string, mustChangePassword?: boolean) => void;
  readonly setAccessToken: (accessToken: string) => void;
  readonly clearAuth: () => void;
  readonly setLoading: (isLoading: boolean) => void;
  readonly clearMustChangePassword: () => void;
}

type AuthStore = AuthState & AuthActions;

const STORAGE_KEY = 'galvanigraph_auth';

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
  accessChangedAt: null,

  setAccessChanged: (at: string | null): void => {
    set({ accessChangedAt: at });
  },

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
    set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false, mustChangePassword: false, accessChangedAt: null });
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
