'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { rhDb } from '@/lib/firebase-rh';
import type { AuditLogEntry, BizneoEmployeeId } from '@/types/rh';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; entries: AuditLogEntry[] };

export function useAuditLog(bizneoEmployeeId: BizneoEmployeeId): State {
  const [state, setState] = useState<State>({ status: 'idle' });

  useEffect(() => {
    if (!bizneoEmployeeId) return;
    let cancelled = false;

    async function load() {
      setState({ status: 'loading' });
      try {
        const q = query(
          collection(rhDb, 'audit_log'),
          where('employee_id', '==', bizneoEmployeeId),
          orderBy('changed_at', 'desc'),
          limit(50)
        );
        const snap = await getDocs(q);
        const entries = snap.docs.map((d) => d.data() as AuditLogEntry);
        if (!cancelled) setState({ status: 'ok', entries });
      } catch (err) {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Erro ao carregar histórico.' });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [bizneoEmployeeId]);

  return state;
}
