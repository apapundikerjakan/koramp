'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';

// NOTE: Client context must NOT import server-only auth implementation
// (Prisma, jose, crypto). Browser talks to /api/admin/* only.
// Local payload type mirrors AdminSessionPayload without pulling server code.
interface AdminSessionPayload {
  adminId: string;
  keyVersion: number;
  jti?: string;
  uaHash?: string;
}

interface AuthState {
  admin: AdminSessionPayload | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (adminKey: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}

export function useApi() {
  const call = useCallback(async (path: string, options?: RequestInit) => {
    // Cookie sudah di-set oleh server (HttpOnly), fetch akan otomatis mengirimkan
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
    return res.json();
  }, []);
  return call;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ admin: null, isAuthenticated: false, isLoading: true });

  // Cek session saat component mount
  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/session');
      const data = await res.json();
      if (data.authenticated && data.admin) {
        setState({ admin: { adminId: data.admin.adminId, keyVersion: data.admin.keyVersion }, isAuthenticated: true, isLoading: false });
      } else {
        setState({ admin: null, isAuthenticated: false, isLoading: false });
      }
    } catch {
      setState({ admin: null, isAuthenticated: false, isLoading: false });
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = useCallback(async (adminKey: string) => {
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey }),
      });
      const data = await res.json();
      if (data.authenticated && data.admin) {
        setState({ admin: { adminId: data.admin.adminId, keyVersion: data.admin.keyVersion }, isAuthenticated: true, isLoading: false });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } finally {
      setState({ admin: null, isAuthenticated: false, isLoading: false });
    }
  }, []);

  const value = useMemo(() => ({ ...state, login, logout, checkSession }), [state, login, logout, checkSession]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
