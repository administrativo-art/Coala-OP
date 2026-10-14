'use client';

import { useState } from 'react';

import type { ProfileFieldChangeRequest } from '@/types/rh';
import { callReviewFieldChange } from '../lib/rh-client';

function formatRequestValue(value: unknown) {
  if (value == null || value === '') return 'Não informado';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ProfileChangeRequestsCard({
  requests,
  canReview,
  onReviewed,
}: {
  requests: ProfileFieldChangeRequest[];
  canReview: boolean;
  onReviewed?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (requests.length === 0) return null;

  async function review(requestId: string, decision: 'approved' | 'rejected') {
    setBusyId(requestId);
    setError(null);
    try {
      await callReviewFieldChange({ request_id: requestId, decision });
      onReviewed?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível revisar a solicitação.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-xs">
      <div className="border-b border-amber-100 bg-amber-50 px-3 py-2.5">
        <p className="text-sm font-semibold text-amber-950">Alterações aguardando aprovação</p>
        <p className="mt-0.5 text-[11px] text-amber-800">
          {canReview ? 'Compare o valor atual com a proposta antes de decidir.' : 'O valor atual permanece válido até a análise do RH.'}
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {requests.map((request) => (
          <div key={request.id} className="space-y-2 px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-gray-900">{request.fieldLabel}</p>
                <p className="mt-0.5 text-[10px] text-gray-400">Solicitado em {new Date(request.requestedAt).toLocaleString('pt-BR')}</p>
              </div>
              <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">Pendente</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-[9px] font-bold uppercase tracking-wide text-gray-400">Atual</p>
                <p className="mt-1 break-words text-xs font-medium text-gray-700">{formatRequestValue(request.oldValue)}</p>
              </div>
              <div className="rounded-lg bg-violet-50 px-3 py-2">
                <p className="text-[9px] font-bold uppercase tracking-wide text-violet-400">Proposto</p>
                <p className="mt-1 break-words text-xs font-semibold text-violet-800">{formatRequestValue(request.proposedValue)}</p>
              </div>
            </div>
            {canReview ? (
              <div className="flex justify-end gap-2">
                <button type="button" disabled={busyId === request.id} onClick={() => void review(request.id, 'rejected')} className="h-8 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 disabled:opacity-50">Rejeitar</button>
                <button type="button" disabled={busyId === request.id} onClick={() => void review(request.id, 'approved')} className="h-8 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white disabled:opacity-50">{busyId === request.id ? 'Processando…' : 'Aprovar'}</button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {error ? <p className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p> : null}
    </section>
  );
}
