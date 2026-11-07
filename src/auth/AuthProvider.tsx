import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { apiRequest, AuthResponse, AuthSession, AuthUser } from './api';

const TOKEN_KEY = 'alorun.refresh-token';
// Native refresh tokens stay in the device keystore. Browser sessions are temporary.
const storage = {
  get: () => Platform.OS === 'web' ? Promise.resolve(typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(TOKEN_KEY)) : SecureStore.getItemAsync(TOKEN_KEY),
  set: (value: string) => Platform.OS === 'web' ? Promise.resolve(typeof sessionStorage === 'undefined' ? undefined : sessionStorage.setItem(TOKEN_KEY, value)) : SecureStore.setItemAsync(TOKEN_KEY, value),
  remove: () => Platform.OS === 'web' ? Promise.resolve(typeof sessionStorage === 'undefined' ? undefined : sessionStorage.removeItem(TOKEN_KEY)) : SecureStore.deleteItemAsync(TOKEN_KEY),
};

type AuthContextValue = {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: AuthUser | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
  request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const session = useRef<AuthSession | null>(null);
  const refreshInFlight = useRef<Promise<AuthSession> | null>(null);
  const generation = useRef(0);

  const accept = useCallback(async (result: AuthResponse) => {
    if (!result.session) return false;
    await storage.set(result.session.refreshToken);
    session.current = result.session;
    setUser(result.user);
    setStatus('signedIn');
    return true;
  }, []);

  const refresh = useCallback(async (token: string): Promise<AuthSession> => {
    if (!refreshInFlight.current) {
      const startedAt = generation.current;
      refreshInFlight.current = (async () => {
        const result = await apiRequest<AuthResponse>('/auth/refresh', { method: 'POST', body: { refreshToken: token } });
        if (!result.session || startedAt !== generation.current) throw new Error('Session expired. Please sign in again.');
        await accept(result);
        return result.session;
      })().finally(() => { refreshInFlight.current = null; });
    }
    return refreshInFlight.current;
  }, [accept]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await storage.get();
        if (token) { await refresh(token); return; }
      } catch {
        // Keep the stored token on network failure so the user can retry on restart.
      }
      if (active) setStatus('signedOut');
    })();
    return () => { active = false; };
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await apiRequest<AuthResponse>('/auth/sign-in', { method: 'POST', body: { email, password } });
    if (!await accept(result)) throw new Error('Check your email to confirm your account first.');
  }, [accept]);
  const signUp = useCallback(async (email: string, password: string) => {
    const result = await apiRequest<AuthResponse>('/auth/sign-up', { method: 'POST', body: { email, password } });
    return accept(result);
  }, [accept]);
  const signOut = useCallback(async () => {
    generation.current += 1;
    const token = session.current?.accessToken;
    session.current = null;
    setUser(null);
    setStatus('signedOut');
    await storage.remove();
    if (token) {
      try { await apiRequest('/auth/sign-out', { method: 'POST', token }); } catch { /* Local sign-out still succeeds offline. */ }
    }
  }, []);
  const request = useCallback(async <T,>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> => {
    let current = session.current;
    if (!current) throw new Error('Please sign in first.');
    if (current.expiresAt && current.expiresAt * 1000 <= Date.now() + 60_000) current = await refresh(current.refreshToken);
    return apiRequest<T>(path, { ...options, token: current.accessToken });
  }, [refresh]);
  return <AuthContext.Provider value={{ status, user, signIn, signUp, signOut, request }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
