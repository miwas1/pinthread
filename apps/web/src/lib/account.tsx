import { useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import type { Account } from '@pinthread/shared';
import { Spinner } from '../components/ui';
import { api, setSession } from './api';

export function useAccount() {
  return useQuery({ queryKey: ['account'], queryFn: api.account, staleTime: 60_000, retry: 1 });
}

export function useSetAccount() {
  const qc = useQueryClient();
  return (a: Account | null) => qc.setQueryData(['account'], a);
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api.logout().catch(() => {});
    setSession(null);
    qc.clear();
    window.location.href = '/';
  };
}

/** Where to go after logging in: only same-site paths. */
export function safeNext(next: string | null | undefined, fallback = '/app') {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

export function RequireAccount({ children }: { children: (a: Account) => ReactNode }) {
  const { data, isLoading, error } = useAccount();
  const [loc, navigate] = useLocation();
  useEffect(() => {
    if (!isLoading && !error && !data) navigate(`/login?next=${encodeURIComponent(loc + window.location.search)}`, { replace: true });
  }, [isLoading, error, data, loc, navigate]);
  if (error) return <div className="center-page"><div className="card pad"><h1 className="h-title">PinThread is unreachable</h1><p className="muted">{(error as Error).message}</p><button className="btn btn-ink lg" onClick={() => window.location.reload()}>Try again</button></div></div>;
  if (isLoading || !data) return <div className="center-page"><Spinner /></div>;
  return <>{children(data)}</>;
}
