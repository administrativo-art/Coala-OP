"use client";

import { useCallback, useEffect, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { LiftRow } from "@/components/patterns/lift-row";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

import { AdjustmentReport } from "./adjustment-panel";
import { ADJUSTMENT_KIND_LABELS, type AdjustmentView } from "./types";

/** Fila de ajustes de ponto para quem analisa: aprovar ou recusar sempre com justificativa. */
export function AdjustmentReviewSection({ firebaseUser, people }: { firebaseUser: FirebaseUser | null; people: Array<{ id: string; username?: string }> }) {
  const [items, setItems] = useState<AdjustmentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdjustmentView | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const names = new Map(people.map((person) => [person.id, person.username ?? "Responsável"]));
  const request = useCallback(<T,>(input: string, init: { method?: string; json?: unknown; fallbackError: string }) =>
    authenticatedApiRequest<T>(input, { ...init, getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null) }), [firebaseUser]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems((await request<{ adjustments: AdjustmentView[] }>("/api/dp/time-recording/adjustments/review",
        { fallbackError: "Não foi possível carregar os ajustes." })).adjustments);
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível carregar os ajustes."));
    }
  }, [request]);
  useEffect(() => { void load(); }, [load]);

  async function decide(action: "approve" | "reject") {
    if (!selected) return;
    setBusy(true);
    setDecisionError(null);
    try {
      await request(`/api/dp/time-recording/adjustments/${selected.id}`, { method: "PATCH",
        json: { action, expectedVersion: selected.version, reason: reason.trim() }, fallbackError: "Não foi possível registrar a decisão." });
      setSelected(null);
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
      {items?.length === 0 ? <p className="text-sm text-ds-ink-muted">Nenhum ajuste de ponto aguardando análise.</p> : null}
      {items?.map((item) => (
        <LiftRow key={item.id} table onClick={() => { setSelected(item); setReason(""); setDecisionError(null); }} className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-sm font-extrabold text-ds-ink">{item.employeeName ?? "Titular"}</span>
            <span className="block text-sm text-ds-ink">{ADJUSTMENT_KIND_LABELS[item.kind].title} · {item.workDate.split("-").reverse().join("/")}</span>
          </span>
          <StatusPill variant="info">Em análise</StatusPill>
        </LiftRow>
      ))}
      {selected ? (
        <SidePanel open onOpenChange={(next) => { if (!next && !busy) setSelected(null); }} kicker="Ajuste de ponto"
          title={selected.employeeName ?? "Titular"} subtitle={`${ADJUSTMENT_KIND_LABELS[selected.kind].title} · ${selected.workDate.split("-").reverse().join("/")}`}>
          <AdjustmentReport adjustment={selected} names={names}
            originals={selected.target ? [{ receiptId: selected.target.receiptId, markedAt: selected.target.markedAt, nsr: selected.target.nsr }] : []} />
          <PanelSection title="Decisão" aside="justificativa obrigatória">
            <textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)}
              className="w-full rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2 text-sm text-ds-ink"
              placeholder="Ex.: conferido com a gerente da unidade e com a câmera do quiosque." />
            <p className="text-xs text-ds-ink-muted">Mínimo de 10 caracteres. Fica na trilha com seu nome, data e hora.</p>
            {decisionError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{decisionError}</p> : null}
            <div className="flex gap-2">
              <Button type="button" variant="ds-secondary" disabled={busy || reason.trim().length < 10} onClick={() => void decide("reject")}>Recusar</Button>
              <Button type="button" variant="primary-modal" className="flex-1" loading={busy} loadingLabel="Registrando…"
                disabled={reason.trim().length < 10} onClick={() => void decide("approve")}>Aprovar ajuste</Button>
            </div>
          </PanelSection>
        </SidePanel>
      ) : null}
    </div>
  );
}
