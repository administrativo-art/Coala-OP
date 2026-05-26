'use client';

import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { rhDb } from '@/lib/firebase-rh';
import type { Employee, EmployeeStatus, KioskId, JobRoleId } from '@/types/rh';

export type EmployeeListFilters = {
  status?:      EmployeeStatus;
  unit_id?:     KioskId;
  job_role_id?: JobRoleId;
  search?:      string;
};

type Page = { employees: Employee[]; lastSnap: DocumentSnapshot | null; hasMore: boolean };

const PAGE_SIZE = 25;

export type EmployeeListState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; employees: Employee[]; hasMore: boolean; loadMore: () => void };

export function useEmployeeList(
  filters: EmployeeListFilters,
  managerUnitId?: string
): EmployeeListState {
  const [state, setState]   = useState<EmployeeListState>({ status: 'idle' });
  const [pages, setPages]   = useState<Page[]>([]);
  const [cursor, setCursor] = useState<DocumentSnapshot | null>(null);
  const [loadTrigger, setLoadTrigger] = useState(0);

  const filterKey = JSON.stringify({ filters, managerUnitId });

  // Reset when filters change
  useEffect(() => {
    setPages([]);
    setCursor(null);
    setLoadTrigger((n) => n + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    async function load() {
      try {
        const constraints: Parameters<typeof query>[1][] = [];

        if (filters.status) constraints.push(where('status', '==', filters.status));
        if (filters.unit_id) constraints.push(where('unit_id', '==', filters.unit_id));
        else if (managerUnitId) constraints.push(where('unit_id', '==', managerUnitId));
        if (filters.job_role_id) constraints.push(where('job_role_id', '==', filters.job_role_id));

        constraints.push(orderBy('name'));
        constraints.push(limit(PAGE_SIZE));
        if (cursor) constraints.push(startAfter(cursor));

        const q = query(collection(rhDb, 'employees'), ...constraints);
        const snap = await getDocs(q);

        const employees = snap.docs.map((d) => d.data() as Employee);
        const lastSnap  = snap.docs[snap.docs.length - 1] ?? null;
        const hasMore   = snap.docs.length === PAGE_SIZE;

        if (!cancelled) {
          setPages((prev) => {
            const combined = cursor ? [...prev, { employees, lastSnap, hasMore }] : [{ employees, lastSnap, hasMore }];
            const all      = combined.flatMap((p) => p.employees);

            let filtered = all;
            if (filters.search) {
              const s = filters.search.toLowerCase();
              filtered = all.filter((e) => e.name.toLowerCase().includes(s));
            }

            setState({
              status: 'ok',
              employees: filtered,
              hasMore,
              loadMore: () => {
                setCursor(lastSnap);
                setLoadTrigger((n) => n + 1);
              },
            });

            return combined;
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Erro ao carregar colaboradores.' });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTrigger]);

  return state;
}
