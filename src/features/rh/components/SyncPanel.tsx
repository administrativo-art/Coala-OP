'use client';

import type { SyncLog } from '@/types/rh';
import type { Timestamp } from 'firebase/firestore';
import { useSyncLog } from '../hooks/useSyncLog';

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

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-sm font-semibold text-amber-950">Importação de colaboradores desativada</h2>
        <p className="mt-1 text-xs text-amber-800">
          Os colaboradores devem ser cadastrados e admitidos pelo Coala One. O histórico abaixo é mantido apenas para auditoria.
        </p>
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
