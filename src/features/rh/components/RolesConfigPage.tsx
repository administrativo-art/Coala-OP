'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { rhDb } from '@/lib/firebase-rh';
import type { RhAccessCache, RhRole } from '@/types/rh';

const ROLE_LABELS: Record<RhRole, string> = {
  admin:    'Administrador',
  manager:  'Gestor',
  employee: 'Colaborador',
};

const ROLE_COLORS: Record<RhRole, string> = {
  admin:    'bg-violet-50 text-violet-700',
  manager:  'bg-blue-50 text-blue-700',
  employee: 'bg-gray-50 text-gray-600',
};

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; caches: RhAccessCache[] };

export function RolesConfigPage() {
  const [state, setState]     = useState<State>({ status: 'loading' });
  const [roleFilter, setRoleFilter] = useState<'' | RhRole>('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const snap = await getDocs(
          query(collection(rhDb, 'rh_access_cache'), orderBy('rh_role'))
        );
        const caches = snap.docs.map((d) => d.data() as RhAccessCache);
        if (!cancelled) setState({ status: 'ok', caches });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : 'Erro.' });
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="space-y-2 animate-pulse">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-xl" />)}
      </div>
    );
  }

  if (state.status === 'error') {
    return <p className="text-sm text-red-500">{state.message}</p>;
  }

  const filtered = state.caches.filter((c) => !roleFilter || c.rh_role === roleFilter);

  const counts = state.caches.reduce<Record<string, number>>((acc, c) => {
    acc[c.rh_role] = (acc[c.rh_role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {(['admin', 'manager', 'employee'] as RhRole[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRoleFilter((prev) => prev === r ? '' : r)}
            className={`rounded-xl border p-4 text-left transition-all ${
              roleFilter === r
                ? 'border-violet-300 bg-violet-50 shadow-sm'
                : 'border-gray-100 bg-white hover:border-gray-200'
            }`}
          >
            <p className="text-2xl font-bold text-gray-900">{counts[r] ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">{ROLE_LABELS[r]}</p>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-3 text-left">Auth UID</th>
              <th className="px-4 py-3 text-left">Bizneo ID</th>
              <th className="px-4 py-3 text-left">Função RH</th>
              <th className="px-4 py-3 text-left hidden sm:table-cell">Unidade</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((c) => (
              <tr key={c.auth_uid} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-gray-500 truncate max-w-[140px]">
                  {c.auth_uid}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  {c.bizneo_employee_id ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[c.rh_role]}`}>
                    {ROLE_LABELS[c.rh_role]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 hidden sm:table-cell">
                  {c.unit_id ?? '—'}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">
                  Nenhum registro encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
