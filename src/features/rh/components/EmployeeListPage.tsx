'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { Employee, EmployeeStatus, KioskId, JobRoleId, RhRole } from '@/types/rh';
import { useEmployeeList, type EmployeeListFilters } from '../hooks/useEmployeeList';
import { getStatusBadge, getProfileCompletionBadge } from '../lib/field-format';
import { useRhCache } from '../hooks/useEmployeeProfile';

const STATUS_OPTIONS: { value: '' | EmployeeStatus; label: string }[] = [
  { value: '',           label: 'Todos os status' },
  { value: 'active',    label: 'Ativo' },
  { value: 'inactive',  label: 'Inativo' },
  { value: 'terminated', label: 'Desligado' },
];

function EmployeeRow({ employee }: { employee: Employee }) {
  const { label: statusLabel, color: statusColor } = getStatusBadge(employee.status);
  const { label: completionLabel, color: completionColor } = getProfileCompletionBadge(employee.profile_completion);
  const initials = employee.name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  return (
    <Link
      href={`/dashboard/rh/employees/${employee.bizneo_employee_id}`}
      className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors rounded-xl group"
    >
      <div className="shrink-0">
        {employee.photo_url ? (
          <div className="w-10 h-10 rounded-full overflow-hidden">
            <Image src={employee.photo_url} alt={employee.name} width={40} height={40} className="object-cover w-full h-full" />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center">
            <span className="text-white text-sm font-semibold">{initials}</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate group-hover:text-violet-700 transition-colors">
          {employee.name}
        </p>
        <p className="text-xs text-gray-500 truncate">{employee.email}</p>
      </div>

      <div className="hidden sm:flex items-center gap-2 shrink-0">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      <div className="hidden md:flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className={`h-full rounded-full ${completionColor.includes('green') ? 'bg-green-400' : completionColor.includes('orange') ? 'bg-orange-400' : completionColor.includes('yellow') ? 'bg-yellow-400' : 'bg-red-400'}`}
              style={{ width: `${employee.profile_completion}%` }}
            />
          </div>
          <span className="text-xs text-gray-400 w-8">{employee.profile_completion}%</span>
        </div>
      </div>

      <svg className="w-4 h-4 text-gray-300 group-hover:text-violet-400 transition-colors shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
      </svg>
    </Link>
  );
}

export function EmployeeListPage() {
  const { cache, loading: cacheLoading } = useRhCache();
  const [filters, setFilters]            = useState<EmployeeListFilters>({});
  const [searchInput, setSearchInput]    = useState('');

  const role: RhRole = cache?.rh_role ?? 'employee';
  const managerUnitId = role === 'manager' ? cache?.unit_id : undefined;

  const handleSearch = useCallback((v: string) => {
    setSearchInput(v);
    setFilters((f) => ({ ...f, search: v || undefined }));
  }, []);

  const listState = useEmployeeList(filters, managerUnitId);

  if (cacheLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-gray-100" />
        ))}
      </div>
    );
  }

  if (!cache || cache.rh_role === 'employee') {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-gray-400">Sem permissão para listar colaboradores.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nome…"
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
          />
        </div>

        <select
          value={filters.status ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, status: (e.target.value as EmployeeStatus) || undefined }))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm divide-y divide-gray-50">
        {listState.status === 'loading' && (
          <div className="space-y-px p-2 animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-gray-100" />
            ))}
          </div>
        )}

        {listState.status === 'error' && (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-red-500">{listState.message}</p>
          </div>
        )}

        {listState.status === 'ok' && listState.employees.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <svg className="w-10 h-10 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm">Nenhum colaborador encontrado.</p>
          </div>
        )}

        {listState.status === 'ok' && listState.employees.map((emp) => (
          <EmployeeRow key={emp.bizneo_employee_id} employee={emp} />
        ))}
      </div>

      {listState.status === 'ok' && listState.hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={listState.loadMore}
            className="text-sm text-violet-600 hover:text-violet-700 font-medium px-4 py-2 rounded-lg hover:bg-violet-50 transition-colors"
          >
            Carregar mais
          </button>
        </div>
      )}
    </div>
  );
}
