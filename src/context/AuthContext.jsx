/**
 * AuthContext — global authentication state management.
 *
 * Provides:
 *   user            — the authenticated user object (or null)
 *   isLoading       — true while the initial auth check is in flight
 *   isAuthenticated — boolean convenience
 *   signIn(email, password) → { user } | throws
 *   signUp(data)            → { user } | throws
 *   signOut()               → void
 *   updateUser(userData)    → void  — refreshes user in context after profile save
 */
import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { login, logout, getMe, register } from '../services/authService';
import { clearExplanationCache } from '../services/aiExplanationService';
import { clearAllScanProgress } from '../utils/persistenceUtils';

const AuthContext = createContext(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};

// ── Token persistence helpers ─────────────────────────────────────────────────
const storeTokens = ({ access, refresh }) => {
  localStorage.setItem('access_token', access);
  localStorage.setItem('refresh_token', refresh);
};

const clearTokens = () => {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
};

const hasTokens = () =>
  !!localStorage.getItem('access_token') && !!localStorage.getItem('refresh_token');

/**
 * Wipe all user-specific in-memory and cached state from localStorage so that
 * a subsequent login by a different account starts from a clean slate.
 */
const clearUserCache = () => {
  clearAllScanProgress();
  // Remove the legacy un-namespaced activeScan key
  localStorage.removeItem('activeScan');
  // AI explanations are cached in memory — they must never survive a change
  // of account.
  clearExplanationCache();
};

// ── Provider ──────────────────────────────────────────────────────────────────
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * On mount: if tokens exist in localStorage, fetch the current user
   * so auth state is restored across page refreshes.
   */
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      if (!hasTokens()) {
        setIsLoading(false);
        return;
      }
      try {
        const { data } = await getMe();
        if (!cancelled) setUser(data);
      } catch {
        // Token expired / invalid — clear storage; user will be redirected by ProtectedRoute
        clearTokens();
        clearUserCache();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    restore();

    // Listen for the forced-logout event dispatched by the Axios interceptor
    const handleForcedLogout = () => {
      clearTokens();
      clearUserCache();
      setUser(null);
    };
    window.addEventListener('auth:logout', handleForcedLogout);

    return () => {
      cancelled = true;
      window.removeEventListener('auth:logout', handleForcedLogout);
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    // Clear any stale cache from a previous session before loading new user data
    clearUserCache();
    const { data } = await login({ email, password });
    storeTokens({ access: data.access, refresh: data.refresh });
    setUser(data.user);
    return { user: data.user };
  }, []);

  const signUp = useCallback(async (formData) => {
    clearUserCache();
    const { data } = await register(formData);
    storeTokens({ access: data.access, refresh: data.refresh });
    setUser(data.user);
    return { user: data.user };
  }, []);

  const signOut = useCallback(async () => {
    const refresh = localStorage.getItem('refresh_token');
    try {
      if (refresh) await logout(refresh);
    } catch {
      // Best-effort: clear local state even if blacklist call fails
    }
    // Wipe tokens and all user-specific cached state before nulling user,
    // so no component can briefly see stale data belonging to the old account.
    clearTokens();
    clearUserCache();
    setUser(null);
  }, []);

  /**
   * Merge updated user fields into the context without a round-trip to /me/.
   * Used by the Profile settings page after a successful PATCH /api/auth/me/.
   * @param {object} userData — partial or full user object returned by the API
   */
  const updateUser = useCallback((userData) => {
    setUser((prev) => (prev ? { ...prev, ...userData } : userData));
  }, []);

  /**
   * Replace the stored JWT tokens after a password change.
   * The backend issues a new pair so the session stays active.
   * @param {{ access: string, refresh: string }} tokens
   */
  const replaceTokens = useCallback((tokens) => {
    storeTokens(tokens);
  }, []);

  const value = {
    user,
    isLoading,
    isAuthenticated: !!user,
    signIn,
    signUp,
    signOut,
    updateUser,
    replaceTokens,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
