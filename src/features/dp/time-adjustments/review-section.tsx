"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { Search } from "lucide-react";

import { LiftRow } from "@/components/patterns/lift-row";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { Segmented } from "@/components/patterns/segmented";
import { PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { SortHeader } from "@/components/patterns/sort-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { purposeLabel } from "@/features/dp/rep-p/record-strip";

import { AdjustmentReport } from "./adjustment-panel";
import type { AdjustmentDayContext } from "./day-summary";
import {
  buildReviewRows, filterReviewRows, formatWorkDate, nextReviewSort, normalizeReviewText, sortReviewRows,
  type ReviewFilters, type ReviewRow, type ReviewSort,
} from "./review-list";
import { ADJUSTMENT_KIND_LABELS, type AdjustmentView, type MarkingClassificationRequestView } from "./types";

/** "Segunda, 26/10/2026": o dia da semana ajuda a conferir contra a escala. */
function weekdayDate(workDate: string) {
  const weekday = new Date(`${workDate}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long" });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${workDate.split("-").reverse().join("/")}`;
}

/** Colunas da fila: colaborador, pedido, dia e situação (a última só no desktop). */
const ROW_COLUMNS = "md:grid-cols-[minmax(0,2.2fr)_minmax(0,2.4fr)_112px_112px]";

/** Fila de ajustes de ponto para quem analisa: aprovar ou recusar sempre com justificativa. */
export function AdjustmentReviewSection({ firebaseUser, people, onCountChange }: {
  firebaseUser: FirebaseUser | null;
  people: Array<{ id: string; username?: string; avatarUrl?: string; color?: string }>;
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
  const [sort, setSort] = useState<ReviewSort>({ key: "day", direction: "desc" });
  const [filters, setFilters] = useState<ReviewFilters>({ search: "", kind: "all" });
  const names = new Map(people.map((person) => [person.id, person.username ?? "Responsável"]));
  // Foto e cor vêm do cadastro: pelo id da pessoa e, quando o pedido guarda outro id (classificação), pelo nome.
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  // Só casa por nome quando ele é único: com homônimos, mostrar a foto de outra pessoa é pior que mostrar as iniciais.
  const peopleByName = useMemo(() => {
    const byName = new Map<string, typeof people[number] | null>();
    for (const person of people) {
      const key = normalizeReviewText(person.username ?? "");
      byName.set(key, byName.has(key) ? null : person);
    }
    return byName;
  }, [people]);
  const personFor = useCallback((personId: string, name: string) => peopleById.get(personId) ?? peopleByName.get(normalizeReviewText(name)), [peopleById, peopleByName]);
  const allRows = useMemo(() => buildReviewRows(items ?? [], classificationItems), [items, classificationItems]);
  const rows = useMemo(() => sortReviewRows(filterReviewRows(allRows, filters), sort), [allRows, filters, sort]);
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

  function openRow(row: ReviewRow) {
    if (row.source.type === "adjustment") { setSelected(row.source.item); setSelectedClassification(null); }
    else { setSelectedClassification(row.source.item); setSelected(null); }
    setReason("");
    setDecisionError(null);
  }
  const panelAvatar = (personId: string, name: string, size: number) => {
    const person = personFor(personId, name);
    return <PersonAvatar name={name} avatarUrl={person?.avatarUrl} color={person?.color} size={size} />;
  };

  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : null}
      {items === null && !error ? <p className="text-sm text-ds-ink-muted">Carregando ajustes…</p> : null}
      {items?.length === 0 && classificationItems.length === 0 ? <p className="text-sm text-ds-ink-muted">Nenhum ajuste de ponto aguardando análise.</p> : null}
      {allRows.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative block w-full sm:w-72">
              <span className="sr-only">Buscar por colaborador ou pedido</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" />
              <Input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                placeholder="Buscar colaborador ou pedido" className="h-9 pl-9" />
            </label>
            <Segmented aria-label="Tipo de pedido" value={filters.kind} onChange={(kind) => setFilters((current) => ({ ...current, kind }))}
              options={[{ value: "all", label: "Todos" }, { value: "adjustment", label: "Ajustes" }, { value: "classification", label: "Classificações" }]} />
            <p role="status" className="text-xs font-semibold text-ds-ink-muted">
              {rows.length === allRows.length ? `${allRows.length} ${allRows.length === 1 ? "pedido" : "pedidos"}` : `${rows.length} de ${allRows.length} pedidos`}
            </p>
          </div>
          {rows.length === 0 ? (
            <p className="rounded-[18px] border border-dashed border-ds-border px-4 py-6 text-center text-sm text-ds-ink-muted">Nenhum pedido com esses filtros.</p>
          ) : (
            <div className="rounded-[18px] border border-ds-border bg-ds-surface shadow-xs">
              <div className={`flex flex-wrap gap-x-5 gap-y-1 border-b border-ds-divider px-[18px] py-3 md:grid md:items-center md:gap-x-4 ${ROW_COLUMNS}`}>
                <SortHeader label="Colaborador" active={sort.key === "employee"} direction={sort.direction} onClick={() => setSort((current) => nextReviewSort(current, "employee"))} />
                <SortHeader label="Pedido" active={sort.key === "request"} direction={sort.direction} onClick={() => setSort((current) => nextReviewSort(current, "request"))} />
                <SortHeader label="Dia" active={sort.key === "day"} direction={sort.direction} onClick={() => setSort((current) => nextReviewSort(current, "day"))} />
                <span className="hidden text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint md:block">Situação</span>
              </div>
              {rows.map((row) => (
                <LiftRow key={row.key} table onClick={() => openRow(row)} className={`grid items-center gap-x-4 gap-y-1 last:border-b-0 ${ROW_COLUMNS}`}>
                  <span className="flex min-w-0 items-center gap-3">
                    {panelAvatar(row.personId, row.employeeName, 36)}
                    <span className="truncate text-sm font-extrabold text-ds-ink">{row.employeeName}</span>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-ds-ink-2">
                    {row.pilot ? <StatusPill variant="warn">Simulação</StatusPill> : null}
                    <span>{row.requestLabel}</span>
                  </span>
                  <span className="text-sm font-bold text-ds-ink">{formatWorkDate(row.workDate)}</span>
                  <span><StatusPill variant="info">Em análise</StatusPill></span>
                </LiftRow>
              ))}
            </div>
          )}
        </>
      ) : null}
      {selected ? (
        <SidePanel open onOpenChange={(next) => { if (!next && !busy) setSelected(null); }} kicker={selected.scope === "pilot" ? "Simulação de ajuste" : "Ajuste de ponto"}
          title={<span className="flex min-w-0 items-center gap-3">{panelAvatar(selected.employeeUid, selected.employeeName ?? "Titular", 36)}<span className="min-w-0 truncate">{selected.employeeName ?? "Titular"}</span></span>}
          subtitle={`${weekdayDate(selected.workDate)} · ${ADJUSTMENT_KIND_LABELS[selected.kind].title}`}
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
          title={<span className="flex min-w-0 items-center gap-3">{panelAvatar(selectedClassification.employeeId, selectedClassification.employeeName ?? "Titular", 36)}<span className="min-w-0 truncate">{selectedClassification.employeeName ?? "Titular"}</span></span>}
          subtitle={`${formatWorkDate(selectedClassification.workDate)} · NSR ${selectedClassification.nsr}`}>
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
