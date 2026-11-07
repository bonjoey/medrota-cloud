'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, getAccessToken, clearSession, type CurrentUser, type LoginResponse } from './api-client';

interface AuthContextValue {
  user: CurrentUser | null;
  /** ยังโหลด currentUser จาก localStorage อยู่ (กันหน้าจอกระพริบไปหน้า login ก่อนรู้ผล) */
  loading: boolean;
  login: (employeeCodeOrEmail: string, password: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = getAccessToken();
    const raw = typeof window !== 'undefined' ? localStorage.getItem('currentUser') : null;
    if (token && raw) {
      try {
        setUser(JSON.parse(raw));
      } catch {
        clearSession();
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (employeeCodeOrEmail: string, password: string) => {
    const res = await authApi.login(employeeCodeOrEmail, password);
    localStorage.setItem('accessToken', res.accessToken);
    localStorage.setItem('refreshToken', res.refreshToken);
    localStorage.setItem('currentUser', JSON.stringify(res.user));
    setUser(res.user);
    return res;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    router.push('/login');
  }, [router]);

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth ต้องใช้ภายใน <AuthProvider>');
  return ctx;
}
