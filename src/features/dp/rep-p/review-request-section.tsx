"use client";

import { useState } from "react";
import { ClipboardCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { canMarkReviewed, DP_REVIEW_REASONS, type DPReviewReason, type TimeReviewView } from "@/features/dp/time-review/core";

import type { DayView } from "./day-model";

const when = (iso: string) => {
  // Horário de Brasília (UTC−3), no formato DD/MM/AAAA, HH:mm.
  const at = new Date(Date.parse(iso) - 3 * 3_600_000).toISOString();
  return `${at.slice(8, 10)}/${at.slice(5, 7)}/${at.slice(0, 4)}, ${at.slice(11, 16)}`;
};

/**
 * Revisão antecipada no painel do dia. Colaboradora: vê o pedido e confirma "Revisei este dia" (nunca em dia ímpar
 * ou sem batidas). DP na conferência: pede revisão com um motivo da lista. Nenhuma das ações altera batidas.
 */
export function ReviewRequestSection({ day, today, review, readOnly, onMarkReviewed, onRequestReview }: {
  day: DayView; today: string; review: TimeReviewView | null; readOnly: boolean;
  onMarkReviewed?: (id: string) => Promise<void>;
  onRequestReview?: (date: string, reason: DPReviewReason) => Promise<void>;
}) {
  const [reason, setReason] = useState<DPReviewReason | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir agora."); }
    finally { setBusy(false); }
  };

  if (readOnly) {
    if (day.date >= today || !onRequestReview) return null;
    if (review?.status === "open") {
      return (
        <p className="flex items-start gap-2 rounded-ds-md border border-ds-info/20 bg-ds-info-bg px-3 py-2.5 text-xs text-ds-ink-2">
          <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-ds-info" aria-hidden />
          Revisão pedida em {when(review.createdAt)}{review.reasonLabel ? ` · ${review.reasonLabel}` : " pela rotina diária"}.
        </p>
      );
    }
    return (
      <div className="space-y-2 rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2.5">
        <p className="text-sm font-bold text-ds-ink">Pedir revisão à colaboradora</p>
        <p className="text-xs text-ds-ink-muted">Ela recebe um aviso para revisar o dia. O DP não altera as batidas por ela.</p>
        <div className="flex flex-wrap gap-2">
          <Select value={reason} onValueChange={(value) => setReason(value as DPReviewReason)}>
            <SelectTrigger className="min-w-56 flex-1" aria-label="Motivo da revisão"><SelectValue placeholder="Escolha o motivo" /></SelectTrigger>
            <SelectContent>
              {(Object.entries(DP_REVIEW_REASONS) as Array<[DPReviewReason, string]>).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="ds-secondary" size="sm" disabled={!reason} loading={busy} loadingLabel="Pedindo…"
            onClick={() => reason && void run(() => onRequestReview(day.date, reason))}>Pedir revisão</Button>
        </div>
        {error ? <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p> : null}
      </div>
    );
  }

  if (!review) return null;
  if (review.status === "reviewed" && review.reviewedAt) {
    return <p className="rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2.5 text-xs text-ds-ink-muted">Você revisou este dia em {when(review.reviewedAt)}.</p>;
  }
  if (review.status !== "open") return null;
  const allowed = canMarkReviewed(day);
  return (
    <div className="space-y-2 rounded-ds-md border border-ds-info/20 bg-ds-info-bg px-3 py-2.5">
      <p className="flex items-center gap-2 text-sm font-bold text-ds-ink"><ClipboardCheck className="h-4 w-4 text-ds-info" aria-hidden /> Revise este dia</p>
      <p className="text-xs text-ds-ink-2">{review.reasonLabel ? `O DP pediu: ${review.reasonLabel.toLowerCase()}.` : "A rotina diária encontrou um ponto a conferir neste dia."}</p>
      {allowed ? (
        <>
          <p className="text-xs text-ds-ink-muted">Se estiver tudo certo, confirme. Se houver erro, peça a correção das batidas. Confirmar não muda batidas nem o espelho.</p>
          <Button type="button" variant="ds-secondary" size="sm" loading={busy} loadingLabel="Salvando…"
            onClick={() => onMarkReviewed && void run(() => onMarkReviewed(review.id))}>Revisei este dia</Button>
        </>
      ) : (
        <p className="text-xs text-ds-ink-muted">Falta batida neste dia: peça a correção das batidas ou justifique com uma ausência.</p>
      )}
      {error ? <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p> : null}
    </div>
  );
}
