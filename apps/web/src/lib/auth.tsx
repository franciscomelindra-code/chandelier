import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, setCsrfToken } from './api';
import type { Me } from './types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** Affichage uniquement : l'API reste seule juge des autorisations. */
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const s = await get<({ authenticated: true } & Me) | { authenticated: false }>('/api/v1/auth/session');
      return s.authenticated ? s : null;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    setCsrfToken(data?.csrfToken ?? null);
  }, [data]);

  const value: AuthState = {
    me: data ?? null,
    loading: isPending,
    can: (p) => !!data?.permissions.includes(p),
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
    logout: async () => {
      try {
        await post('/api/v1/auth/logout');
      } finally {
        setCsrfToken(null);
        qc.clear();
        qc.setQueryData(['me'], null);
      }
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth hors AuthProvider');
  return ctx;
}
