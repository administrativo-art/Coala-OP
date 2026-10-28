"use client";

import { useCallback, useEffect, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { LiftRow } from "@/components/patterns/lift-row";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { TimeBankCard } from "@/features/dp/time-bank/time-bank-card";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

import type { ClosurePerson } from "./closure-core";
import { ClosingPackageCard } from "./closing-package-card";
import { MirrorCard } from "./mirror-card";
import { ADJUSTMENT_KIND_LABELS, ADJUSTMENT_STATUS_LABELS } from "./types";
import { belongsToTimeClosureRoster } from "@/lib/hr/employment-relationship";

type ClosureView = {
  status: "open" | "closed"; version: number; closedAt: string | null; closedBy: string | null; manifestHash: string | null;
  changes: { added: string[]; changed: string[]; removed: string[] } | null;
  reopenings: Array<{ at: string; by: string; reason: string; fromVersion: number }>;
};
type ClosingSummary = {
  counts: { total: number; closed: number; pending: number; overdue: number };
  people: Array<{ uid: string; name: string | null; status: "closed" | "pending"; packageStatus: string; sentAt: string | null; closedAt: string | null; overdue: boolean }>;
  overdue: Array<{ uid: string; name: string | null; status: string; sentAt: string | null }>;
  finalization: { at: string; by: string; people?: number; signed?: number } | null;
};
type ClosurePayload = {
  competence: string; closure: ClosureView | null; people: ClosurePerson[]; pending: { adjustments: number; absences: number; shiftSwaps: number };
  counts: { adjustments: number; absences: number; shiftSwaps: number }; truncated: boolean; can: { close: boolean; reopen: boolean };
};

const ABSENCE_STATUS: Record<string, string> = { submitted: "Enviada", in_review: "Em análise", adjustments_requested: "Ajustes pedidos", approved: "Aprovada", rejected: "Recusada", cancelled: "Cancelada" };
const SHIFT_SWAP_STATUS: Record<string, string> = { pending: "Pendente", accepted: "Aceita", rejected: "Recusada", cancelled: "Cancelada", stale: "Não aplicada" };
const dateBR = (value: string) => value.slice(0, 10).split("-").reverse().join("/");
const timeOf = (value: string) => value.slice(11, 16);
const whenBR = (value: string | null) => value ? `${dateBR(value)} ${timeOf(value)}` : "—";
function previousCompetence() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return date.toISOString().slice(0, 7);
}

/** Fechamento do ponto por competência: declaração por pessoa, bloqueio com pedido pendente, versão e reabertura. */
// Último dia da competência (o banco do DP olha o ciclo que contém o fim do mês fechado).
const lastDayOf = (competence: string) => new Date(Date.UTC(Number(competence.slice(0, 4)), Number(competence.slice(5, 7)), 0)).toISOString().slice(0, 10);

export function CompetenceClosureSection({ firebaseUser, people }: { firebaseUser: FirebaseUser | null; people: Array<{ id: string; username?: string; employmentRelationshipType?: string | null }> }) {
  const [competence, setCompetence] = useState(previousCompetence);
  const [data, setData] = useState<ClosurePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"close" | "reopen" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ClosurePerson | null>(null);
  const [bulk, setBulk] = useState<{ running: boolean; sent: number; skipped: string[] } | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [packagesKey, setPackagesKey] = useState(0);
  const [summary, setSummary] = useState<ClosingSummary | null>(null);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  // Aberto: prévia da equipe atual. Fechado: usa exatamente a equipe congelada naquela versão.
  const activeTeam = people.filter((person) => belongsToTimeClosureRoster(person.employmentRelationshipType)).sort((left, right) => (left.username ?? '').localeCompare(right.username ?? '', 'pt-BR'));
  const team = data?.closure?.status === "closed"
    ? data.people.map((person) => ({ id: person.uid, username: person.name ?? undefined }))
    : activeTeam;
  const names = new Map([...people.map((person) => [person.id, person.username ?? "Responsável"] as const),
    ...(data?.people ?? []).map((person) => [person.uid, person.name ?? "Responsável"] as const)]);
  const individualByUid = new Map((summary?.people ?? []).map((person) => [person.uid, person]));
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
  const closedVersion = data?.closure?.status === "closed" ? data.closure.version : null;
  const loadSummary = useCallback(async () => {
    if (!closedVersion) { setSummary(null); return; }
    try { setSummary(await request<ClosingSummary>(`/api/dp/time-recording/closing-packages?competence=${competence}`, { fallbackError: "Não foi possível ler os pacotes." })); }
    catch { setSummary(null); }
  }, [closedVersion, competence, request]);
  useEffect(() => { void loadSummary(); }, [loadSummary, packagesKey]);

  async function finalize() {
    if (!closedVersion) return;
    setBusy(true);
    setActionError(null);
    try {
      await request("/api/dp/time-recording/closing-packages", { method: "POST", json: { action: "finalize", competence, expectedVersion: closedVersion },
        fallbackError: "Não foi possível finalizar o fechamento." });
      setConfirmFinalize(false);
      await loadSummary();
    } catch (cause) {
      setActionError(errorMessageOf(cause, "Não foi possível finalizar o fechamento."));
    } finally {
      setBusy(false);
    }
  }

  /** Envia, uma pessoa por vez, os pacotes prontos; quem não está pronto (contracheque, e-mail) fica listado. */
  async function sendAll() {
    if (!data?.closure) return;
    setConfirmBulk(false);
    setBulk({ running: true, sent: 0, skipped: [] });
    let sent = 0;
    const skipped: string[] = [];
    for (const person of team) {
      try {
        await request("/api/dp/time-recording/closing-packages", { method: "POST", json: { action: "send", competence, expectedVersion: data.closure.version, employeeUid: person.id },
          fallbackError: "Não foi possível enviar." });
        sent += 1;
      } catch (cause) {
        skipped.push(`${person.username ?? "Sem nome"}: ${errorMessageOf(cause, "não enviado")}`);
      }
      setBulk({ running: true, sent, skipped: [...skipped] });
    }
    setBulk({ running: false, sent, skipped });
    setPackagesKey((value) => value + 1);
  }

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
  const blocked = Boolean(data && (data.pending.adjustments || data.pending.absences || data.pending.shiftSwaps || data.truncated));
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
        <p className="text-sm text-ds-ink">{data.people.length} {data.people.length === 1 ? "pessoa" : "pessoas"} no fechamento · {data.counts.adjustments} ajustes de ponto · {data.counts.absences} ausências · {data.counts.shiftSwaps} trocas de turno.</p>
        {closed ? <p className="text-xs text-ds-ink-muted">Fechada em {whenBR(data.closure!.closedAt)} por {nameOf(data.closure!.closedBy)}. Carimbo da declaração: <span className="font-mono">{data.closure!.manifestHash?.slice(0, 16)}…</span></p> : null}
        {closed && data.closure!.changes ? <p className="text-xs text-ds-ink-muted">Em relação à versão anterior: {data.closure!.changes.added.length} itens novos, {data.closure!.changes.changed.length} alterados, {data.closure!.changes.removed.length} retirados.</p> : null}
        {!closed && (data.pending.adjustments || data.pending.absences || data.pending.shiftSwaps) ? <p role="status" className="rounded-ds-btn bg-ds-caution-bg px-3 py-2 text-xs font-semibold text-ds-caution">
          Há pedidos sem decisão: {data.pending.adjustments} de ajuste, {data.pending.absences} de ausência e {data.pending.shiftSwaps} de troca de turno. Decida-os antes de fechar.</p> : null}
        {!closed && data.truncated ? <p role="alert" className="text-xs font-semibold text-ds-danger">O mês tem mais pedidos do que o fechamento comporta numa vez. Fale com o desenvolvimento.</p> : null}
        {data.people.filter((person) => person.adjustments.length || person.absences.length || person.shiftSwaps.length).map((person) => {
          const pending = person.adjustments.filter((item) => item.status === "in_review").length
            + person.absences.filter((item) => ["submitted", "in_review", "adjustments_requested"].includes(item.status)).length
            + person.shiftSwaps.filter((item) => item.status === "pending").length;
          return (
            <LiftRow key={person.uid} table onClick={() => setSelected(person)} className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-extrabold text-ds-ink">{person.name ?? nameOf(person.uid)}</span>
                <span className="block text-sm text-ds-ink-muted">{person.adjustments.length} ajustes · {person.absences.length} ausências · {person.shiftSwaps.length} trocas</span>
              </span>
              {pending ? <StatusPill variant="warn">{pending} pendente{pending > 1 ? "s" : ""}</StatusPill> : <StatusPill variant="neutral">Declarado</StatusPill>}
            </LiftRow>
          );
        })}
        {closed ? <div className="space-y-2 border-t border-ds-divider pt-3">
          <p className="text-sm font-extrabold text-ds-ink">Fechamentos individuais e fechamento geral</p>
          <p className="text-xs text-ds-ink-muted">Cada pessoa conclui seu fechamento individual ao assinar na Autentique o documento com o espelho e o contracheque. O fechamento geral só pode ser concluído depois da assinatura de todos.</p>
          {summary ? <div className="flex flex-wrap items-center gap-2">
            {summary.finalization ? <StatusPill variant="ok">Fechamento geral concluído em {whenBR(summary.finalization.at)}</StatusPill> : <StatusPill variant="warn">Fechamento geral pendente</StatusPill>}
            <span className="text-xs text-ds-ink-muted">{summary.counts.closed} individuais fechados · {summary.counts.pending} pendentes · {summary.counts.overdue} atrasados</span>
          </div> : null}
          {summary?.overdue.length ? <p role="status" className="rounded-ds-btn bg-ds-caution-bg px-3 py-2 text-xs font-semibold text-ds-caution">
            {summary.overdue.length} {summary.overdue.length === 1 ? "pessoa não assinou" : "pessoas não assinaram"} em 24 horas ou recusou: {summary.overdue.map((item) => item.name ?? nameOf(item.uid)).join(", ")}. O fechamento geral continua pendente; reenvie para assinatura.</p> : null}
          {summary && !summary.finalization && data.can.close ? (confirmFinalize
            ? <InlineConfirm message="Concluir o fechamento geral? Todos os colaboradores desta versão assinaram seus documentos." confirmLabel="Concluir fechamento geral" loadingLabel="Finalizando…"
                loading={busy} onConfirm={() => void finalize()} onCancel={() => setConfirmFinalize(false)} />
            : <Button variant="primary-page" size="sm" disabled={busy || summary.counts.total === 0 || summary.counts.pending > 0}
                onClick={() => setConfirmFinalize(true)}>Concluir fechamento geral</Button>) : null}
          {data.can.close ? (confirmBulk
            ? <InlineConfirm message={`Enviar os pacotes de ${team.length} pessoas? Quem ainda não tem contracheque ou e-mail fica de fora e aparece na lista.`} confirmLabel="Enviar todos os prontos"
                loadingLabel="Enviando…" loading={bulk?.running ?? false} onConfirm={() => void sendAll()} onCancel={() => setConfirmBulk(false)} />
            : <Button variant="ds-secondary" size="sm" disabled={bulk?.running} onClick={() => setConfirmBulk(true)}>Enviar todos os prontos</Button>) : null}
          {bulk ? <p role="status" className="text-xs text-ds-ink-muted">{bulk.running ? "Enviando…" : "Concluído."} {bulk.sent} enviados ou já em assinatura.{bulk.skipped.length ? ` Ficaram de fora: ${bulk.skipped.join("; ")}.` : ""}</p> : null}
          {team.map((person) => {
            const individual = individualByUid.get(person.id);
            return <LiftRow key={`${person.id}-${packagesKey}`} table onClick={() => setSelected(data.people.find((item) => item.uid === person.id) ?? { uid: person.id, name: person.username ?? null, adjustments: [], absences: [], shiftSwaps: [] })}
              className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-bold text-ds-ink">{person.username ?? "Sem nome"}</span>
              {individual?.status === "closed" ? <StatusPill variant="ok">Individual fechado</StatusPill>
                : individual?.overdue ? <StatusPill variant="danger">Individual atrasado</StatusPill>
                  : <StatusPill variant="warn">Individual pendente</StatusPill>}
            </LiftRow>;
          })}
        </div> : null}
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
          subtitle={`${selected.adjustments.length} ajustes · ${selected.absences.length} ausências · ${selected.shiftSwaps.length} trocas`}>
          {closed ? <MirrorCard firebaseUser={firebaseUser} competence={competence} employeeUid={selected.uid} /> : null}
          {closed ? <ClosingPackageCard firebaseUser={firebaseUser} competence={competence} employeeUid={selected.uid} onChanged={() => setPackagesKey((value) => value + 1)} /> : null}
          {closed ? <TimeBankCard firebaseUser={firebaseUser} employeeUid={selected.uid} date={lastDayOf(competence)} canManage={data.can.close} /> : null}
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
          <PanelSection title="Trocas de turno" aside="aceite autenticado">
            {selected.shiftSwaps.length ? selected.shiftSwaps.map((item) => {
              const requester = item.requesterUid === selected.uid;
              const own = requester ? item.offeredShift : item.requestedShift;
              const incoming = requester ? item.requestedShift : item.offeredShift;
              const counterpart = requester ? item.targetName : item.requesterName;
              return <div key={item.id} className="space-y-0.5 border-b border-ds-border py-2 text-sm last:border-0">
                <p className="font-bold text-ds-ink">{dateBR(item.date)} · {SHIFT_SWAP_STATUS[item.status] ?? item.status} · {item.unitName}</p>
                <p className="text-ds-ink">{own.startTime}–{own.endTime} por {incoming.startTime}–{incoming.endTime} · com {counterpart}</p>
                {item.reason ? <p className="text-xs text-ds-ink-muted">Motivo: {item.reason}</p> : null}
                {item.acts.map((act, index) => <p key={`${act.action}:${act.at}:${index}`} className="text-xs text-ds-ink-muted">
                  {act.actorName} em {whenBR(act.at)}: {act.declaration}
                </p>)}
              </div>;
            }) : <p className="text-sm text-ds-ink-muted">Nenhuma troca de turno no mês.</p>}
          </PanelSection>
        </SidePanel>
      ) : null}
    </div>
  );
}
