/**
 * Auth Context Provider
 *
 * Provides a single shared auth state across the component tree.
 * Without this, each call to useAuth() creates its own polling loop.
 * The context ensures one source of truth for authentication state
 * and a single polling interval for the /auth/status endpoint.
 */

import { createContext, useContext, type ReactNode } from 'react';

import { useAuth } from '@/shared/hooks/useAuth';
import type { AuthActions, AuthState } from '@/shared/hooks/useAuth';

type AuthContextValue = AuthState & AuthActions;

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Wrap your app (or a subtree) in AuthProvider to share auth state.
 * Components beneath this can use useAuthContext() instead of useAuth()
 * to avoid creating duplicate polling loops.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const auth = useAuth();

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

/**
 * Access shared auth state from the nearest AuthProvider.
 * Throws if used outside an AuthProvider — this is intentional
 * to catch misuse early in development.
 */
export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used within an <AuthProvider>');
  }
  return ctx;
}
