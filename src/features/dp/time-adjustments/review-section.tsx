"use client";

import { useCallback, useEffect, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { LiftRow } from "@/components/patterns/lift-row";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { purposeLabel } from "@/features/dp/rep-p/record-strip";

import { AdjustmentReport } from "./adjustment-panel";
import type { AdjustmentDayContext } from "./day-summary";
import { ADJUSTMENT_KIND_LABELS, type AdjustmentView, type MarkingClassificationRequestView } from "./types";

/** "Segunda, 26/10/2026": o dia da semana ajuda a conferir contra a escala. */
function weekdayDate(workDate: string) {
  const weekday = new Date(`${workDate}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long" });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${workDate.split("-").reverse().join("/")}`;
}

/** Fila de ajustes de ponto para quem analisa: aprovar ou recusar sempre com justificativa. */
export function AdjustmentReviewSection({ firebaseUser, people, onCountChange }: {
  firebaseUser: FirebaseUser | null;
  people: Array<{ id: string; username?: string }>;
  onCountChange?: (count: number | null) => void;
}) {
  const [items, setItems] = useState<AdjustmentView[] | null>(null);
  const [classificationItems, setClassificationItems] = useState<MarkingClassificationRequestView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdjustmentView | null>(null);
  const [selectedClassification, setSelectedClassification] = useState<MarkingClassificationRequestView | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [day, setDay] = useState<AdjustmentDayContext | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const names = new Map(people.map((person) => [person.id, person.username ?? "Responsável"]));
  const request = useCallback(<T,>(input: string, init: { method?: string; json?: unknown; fallbackError: string }) =>
    authenticatedApiRequest<T>(input, { ...init, getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null) }), [firebaseUser]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const payload = await request<{ adjustments: AdjustmentView[]; classificationRequests?: MarkingClassificationRequestView[] }>("/api/dp/time-recording/adjustments/review",
        { fallbackError: "Não foi possível carregar os ajustes." });
      setItems(payload.adjustments);
      setClassificationItems(payload.classificationRequests ?? []);
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível carregar os ajustes."));
    }
  }, [request]);
  useEffect(() => { void load(); }, [load]);
  const selectedId = selected?.id ?? null;
  // O dia inteiro do pedido aberto: uma leitura por abertura, sem polling. Se falhar, o painel mostra só a batida do pedido.
  useEffect(() => {
    setDay(null);
    setDayError(null);
    if (!selectedId) return;
    let cancelled = false;
    request<{ day: AdjustmentDayContext }>(`/api/dp/time-recording/adjustments/${selectedId}/day`, { fallbackError: "Não foi possível carregar o dia inteiro." })
      .then((payload) => { if (!cancelled) setDay(payload.day); })
      .catch((cause) => { if (!cancelled) setDayError(errorMessageOf(cause, "Não foi possível carregar o dia inteiro.")); });
    return () => { cancelled = true; };
  }, [request, selectedId]);
  useEffect(() => { onCountChange?.(items ? items.length + classificationItems.length : null); }, [classificationItems.length, items, onCountChange]);

  async function decide(action: "approve" | "reject") {
    const current = selected ?? selectedClassification;
    if (!current) return;
    setBusy(true);
    setDecisionError(null);
    try {
      await request(`/api/dp/time-recording/adjustments/${current.id}`, { method: "PATCH",
        json: { action, expectedVersion: current.version, reason: reason.trim() }, fallbackError: "Não foi possível registrar a decisão." });
      setSelected(null);
      setSelectedClassification(null);
      setReason("");
      void load();
    } catch (cause) {
      setDecisionError(errorMessageOf(cause, "Não foi possível registrar a decisão."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : null}
      {items === null && !error ? <p className="text-sm text-ds-ink-muted">Carregando ajustes…</p> : null}
      {items?.length === 0 && classificationItems.length === 0 ? <p className="text-sm text-ds-ink-muted">Nenhum ajuste de ponto aguardando análise.</p> : null}
      {items?.map((item) => (
        <LiftRow key={item.id} table onClick={() => { setSelected(item); setSelectedClassification(null); setReason(""); setDecisionError(null); }} className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-sm font-extrabold text-ds-ink">{item.employeeName ?? "Titular"}</span>
            <span className="block text-sm text-ds-ink">{item.scope === "pilot" ? "Simulação · " : ""}{ADJUSTMENT_KIND_LABELS[item.kind].title} · {item.workDate.split("-").reverse().join("/")}</span>
          </span>
          <StatusPill variant="info">Em análise</StatusPill>
        </LiftRow>
      ))}
      {classificationItems.map((item) => (
        <LiftRow key={item.id} table onClick={() => { setSelectedClassification(item); setSelected(null); setReason(""); setDecisionError(null); }} className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-sm font-extrabold text-ds-ink">{item.employeeName ?? "Titular"}</span>
            <span className="block text-sm text-ds-ink">Classificação da batida · {item.workDate.split("-").reverse().join("/")}</span>
          </span>
          <StatusPill variant="info">Em análise</StatusPill>
        </LiftRow>
      ))}
      {selected ? (
        <SidePanel open onOpenChange={(next) => { if (!next && !busy) setSelected(null); }} kicker={selected.scope === "pilot" ? "Simulação de ajuste" : "Ajuste de ponto"}
          title={selected.employeeName ?? "Titular"} subtitle={`${weekdayDate(selected.workDate)} · ${ADJUSTMENT_KIND_LABELS[selected.kind].title}`}
          className="w-[min(680px,100vw)]">
          {dayError ? <p role="status" className="text-xs font-semibold text-ds-warn">{dayError} Mostrando só a batida do pedido.</p> : null}
          <AdjustmentReport adjustment={selected} names={names} day={day} dayLoading={!day && !dayError}
            originals={(selected.operations?.length ? selected.operations.map((operation) => operation.target).filter(Boolean) : selected.target ? [selected.target] : [])
              .map((target) => ({ receiptId: target!.receiptId, markedAt: target!.markedAt, nsr: target!.nsr ?? target!.pilotSequence ?? 0 }))} />
          <PanelSection title="Decisão" aside={selected.scope === "pilot" ? "sem efeito fiscal" : "justificativa obrigatória"}>
            <textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)}
              className="w-full rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2 text-sm text-ds-ink"
              placeholder="Ex.: conferido com a gerente da unidade e com a câmera do quiosque." />
            <p className="text-xs text-ds-ink-muted">Mínimo de 10 caracteres. Fica na trilha com seu nome, data e hora.</p>
            {decisionError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{decisionError}</p> : null}
            <div className="flex gap-2">
              <Button type="button" variant="ds-secondary" disabled={busy || reason.trim().length < 10} onClick={() => void decide("reject")}>Recusar</Button>
              <Button type="button" variant="primary-modal" className="flex-1" loading={busy} loadingLabel="Registrando…"
                disabled={reason.trim().length < 10} onClick={() => void decide("approve")}>{selected.scope === "pilot" ? "Aprovar simulação" : "Aprovar ajuste"}</Button>
            </div>
          </PanelSection>
        </SidePanel>
      ) : null}
      {selectedClassification ? (
        <SidePanel open onOpenChange={(next) => { if (!next && !busy) setSelectedClassification(null); }} kicker="Classificação de batida"
          title={selectedClassification.employeeName ?? "Titular"} subtitle={`${selectedClassification.workDate.split("-").reverse().join("/")} · NSR ${selectedClassification.nsr}`}>
          <PanelSection title="Alteração solicitada" aside={`fechamento v${selectedClassification.closureVersion}`}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ds-ink-muted">Horário</dt><dd className="font-ds-mono font-bold text-ds-ink">{selectedClassification.markedAt.slice(11, 16)}</dd>
              <dt className="text-ds-ink-muted">Atual</dt><dd className="font-bold text-ds-ink">{purposeLabel(selectedClassification.currentClassification?.purpose)}</dd>
              <dt className="text-ds-ink-muted">Solicitada</dt><dd className="font-bold text-ds-accent-ink">{purposeLabel(selectedClassification.requestedPurpose)}</dd>
            </dl>
            <p className="text-xs text-ds-ink-muted">A decisão altera somente a classificação organizacional. Horário, NSR, comprovante e fechamento permanecem intactos.</p>
          </PanelSection>
          <PanelSection title="Decisão" aside="justificativa obrigatória">
            <textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)}
              className="w-full rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2 text-sm text-ds-ink"
              placeholder="Explique a conferência realizada." />
            <p className="text-xs text-ds-ink-muted">Mínimo de 10 caracteres. A decisão fica registrada na solicitação.</p>
            {decisionError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{decisionError}</p> : null}
            <div className="flex gap-2">
              <Button type="button" variant="ds-secondary" disabled={busy || reason.trim().length < 10} onClick={() => void decide("reject")}>Recusar</Button>
              <Button type="button" variant="primary-modal" className="flex-1" loading={busy} loadingLabel="Registrando…"
                disabled={reason.trim().length < 10} onClick={() => void decide("approve")}>Aprovar classificação</Button>
            </div>
          </PanelSection>
        </SidePanel>
      ) : null}
    </div>
  );
}
