"use client";

import { useCallback, useEffect, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { cn } from "@/lib/utils";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { LiftRow } from "@/components/patterns/lift-row";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { PanelSection } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

import type { ClosurePerson } from "./closure-core";
import { ClosingPackageCard } from "./closing-package-card";
import { MirrorCard } from "./mirror-card";
import { ADJUSTMENT_KIND_LABELS, ADJUSTMENT_STATUS_LABELS } from "./types";
import { belongsToTimeClosureRoster } from "@/lib/hr/employment-relationship";
import { ClosurePersonTrail } from "./closure-person-trail";
import { ClosureSidebar, type ClosureSidebarGroup } from "./closure-sidebar";
import { ClosureYearOverview, competenceLabel, pendingOfPerson, useOrganizationOf, NO_ORGANIZATION } from "./closure-year-overview";

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

export function CompetenceClosureSection({ firebaseUser, people }: { firebaseUser: FirebaseUser | null; people: Array<{ id: string; username?: string; employmentRelationshipType?: string | null; unitId?: string | null; employerUnitId?: string | null }> }) {
  const [competence, setCompetence] = useState(previousCompetence);
  // Visão geral do ano (cards por mês) até o usuário abrir uma competência.
  const [detailOpen, setDetailOpen] = useState(false);
  const organizationOf = useOrganizationOf(people);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [orgName, setOrgName] = useState<string | null>(null);
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
  const orgOptions = (() => {
    const counts = new Map<string, number>();
    for (const member of activeTeam) counts.set(organizationOf(member.id), (counts.get(organizationOf(member.id)) ?? 0) + 1);
    return [...counts.entries()].sort(([left], [right]) => (left === NO_ORGANIZATION ? 1 : right === NO_ORGANIZATION ? -1 : left.localeCompare(right, "pt-BR")));
  })();
  const activeOrg = orgOptions.some(([name]) => name === orgName) ? orgName : (orgOptions[0]?.[0] ?? null);
  const orgTeam = team.filter((member) => organizationOf(member.id) === activeOrg);
  const individualByUid = new Map((summary?.people ?? []).map((person) => [person.uid, person]));
  const nameOf = (uid: string | null) => uid ? names.get(uid) ?? "Responsável" : "—";
  const request = useCallback(<T,>(input: string, init: { method?: string; json?: unknown; fallbackError: string }) =>
    authenticatedApiRequest<T>(input, { ...init, getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null) }), [firebaseUser]);

  const load = useCallback(async () => {
    if (!detailOpen) return;
    setError(null);
    setData(null);
    try {
      setData(await request<ClosurePayload>(`/api/dp/time-recording/closures?competence=${competence}`, { fallbackError: "Não foi possível carregar o fechamento." }));
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível carregar o fechamento."));
    }
  }, [competence, detailOpen, request]);
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
    for (const person of orgTeam) {
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
  const emptyPerson = (uid: string, name: string | null): ClosurePerson => ({ uid, name, adjustments: [], absences: [], shiftSwaps: [] });
  const orgPeople = (data?.people ?? []).filter((person) => organizationOf(person.uid) === activeOrg);
  const orgPending = orgPeople.reduce((sum, person) => sum + pendingOfPerson(person), 0);
  const sidebarGroups: ClosureSidebarGroup[] = (() => {
    if (!detailOpen) {
      return [{ organization: "", people: orgOptions.map(([name, count]) => ({
        key: name, name, pending: 0, meta: String(count), detail: `${count} ${count === 1 ? "pessoa" : "pessoas"} no fechamento`, selected: name === activeOrg,
        onClick: () => setOrgName(name),
      })) }];
    }
    const query = sidebarQuery.trim().toLocaleLowerCase("pt-BR");
    const members = orgTeam.filter((member) => !query || (member.username ?? "").toLocaleLowerCase("pt-BR").includes(query)).map((member) => {
      const name = member.username ?? "Sem nome";
      const record = data?.people.find((item) => item.uid === member.id);
      return { key: member.id, name, pending: record ? pendingOfPerson(record) : 0, selected: selected?.uid === member.id,
        detail: record ? `${record.adjustments.length} ajustes · ${record.absences.length} ausências · ${record.shiftSwaps.length} trocas` : "Sem pedidos no mês",
        onClick: () => setSelected(record ?? emptyPerson(member.id, name)) };
    });
    return members.length ? [{ organization: activeOrg ?? NO_ORGANIZATION, people: members }] : [];
  })();
  const sidebarTotal = sidebarGroups.reduce((sum, group) => sum + group.people.length, 0);
  const sidebarClear = sidebarGroups.reduce((sum, group) => sum + group.people.filter((person) => !person.pending).length, 0);
  const blocked = Boolean(data && (data.pending.adjustments || data.pending.absences || data.pending.shiftSwaps || data.truncated));
  return (
    <div className="flex flex-col gap-[14px] lg:flex-row lg:items-start">
    <ClosureSidebar mode={detailOpen ? "people" : "organizations"} title={detailOpen ? activeOrg ?? "Fechamento" : "Fechamento · DP"} subtitle={detailOpen ? competenceLabel(competence) : "Organizações"}
      groups={sidebarGroups} query={sidebarQuery} onQueryChange={setSidebarQuery} showBack={detailOpen}
      onBack={() => { setDetailOpen(false); setData(null); setSelected(null); setActionError(null); setConfirming(null); }}
      doneCount={sidebarClear} totalCount={sidebarTotal} />
    <div className="min-w-0 flex-1 space-y-3">
      {!detailOpen ? <ClosureYearOverview firebaseUser={firebaseUser} people={people} organization={activeOrg} onOpen={(value) => { setCompetence(value); setDetailOpen(true); }} /> : null}
      {detailOpen ? <div className="flex flex-wrap items-center gap-3">
        <Button variant="ds-secondary" size="sm" onClick={() => { setDetailOpen(false); setData(null); setSelected(null); setActionError(null); setConfirming(null); }}>← Todos os meses</Button>
        <h2 className="text-lg font-black text-ds-ink">{competenceLabel(competence)}</h2>
        {data ? <StatusPill variant={closed ? "ok" : "neutral"}>{closed ? `Fechada · versão ${data.closure!.version}` : data.closure?.reopenings.length ? "Reaberta" : "Aberta"}</StatusPill> : null}
      </div> : null}
      {detailOpen && error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : null}
      {detailOpen && !data && !error ? <p className="text-sm text-ds-ink-muted">Carregando fechamento…</p> : null}
      {detailOpen && data && !selected ? <>
        <p className="text-sm text-ds-ink">{orgPeople.length} {orgPeople.length === 1 ? "pessoa" : "pessoas"} em {activeOrg} · {orgPeople.reduce((sum, person) => sum + person.adjustments.length, 0)} ajustes de ponto · {orgPeople.reduce((sum, person) => sum + person.absences.length, 0)} ausências · {orgPeople.reduce((sum, person) => sum + person.shiftSwaps.length, 0)} trocas de turno.</p>
        {closed ? <p className="text-xs text-ds-ink-muted">Fechada em {whenBR(data.closure!.closedAt)} por {nameOf(data.closure!.closedBy)}. Carimbo da declaração: <span className="font-mono">{data.closure!.manifestHash?.slice(0, 16)}…</span></p> : null}
        {closed && data.closure!.changes ? <p className="text-xs text-ds-ink-muted">Em relação à versão anterior: {data.closure!.changes.added.length} itens novos, {data.closure!.changes.changed.length} alterados, {data.closure!.changes.removed.length} retirados.</p> : null}
        <TrailStep number={1} title="Sanar pendências da folha" state={closed || (!orgPending && !blocked) ? "done" : "active"}
          summary={closed ? "Folha declarada" : orgPending ? `${orgPending} ${orgPending === 1 ? "pedido sem decisão" : "pedidos sem decisão"} nesta organização` : blocked ? "Esta organização está em dia; há pendências em outra" : "Nenhuma pendência"}>
          {!closed && (data.pending.adjustments || data.pending.absences || data.pending.shiftSwaps) ? <p role="status" className="rounded-ds-btn bg-ds-caution-bg px-3 py-2 text-xs font-semibold text-ds-caution">
            Há pedidos sem decisão no mês: {data.pending.adjustments} de ajuste, {data.pending.absences} de ausência e {data.pending.shiftSwaps} de troca de turno (todas as organizações). Decida-os antes de fechar.</p> : null}
          {!closed && data.truncated ? <p role="alert" className="text-xs font-semibold text-ds-danger">O mês tem mais pedidos do que o fechamento comporta numa vez. Fale com o desenvolvimento.</p> : null}
        {(() => {
          const declared = orgPeople.filter((person) => person.adjustments.length || person.absences.length || person.shiftSwaps.length).sort((left, right) => pendingOfPerson(right) - pendingOfPerson(left));
          const groups = new Map<string, typeof declared>();
          for (const person of declared) groups.set(organizationOf(person.uid), [...(groups.get(organizationOf(person.uid)) ?? []), person]);
          const ordered = [...groups.entries()].sort(([left], [right]) => (left === NO_ORGANIZATION ? 1 : right === NO_ORGANIZATION ? -1 : left.localeCompare(right, "pt-BR")));
          return ordered.map(([organization, members]) => {
            const pendingPeople = members.filter((person) => pendingOfPerson(person)).length;
            return (
              <section key={organization} className="space-y-1.5">
                <div className="flex items-baseline gap-2 pt-2">
                  <h3 className="text-sm font-black text-ds-ink">{organization}</h3>
                  <span className="text-xs font-bold text-ds-ink-muted">{members.length} {members.length === 1 ? "pessoa" : "pessoas"}{pendingPeople ? ` · ${pendingPeople} com pendência` : ""}</span>
                </div>
                {members.map((person) => {
                  const pending = pendingOfPerson(person);
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
              </section>
            );
          });
        })()}
        </TrailStep>
        <TrailStep number={2} title="Fechar a competência" state={closed ? "done" : blocked ? "locked" : "active"}
          summary={closed ? `Fechada · versão ${data.closure!.version}` : blocked ? "Libera quando não houver pedido sem decisão" : "Congela a declaração de todas as organizações"}>
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
        </TrailStep>
        <TrailStep number={3} title="Assinaturas e fechamento geral" state={!closed ? "locked" : summary?.finalization ? "done" : "active"}
          summary={!closed ? "Libera depois de fechar a competência" : summary?.finalization ? "Fechamento geral concluído" : "Cada pessoa assina o espelho e o contracheque"}>
        {closed ? <div className="space-y-2">
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
            ? <InlineConfirm message={`Enviar os pacotes de ${orgTeam.length} pessoas? Quem ainda não tem contracheque ou e-mail fica de fora e aparece na lista.`} confirmLabel="Enviar todos os prontos"
                loadingLabel="Enviando…" loading={bulk?.running ?? false} onConfirm={() => void sendAll()} onCancel={() => setConfirmBulk(false)} />
            : <Button variant="ds-secondary" size="sm" disabled={bulk?.running} onClick={() => setConfirmBulk(true)}>Enviar todos os prontos</Button>) : null}
          {bulk ? <p role="status" className="text-xs text-ds-ink-muted">{bulk.running ? "Enviando…" : "Concluído."} {bulk.sent} enviados ou já em assinatura.{bulk.skipped.length ? ` Ficaram de fora: ${bulk.skipped.join("; ")}.` : ""}</p> : null}
          {orgTeam.map((person) => {
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
        </TrailStep>
      </> : null}
      {detailOpen && selected ? (() => {
        const person = data?.people.find((item) => item.uid === selected.uid) ?? selected;
        const pending = pendingOfPerson(person);
        return <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-black text-ds-ink">{person.name ?? nameOf(person.uid)}</h2>
            {pending ? <StatusPill variant="warn">{pending} pendente{pending > 1 ? "s" : ""}</StatusPill> : null}
          </div>
          <ClosurePersonTrail key={person.uid} firebaseUser={firebaseUser} competence={competence} person={person} closed={closed} canManage={data?.can.close ?? false}
            requests={<>
            <div className="space-y-4">
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
            </div>
            </>}
            closing={closed ? <>
              <MirrorCard firebaseUser={firebaseUser} competence={competence} employeeUid={person.uid} />
              <ClosingPackageCard firebaseUser={firebaseUser} competence={competence} employeeUid={person.uid} onChanged={() => setPackagesKey((value) => value + 1)} />
            </> : <div className="space-y-2 rounded-ds-card border border-ds-border bg-ds-surface px-4 py-3">
              <h4 className="text-sm font-black text-ds-ink">Fechar a folha de ponto</h4>
              <p className="text-xs text-ds-ink-muted">Hoje o fechamento congela a competência de todas as pessoas de uma vez e gera o espelho de cada uma. O espelho só vai ao colaborador no envio final, junto com o contracheque.</p>
              {actionError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{actionError}</p> : null}
              {data?.can.close ? (confirming === "close"
                ? <InlineConfirm message={`Fechar ${competenceLabel(competence)}? A declaração de todas as pessoas fica congelada e o mês deixa de aceitar pedido de ajuste.`} confirmLabel="Fechar competência" loadingLabel="Fechando…"
                    loading={busy} onConfirm={() => void act("close")} onCancel={() => setConfirming(null)} />
                : <Button variant="primary-page" disabled={blocked} onClick={() => { setActionError(null); setConfirming("close"); }}>Fechar competência</Button>) : null}
              {blocked ? <p className="text-xs text-ds-caution">Há pedidos sem decisão no mês (em alguma pessoa). Decida-os antes de fechar.</p> : null}
            </div>} />
        </div>;
      })() : null}
    </div>
    </div>
  );
}

type TrailState = "done" | "active" | "locked";
/** Etapa da trilha de fechamento: número, situação e resumo; o conteúdo só abre quando a etapa não está bloqueada. */
function TrailStep({ number, title, state, summary, children }: { number: number; title: string; state: TrailState; summary: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-[16px] border bg-ds-surface px-4 py-3.5", state === "active" ? "border-ds-accent-ink/40" : "border-ds-border", state === "locked" && "opacity-70")}>
      <div className="flex items-center gap-3">
        <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black",
          state === "done" ? "bg-ds-ok text-white" : state === "active" ? "bg-ds-accent-ink text-white" : "bg-ds-divider text-ds-ink-muted")}>{state === "done" ? "✓" : number}</span>
        <div className="min-w-0">
          <h3 className="text-sm font-black text-ds-ink">{title}</h3>
          <p className="text-xs font-semibold text-ds-ink-muted">{summary}</p>
        </div>
      </div>
      {state !== "locked" ? <div className="mt-3 space-y-2">{children}</div> : null}
    </section>
  );
}
