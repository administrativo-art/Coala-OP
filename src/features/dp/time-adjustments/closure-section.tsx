"use client";

import { useCallback, useEffect, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { LiftRow } from "@/components/patterns/lift-row";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

import type { ClosurePerson } from "./closure-core";
import { ADJUSTMENT_KIND_LABELS, ADJUSTMENT_STATUS_LABELS } from "./types";

type ClosureView = {
  status: "open" | "closed"; version: number; closedAt: string | null; closedBy: string | null; manifestHash: string | null;
  changes: { added: string[]; changed: string[]; removed: string[] } | null;
  reopenings: Array<{ at: string; by: string; reason: string; fromVersion: number }>;
};
type ClosurePayload = {
  competence: string; closure: ClosureView | null; people: ClosurePerson[]; pending: { adjustments: number; absences: number };
  counts: { adjustments: number; absences: number }; truncated: boolean; can: { close: boolean; reopen: boolean };
};

const ABSENCE_STATUS: Record<string, string> = { submitted: "Enviada", in_review: "Em análise", adjustments_requested: "Ajustes pedidos", approved: "Aprovada", rejected: "Recusada", cancelled: "Cancelada" };
const dateBR = (value: string) => value.slice(0, 10).split("-").reverse().join("/");
const timeOf = (value: string) => value.slice(11, 16);
const whenBR = (value: string | null) => value ? `${dateBR(value)} ${timeOf(value)}` : "—";
function previousCompetence() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return date.toISOString().slice(0, 7);
}

/** Fechamento do ponto por competência: declaração por pessoa, bloqueio com pedido pendente, versão e reabertura. */
export function CompetenceClosureSection({ firebaseUser, people }: { firebaseUser: FirebaseUser | null; people: Array<{ id: string; username?: string }> }) {
  const [competence, setCompetence] = useState(previousCompetence);
  const [data, setData] = useState<ClosurePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"close" | "reopen" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ClosurePerson | null>(null);
  const names = new Map(people.map((person) => [person.id, person.username ?? "Responsável"]));
  const nameOf = (uid: string | null) => uid ? names.get(uid) ?? "Responsável" : "—";
  const request = useCallback(<T,>(input: string, init: { method?: string; json?: unknown; fallbackError: string }) =>
    authenticatedApiRequest<T>(input, { ...init, getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null) }), [firebaseUser]);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      setData(await request<ClosurePayload>(`/api/dp/time-recording/closures?competence=${competence}`, { fallbackError: "Não foi possível carregar o fechamento." }));
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível carregar o fechamento."));
    }
  }, [competence, request]);
  useEffect(() => { void load(); }, [load]);

  async function act(kind: "close" | "reopen") {
    if (!data) return;
    setBusy(true);
    setActionError(null);
    try {
      if (kind === "close") {
        await request("/api/dp/time-recording/closures", { method: "POST", json: { competence, expectedVersion: data.closure?.version ?? 0 }, fallbackError: "Não foi possível fechar a competência." });
      } else {
        await request(`/api/dp/time-recording/closures/${competence}`, { method: "PATCH", json: { action: "reopen", expectedVersion: data.closure?.version, reason: reason.trim() }, fallbackError: "Não foi possível reabrir a competência." });
        setReason("");
      }
      setConfirming(null);
      void load();
    } catch (cause) {
      setActionError(errorMessageOf(cause, kind === "close" ? "Não foi possível fechar a competência." : "Não foi possível reabrir a competência."));
    } finally {
      setBusy(false);
    }
  }

  const closed = data?.closure?.status === "closed";
  const blocked = Boolean(data && (data.pending.adjustments || data.pending.absences || data.truncated));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5 text-xs font-bold text-ds-ink">Competência
          <input type="month" value={competence} max={new Date().toISOString().slice(0, 7)} onChange={(event) => event.target.value && setCompetence(event.target.value)}
            className="block h-11 rounded-ds-btn border border-ds-border-input bg-ds-surface px-3 text-sm text-ds-ink" />
        </label>
        {data ? <StatusPill variant={closed ? "ok" : "neutral"}>{closed ? `Fechada · versão ${data.closure!.version}` : data.closure?.reopenings.length ? "Reaberta" : "Aberta"}</StatusPill> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-ds-ink-muted">Carregando fechamento…</p> : null}
      {data ? <>
        <p className="text-sm text-ds-ink">{data.people.length} {data.people.length === 1 ? "pessoa" : "pessoas"} com pedidos no mês · {data.counts.adjustments} ajustes de ponto · {data.counts.absences} ausências.</p>
        {closed ? <p className="text-xs text-ds-ink-muted">Fechada em {whenBR(data.closure!.closedAt)} por {nameOf(data.closure!.closedBy)}. Carimbo da declaração: <span className="font-mono">{data.closure!.manifestHash?.slice(0, 16)}…</span></p> : null}
        {closed && data.closure!.changes ? <p className="text-xs text-ds-ink-muted">Em relação à versão anterior: {data.closure!.changes.added.length} itens novos, {data.closure!.changes.changed.length} alterados, {data.closure!.changes.removed.length} retirados.</p> : null}
        {!closed && (data.pending.adjustments || data.pending.absences) ? <p role="status" className="rounded-ds-btn bg-ds-caution-bg px-3 py-2 text-xs font-semibold text-ds-caution">
          Há pedidos sem decisão: {data.pending.adjustments} de ajuste e {data.pending.absences} de ausência. Decida-os nas filas acima antes de fechar.</p> : null}
        {!closed && data.truncated ? <p role="alert" className="text-xs font-semibold text-ds-danger">O mês tem mais pedidos do que o fechamento comporta numa vez. Fale com o desenvolvimento.</p> : null}
        {data.people.map((person) => {
          const pending = person.adjustments.filter((item) => item.status === "in_review").length + person.absences.filter((item) => ["submitted", "in_review", "adjustments_requested"].includes(item.status)).length;
          return (
            <LiftRow key={person.uid} table onClick={() => setSelected(person)} className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-extrabold text-ds-ink">{person.name ?? nameOf(person.uid)}</span>
                <span className="block text-sm text-ds-ink-muted">{person.adjustments.length} ajustes · {person.absences.length} ausências</span>
              </span>
              {pending ? <StatusPill variant="warn">{pending} pendente{pending > 1 ? "s" : ""}</StatusPill> : <StatusPill variant="neutral">Declarado</StatusPill>}
            </LiftRow>
          );
        })}
        {actionError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{actionError}</p> : null}
        {!closed && data.can.close ? (confirming === "close"
          ? <InlineConfirm message={`Fechar ${dateBR(`${competence}-01`).slice(3)}? A declaração fica congelada e o mês deixa de aceitar pedido de ajuste.`} confirmLabel="Fechar competência" loadingLabel="Fechando…"
              loading={busy} onConfirm={() => void act("close")} onCancel={() => setConfirming(null)} />
          : <Button variant="primary-page" disabled={blocked} onClick={() => { setActionError(null); setConfirming("close"); }}>Fechar competência</Button>) : null}
        {closed && data.can.reopen ? <div className="space-y-2">
          <textarea rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Motivo da reabertura"
            className="w-full rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2 text-sm text-ds-ink" placeholder="Motivo da reabertura (mínimo de 10 caracteres)" />
          {confirming === "reopen"
            ? <InlineConfirm message="Reabrir a competência? A versão fechada fica guardada; o próximo fechamento cria outra e declara o que mudou." confirmLabel="Reabrir competência" loadingLabel="Reabrindo…"
                loading={busy} onConfirm={() => void act("reopen")} onCancel={() => setConfirming(null)} />
            : <Button variant="ds-secondary" disabled={reason.trim().length < 10} onClick={() => { setActionError(null); setConfirming("reopen"); }}>Reabrir competência</Button>}
        </div> : null}
        {data.closure?.reopenings.length ? <ul className="space-y-1 text-xs text-ds-ink-muted">{data.closure.reopenings.map((entry) => (
          <li key={entry.at}>Reaberta em {whenBR(entry.at)} por {nameOf(entry.by)} (da versão {entry.fromVersion}): {entry.reason}</li>))}</ul> : null}
      </> : null}
      {selected ? (
        <SidePanel open onOpenChange={(next) => { if (!next) setSelected(null); }} kicker={`Declaração do fechamento · ${dateBR(`${competence}-01`).slice(3)}`} title={selected.name ?? nameOf(selected.uid)}
          subtitle={`${selected.adjustments.length} ajustes · ${selected.absences.length} ausências`}>
          <PanelSection title="Ajustes de ponto">
            {selected.adjustments.length ? selected.adjustments.map((item) => (
              <div key={item.id} className="space-y-0.5 border-b border-ds-border py-2 text-sm last:border-0">
                <p className="font-bold text-ds-ink">{dateBR(item.workDate)} · {ADJUSTMENT_KIND_LABELS[item.kind].title} · {ADJUSTMENT_STATUS_LABELS[item.status]}</p>
                <p className="text-ds-ink">{item.original ? `Original ${timeOf(item.original.markedAt)} (NSR ${item.original.nsr})` : "Sem batida original"}{item.inclusion ? ` → incluída ${timeOf(item.inclusion.markedAt)}` : item.kind === "discard" ? " → desconsiderada" : ""}</p>
                <p className="text-xs text-ds-ink-muted">Pedido por {nameOf(item.requestedBy)} em {whenBR(item.requestedAt)}: {item.reason}</p>
                {item.decidedBy ? <p className="text-xs text-ds-ink-muted">Decidido por {nameOf(item.decidedBy)} em {whenBR(item.decidedAt)}{item.decisionReason ? `: ${item.decisionReason}` : ""}</p> : null}
              </div>)) : <p className="text-sm text-ds-ink-muted">Nenhum ajuste no mês.</p>}
          </PanelSection>
          <PanelSection title="Ausências" aside="sem motivo nem anexo">
            {selected.absences.length ? selected.absences.map((item) => (
              <div key={item.id} className="space-y-0.5 border-b border-ds-border py-2 text-sm last:border-0">
                <p className="font-bold text-ds-ink">{item.typeName} · {ABSENCE_STATUS[item.status] ?? item.status}{item.approval === "tacit_timeout" ? " por decurso de prazo" : ""}</p>
                <p className="text-ds-ink">{item.startDate === item.endDate ? dateBR(item.startDate) : `${dateBR(item.startDate)} a ${dateBR(item.endDate)}`}{item.startTime && item.endTime ? ` · ${item.startTime}–${item.endTime}` : ""} · {item.quantity} {item.unit === "hour" ? "h" : item.quantity === 1 ? "dia" : "dias"}</p>
                <p className="text-xs text-ds-ink-muted">{item.attachmentCount ? `${item.attachmentCount} comprovante(s) no pedido` : "Sem comprovante"}{item.decidedBy ? ` · decidido por ${nameOf(item.decidedBy)} em ${whenBR(item.decidedAt)}` : ""}</p>
              </div>)) : <p className="text-sm text-ds-ink-muted">Nenhuma ausência no mês.</p>}
          </PanelSection>
        </SidePanel>
      ) : null}
    </div>
  );
}
