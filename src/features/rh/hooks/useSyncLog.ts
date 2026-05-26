'use client';

import { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { rhDb } from '@/lib/firebase-rh';
import type { SyncLog } from '@/types/rh';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; logs: SyncLog[] };

export function useSyncLog(): State {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const q = query(
          collection(rhDb, 'sync_log'),
          orderBy('started_at', 'desc'),
          limit(10)
        );
        const snap = await getDocs(q);
        const logs = snap.docs.map((d) => d.data() as SyncLog);
        if (!cancelled) setState({ status: 'ok', logs });
      } catch (err) {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Erro ao carregar logs.' });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return state;
}
