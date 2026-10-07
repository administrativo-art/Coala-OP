"use client";

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useAuthenticatedApi } from '@/hooks/use-authenticated-api';

const requests = new Map<string, { pending: Promise<{ enabled: boolean }>; at: number }>();
const CACHE_MS = 30_000;

/** One authenticated policy read per signed-in context; no business collection listener. */
export function useReplenishmentPolicy() {
  const { firebaseUser } = useAuth();
  const request = useAuthenticatedApi();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!firebaseUser) { setEnabled(null); setError(false); return; }
    const key = firebaseUser.uid;
    let active = true;
    let entry = requests.get(key);
    if (!entry || Date.now() - entry.at > CACHE_MS) {
      const pending = request<{ enabled: boolean }>('/api/stock/replenishment-policy', {
        fallbackError: 'Não foi possível consultar a política de reposição.',
      }).catch(error => { requests.delete(key); throw error; });
      entry = { pending, at: Date.now() };
      requests.set(key, entry);
    }
    entry.pending.then(value => { if (active) { setEnabled(value.enabled === true); setError(false); } })
      .catch(() => { if (active) { setEnabled(null); setError(true); } });
    return () => { active = false; };
  }, [firebaseUser, request]);

  return { enabled, loading: enabled === null && !error, error };
}
