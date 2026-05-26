'use client';

import { useState, useCallback } from 'react';
import type { SyncLog } from '@/types/rh';
import type { Timestamp } from 'firebase/firestore';
import { useSyncLog } from '../hooks/useSyncLog';
import { callManualSync } from '../lib/rh-client';

function formatDate(ts: Timestamp | unknown): string {
  try {
    const d = (ts as Timestamp).toDate?.() ?? new Date(ts as string);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch {
    return '—';
  }
}

function StatusBadge({ status }: { status: SyncLog['status'] }) {
  const map = {
    success: 'bg-green-50 text-green-700',
    failed:  'bg-red-50 text-red-700',
    partial: 'bg-orange-50 text-orange-700',
  };
  const labels = { success: 'Sucesso', failed: 'Falha', partial: 'Parcial' };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status]}`}>
      {labels[status]}
    </span>
  );
}

export function SyncPanel() {
  const logState     = useSyncLog();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError]   = useState<string | null>(null);

  const handleManualSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const result = await callManualSync();
      setSyncResult(
        `Sync concluído: ${result.updated_count} atualizados de ${result.employee_count} colaboradores.` +
        (result.error_count > 0 ? ` ${result.error_count} erros.` : '')
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Erro ao disparar sync.');
    } finally {
      setSyncing(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Manual sync card */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Sync manual com Bizneo</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              O sync automático roda diariamente às 03:00. Use isso para forçar uma atualização imediata.
            </p>
          </div>
          <button
            type="button"
            onClick={handleManualSync}
            disabled={syncing}
            className="shrink-0 flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors font-medium"
          >
            {syncing ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Sincronizando…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
                Sincronizar agora
              </>
            )}
          </button>
        </div>

        {syncResult && (
          <div className="mt-3 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">{syncResult}</div>
        )}
        {syncError && (
          <div className="mt-3 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">{syncError}</div>
        )}
      </div>

      {/* Log history */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-800">Histórico de sincronizações</h2>
        </div>

        {logState.status === 'loading' && (
          <div className="space-y-px p-3 animate-pulse">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-lg" />)}
          </div>
        )}

        {logState.status === 'error' && (
          <div className="flex items-center justify-center py-10">
            <p className="text-sm text-red-500">{logState.message}</p>
          </div>
        )}

        {logState.status === 'ok' && logState.logs.length === 0 && (
          <div className="flex items-center justify-center py-10">
            <p className="text-sm text-gray-400">Nenhum sync registrado ainda.</p>
          </div>
        )}

        {logState.status === 'ok' && logState.logs.map((log, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3 border-b border-gray-50 last:border-0">
            <StatusBadge status={log.status} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">{formatDate(log.started_at)}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-600">
                {(log as SyncLog & { updated_count?: number }).updated_count ?? 0} atualizados
              </p>
              {(log as SyncLog & { error_count?: number }).error_count ? (
                <p className="text-xs text-red-500">
                  {(log as SyncLog & { error_count?: number }).error_count} erros
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
