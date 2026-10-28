"use client";

import { useEffect, useMemo, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Segmented } from "@/components/patterns/segmented";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { MirrorCard } from "@/features/dp/time-adjustments/mirror-card";
import { ADJUSTMENT_KIND_LABELS, ADJUSTMENT_STATUS_LABELS, type AdjustmentView } from "@/features/dp/time-adjustments/types";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { cn } from "@/lib/utils";

import { fiscalClock } from "./day-model";

const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dateBR = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
const whenBR = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)} às ${value.slice(11, 16)}`;

export const ADJUSTMENT_STATUS_VARIANT: Record<AdjustmentView["status"], StatusPillVariant> = {
  in_review: "info", approved: "ok", rejected: "danger", cancelled: "neutral",
};

/** Horário original e informado de cada operação do pedido (original riscado → novo). */
function operationsOf(adjustment: AdjustmentView) {
  const operations = adjustment.operations?.length ? adjustment.operations
    : [{ kind: adjustment.kind, target: adjustment.target, inclusion: adjustment.inclusion }];
  return operations.map((operation) => ({
    kind: operation.kind,
    from: operation.target ? fiscalClock(operation.target.markedAt) : null,
    to: operation.inclusion ? fiscalClock(operation.inclusion.markedAt) : null,
  }));
}

/**
 * Histórico de ajustes do mês, como no Coala Go: tipo, horários (original riscado → informado), motivo, situação e trilha.
 * Abrir um pedido mostra o relatório completo; pedir um ajuste continua ligado ao dia, em Registros.
 */
export function AdjustmentsHistory({ adjustments, onOpen, onOpenDay }: {
  adjustments: AdjustmentView[]; onOpen: (id: string) => void; onOpenDay: (date: string) => void;
}) {
  const [status, setStatus] = useState<"all" | AdjustmentView["status"]>("all");
  const sorted = useMemo(() => [...adjustments].sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [adjustments]);
  const count = (value: AdjustmentView["status"]) => adjustments.filter((item) => item.status === value).length;
  const visible = sorted.filter((item) => status === "all" || item.status === status);
  return (
    <div className="space-y-3">
      <Segmented<"all" | AdjustmentView["status"]> aria-label="Filtrar ajustes por situação" value={status} onChange={setStatus}
        options={[{ value: "all", label: `Todos · ${adjustments.length}` }, { value: "in_review", label: `Em análise · ${count("in_review")}` },
          { value: "approved", label: `Aprovados · ${count("approved")}` }, { value: "rejected", label: `Recusados · ${count("rejected")}` }]} />
      {visible.length === 0 ? (
        <p className="rounded-ds-card border border-dashed border-ds-border bg-ds-surface p-6 text-center text-sm text-ds-ink-muted">
          {adjustments.length ? "Nenhum pedido nesta situação." : "Nenhum pedido de ajuste neste mês. Para pedir, abra o dia em Registros."}
        </p>
      ) : visible.map((adjustment) => {
        const requested = adjustment.acts.find((act) => act.action === "requested");
        const decided = [...adjustment.acts].reverse().find((act) => act.action !== "requested");
        return (
          <div key={adjustment.id} className="grid gap-x-4 gap-y-2 rounded-ds-btn-lg border border-ds-border bg-ds-surface px-4 py-3 md:grid-cols-[72px_minmax(0,1fr)_auto] md:items-center">
            <button type="button" onClick={() => onOpenDay(adjustment.workDate)} className="text-left font-ds-mono text-[15px] font-extrabold text-ds-ink hover:underline"
              aria-label={`Abrir o dia ${dateBR(adjustment.workDate)}`}>{dateBR(adjustment.workDate)}</button>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-bold text-ds-ink">{ADJUSTMENT_KIND_LABELS[adjustment.kind].title}{adjustment.scope === "pilot" ? <span className="ml-2 text-xs font-semibold text-ds-warn">simulação</span> : null}</p>
              <p className="flex flex-wrap gap-x-3 gap-y-1 font-ds-mono text-[13px]">
                {operationsOf(adjustment).map((operation, index) => (
                  <span key={index} className="inline-flex items-center gap-1.5">
                    {operation.from ? <s className="text-ds-ink-faint">{operation.from}</s> : null}
                    {operation.from && operation.to ? <span aria-hidden className="text-ds-ink-faint">→</span> : null}
                    {operation.to ? <strong className="text-ds-ink">{operation.to}</strong> : <span className="font-ds text-ds-ink-muted">desconsiderar</span>}
                  </span>
                ))}
              </p>
              <p className="truncate text-xs text-ds-ink-muted">“{adjustment.reason}”</p>
              <p className="text-xs text-ds-ink-faint">
                {requested ? `Pedido em ${whenBR(requested.at)}` : null}
                {decided ? ` · ${decided.action === "approved" ? "aprovado" : decided.action === "rejected" ? "recusado" : "cancelado"} em ${whenBR(decided.at)}` : null}
                {decided?.reason ? ` · ${decided.reason}` : null}
              </p>
            </div>
            <div className="flex items-center gap-2 md:flex-col md:items-end">
              <StatusPill variant={ADJUSTMENT_STATUS_VARIANT[adjustment.status]}>{ADJUSTMENT_STATUS_LABELS[adjustment.status]}</StatusPill>
              <button type="button" onClick={() => onOpen(adjustment.id)} className="text-xs font-bold text-ds-accent-ink underline">Ver relatório</button>
            </div>
          </div>
        );
      })}
      <p className="text-xs text-ds-ink-muted">A batida original nunca é apagada: o ajuste inclui ou desconsidera, e os dois ficam no histórico.</p>
    </div>
  );
}

type MirrorStatus = { closure: { status: "open" | "closed"; version: number } | null };

/**
 * Espelhos em grade de meses, como no Coala Go: uma leitura por competência do ano, só ao abrir esta consulta ou trocar o ano.
 * Somente competências fechadas abrem o espelho; o mês corrente mostra "fecha após".
 */
export function MirrorsGrid({ firebaseUser, today, employeeUid }: { firebaseUser: FirebaseUser | null; today: string; employeeUid?: string }) {
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = today.slice(0, 7);
  const [year, setYear] = useState(currentYear);
  const [statuses, setStatuses] = useState<Record<string, MirrorStatus | "error">>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`), [year]);

  useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;
    setLoading(true);
    const past = months.filter((month) => month <= currentMonth);
    Promise.all(past.map((competence) => authenticatedApiRequest<MirrorStatus>(
      `/api/dp/time-recording/mirrors?competence=${competence}${employeeUid ? `&employeeUid=${encodeURIComponent(employeeUid)}` : ""}`,
      { fallbackError: "Não foi possível ler o espelho.", getIdToken: () => firebaseUser.getIdToken() })
      .then((value) => [competence, value] as const, () => [competence, "error"] as const)))
      .then((entries) => {
        if (cancelled) return;
        const next = Object.fromEntries(entries);
        setStatuses(next);
        const closed = entries.filter(([, value]) => value !== "error" && value.closure?.status === "closed").map(([competence]) => competence);
        setSelected((current) => current && closed.includes(current) ? current : closed.at(-1) ?? null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentMonth, employeeUid, firebaseUser, months]);

  const lastDay = (month: string) => {
    const [y, m] = month.split("-").map(Number);
    return `${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}/${month.slice(5, 7)}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex h-9 items-center rounded-ds-md border border-ds-border bg-ds-surface">
          <button type="button" aria-label="Ano anterior" onClick={() => setYear((value) => value - 1)} className="px-2 text-ds-ink-muted hover:text-ds-ink"><ChevronLeft className="h-4 w-4" /></button>
          <span className="px-1 text-[13px] font-bold text-ds-ink">{year}</span>
          <button type="button" aria-label="Próximo ano" onClick={() => setYear((value) => value + 1)} disabled={year >= currentYear}
            className="px-2 text-ds-ink-muted hover:text-ds-ink disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ds-ink-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ds-ok" aria-hidden />Fechado, espelho disponível</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ds-caution" aria-hidden />Em aberto</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-dashed border-ds-ink-faint" aria-hidden />Sem fechamento</span>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {months.map((month) => {
          const status = statuses[month];
          const future = month > currentMonth;
          const closed = status && status !== "error" && status.closure?.status === "closed";
          const label = future ? "—" : loading && !status ? "Carregando…" : status === "error" ? "Indisponível"
            : closed ? `Fechado · v${status.closure!.version}` : month === currentMonth ? `Em aberto · fecha após ${lastDay(month)}` : "Sem fechamento";
          return (
            <button key={month} type="button" disabled={!closed} onClick={() => setSelected(month)} aria-pressed={selected === month}
              className={cn("flex flex-col gap-1 rounded-ds-md border bg-ds-surface px-3 py-2.5 text-left transition-colors enabled:hover:border-ds-ink-faint disabled:cursor-default",
                selected === month ? "border-ds-ink shadow-[inset_0_0_0_1px_var(--ds-ink)]" : "border-ds-border", future && "opacity-50")}>
              <span className="flex items-center gap-1.5 text-[13px] font-bold capitalize text-ds-ink">
                <span aria-hidden className={cn("h-2 w-2 rounded-full", closed ? "bg-ds-ok" : month === currentMonth ? "bg-ds-caution" : "border border-dashed border-ds-ink-faint")} />
                {MONTHS_SHORT[Number(month.slice(5, 7)) - 1]}
              </span>
              <span className="text-[11.5px] text-ds-ink-muted">{label}</span>
            </button>
          );
        })}
      </div>
      {selected ? <MirrorCard key={selected} firebaseUser={firebaseUser} competence={selected} employeeUid={employeeUid} />
        : !loading ? <p className="text-sm text-ds-ink-muted">Nenhum mês fechado em {year}. O espelho aparece aqui depois do fechamento do DP.</p> : null}
    </div>
  );
}
