'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, onAuthError, setToken } from '@/lib/api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setReady(true);
      return null;
    }
    try {
      const me = await api('auth/me');
      setUser(me);
      return me;
    } catch {
      setToken(null);
      setUser(null);
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(
    () =>
      onAuthError((err) => {
        if (err.code === 'PASSWORD_CHANGE_REQUIRED') router.replace('/change-password');
        else {
          setToken(null);
          setUser(null);
          router.replace('/login');
        }
      }),
    [router],
  );

  const login = useCallback(async (email, password) => {
    const r = await api('auth/login', { method: 'POST', body: { email, password } });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const acceptSession = useCallback((r) => {
    setToken(r.token);
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    api('auth/logout', { method: 'POST' }).catch(() => {});
    setToken(null);
    setUser(null);
    router.replace('/login');
  }, [router]);

  return <AuthCtx.Provider value={{ user, ready, login, logout, refresh, acceptSession }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export function useTheme() {
  const [theme, setThemeState] = useState('light');
  useEffect(() => {
    setThemeState(document.documentElement.dataset.theme || 'light');
  }, []);
  const setTheme = (t) => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem('hcm_theme', t);
    } catch {
      // ignore
    }
    setThemeState(t);
  };
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}
