import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AUTH_EXPIRED_EVENT,
  Session,
  clearSession,
  getSession,
  login as apiLogin,
} from '../lib/auth';

interface AuthState {
  session: Session | null;
  signIn: (username: string, password: string) => Promise<Session>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => getSession());

  useEffect(() => {
    const onExpired = () => {
      setSession(null);
      toast.warning('انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى');
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const next = await apiLogin(username, password);
    setSession(next);
    return next;
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
    toast.success('تم تسجيل الخروج');
  }, []);

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

