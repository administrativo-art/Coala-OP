"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, FileText, Loader2, RefreshCw, Share2 } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { BackButton } from "@/components/navigation/back-button";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { PanelSelectField, errorMessageOf } from "@/components/patterns/panel-form";
import { Segmented } from "@/components/patterns/segmented";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

import { brDate, fiscalTime, OfficialClockDisplay, ReceiptPill, saveFile } from "./marking-ui";
import { dayMarkingOrder } from "./marking-order";
import { useRepPMarking, type RepPReceiptStatus } from "./use-rep-p-marking";

type ReceiptStatus = RepPReceiptStatus;
type HistoryItem = {
  receiptId: string; workDate: string; nsr: number; markedAt: string; executionUnitId: string;
  collectorId: string; hash: string; receiptStatus: ReceiptStatus; receiptIssue: string | null;
};
type HistoryPayload = { markings: HistoryItem[]; truncated: boolean };
type HistoryView = "today" | "day" | "period";

export function MyTimeRecordingPage() {
  const { firebaseUser, permissions } = useAuth();
  const canView = permissions.dashboard.collaborator ?? permissions.dashboard.view;
  const [view, setView] = useState<HistoryView>("today");
  const loadHistoryRef = useRef<() => void>(() => undefined);
  const onRecorded = useCallback(() => { if (view === "today") loadHistoryRef.current(); }, [view]);
  const {
    today, request, fetchReceiptFile, options, optionsError, unitId, setUnitId, recording, recordError, record: recordMarking,
    lastMarking, setLastMarking, canRecord,
  } = useRepPMarking({ onRecorded });

  const [day, setDay] = useState(today);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [busyReceipt, setBusyReceipt] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<{ id: string; message: string } | null>(null);

  const range = useMemo(() => view === "today" ? { startDate: today, endDate: today }
    : view === "day" ? { startDate: day, endDate: day } : { startDate, endDate }, [view, today, day, startDate, endDate]);
  // Com histórico truncado a ordem do dia pode estar incompleta: a numeração some em vez de errar.
  const markingOrder = useMemo(() => history?.truncated ? new Map<string, number>() : dayMarkingOrder(history?.markings ?? []), [history]);
  const unitNames = useMemo(() => new Map(options?.executionUnits.map((unit) => [unit.id, unit.name]) ?? []), [options]);

  const loadHistory = useCallback(async () => {
    if (!firebaseUser) return;
    if (range.startDate > range.endDate) {
      setHistoryError("A data inicial precisa ser anterior à final.");
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const query = new URLSearchParams(range).toString();
      setHistory(await request<HistoryPayload>(`/api/dp/time-recording/markings?${query}`,
        { fallbackError: "Não foi possível carregar o histórico." }));
    } catch (error) {
      setHistoryError(errorMessageOf(error, "Não foi possível carregar o histórico."));
    } finally {
      setHistoryLoading(false);
    }
  }, [firebaseUser, range, request]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => { loadHistoryRef.current = () => { void loadHistory(); }; }, [loadHistory]);

  async function retryReceipt(receiptId: string) {
    setBusyReceipt(receiptId);
    setReceiptError(null);
    try {
      const result = await request<{ receiptStatus: ReceiptStatus; receiptIssue: string | null }>(
        `/api/dp/time-recording/receipts/${receiptId}`, { method: "POST", fallbackError: "Não foi possível emitir o comprovante." });
      if (result.receiptStatus !== "available") {
        setReceiptError({ id: receiptId, message: "O comprovante continua pendente. O ponto está registrado; tente mais tarde." });
      }
      setLastMarking((current) => current?.receiptId === receiptId ? { ...current, ...result } : current);
      void loadHistory();
    } catch (error) {
      setReceiptError({ id: receiptId, message: errorMessageOf(error, "Não foi possível emitir o comprovante.") });
    } finally {
      setBusyReceipt(null);
    }
  }

  const fetchReceipt = fetchReceiptFile;

  async function openReceipt(item: Pick<HistoryItem, "receiptId" | "nsr" | "markedAt">) {
    setBusyReceipt(item.receiptId);
    setReceiptError(null);
    try {
      saveFile(await fetchReceipt(item.receiptId, item.nsr, item.markedAt));
    } catch (error) {
      setReceiptError({ id: item.receiptId, message: errorMessageOf(error, "Não foi possível abrir o comprovante.") });
    } finally {
      setBusyReceipt(null);
    }
  }

  const canShareFiles = typeof navigator !== "undefined" && typeof navigator.canShare === "function";
  async function shareReceipt(item: Pick<HistoryItem, "receiptId" | "nsr" | "markedAt">) {
    setBusyReceipt(item.receiptId);
    setReceiptError(null);
    try {
      const file = await fetchReceipt(item.receiptId, item.nsr, item.markedAt);
      if (!navigator.canShare?.({ files: [file] })) {
        setReceiptError({ id: item.receiptId, message: "Este navegador não compartilha arquivos. Use Baixar comprovante." });
        return;
      }
      // Quem escolhe destino e confirma o envio é a pessoa, na folha nativa do sistema.
      await navigator.share({ files: [file], title: "Comprovante de registro de ponto" });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setReceiptError({ id: item.receiptId, message: errorMessageOf(error, "Não foi possível compartilhar o comprovante.") });
      }
    } finally {
      setBusyReceipt(null);
    }
  }

  function receiptActions(item: Pick<HistoryItem, "receiptId" | "nsr" | "markedAt" | "receiptStatus">) {
    const busy = busyReceipt === item.receiptId;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {item.receiptStatus === "available" ? (
          <>
            <Button type="button" variant="ds-secondary" size="sm" loading={busy} loadingLabel="Abrindo…" onClick={() => openReceipt(item)}>
              <FileText className="h-4 w-4" aria-hidden /> Baixar comprovante
            </Button>
            {canShareFiles ? (
              <Button type="button" variant="ds-ghost" size="sm" disabled={busy} onClick={() => shareReceipt(item)}>
                <Share2 className="h-4 w-4" aria-hidden /> Compartilhar
              </Button>
            ) : null}
          </>
        ) : (
          <Button type="button" variant="ds-secondary" size="sm" loading={busy} loadingLabel="Emitindo…" onClick={() => retryReceipt(item.receiptId)}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Tentar emitir comprovante
          </Button>
        )}
      </div>
    );
  }

  if (!canView) return <p className="p-6 text-ds-ink-muted">Sem permissão para acessar o Painel do colaborador.</p>;

  const noUnits = options && options.executionUnits.length === 0;
  return (
    <PageContainer variant="compact" className="space-y-5 pb-8">
      <BackButton fallbackHref="/dashboard/collaborator" label="Painel do colaborador" variant="ghost" size="sm" className="-ml-2" />
      <h1 className="text-2xl font-black tracking-tight text-ds-ink">Registro de ponto</h1>

      <section className="space-y-4 rounded-ds-card border border-ds-border bg-ds-surface p-5" aria-labelledby="record-title">
        <h2 id="record-title" className="text-base font-extrabold text-ds-ink">Registrar ponto</h2>
        {optionsError ? <p role="alert" className="text-sm font-semibold text-ds-danger">{optionsError}</p> : null}
        {!options && !optionsError ? (
          <p className="flex items-center gap-2 text-sm text-ds-ink-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando unidades…</p>
        ) : null}
        {options && !noUnits ? <OfficialClockDisplay clock={options.officialClock} /> : null}
        {options && !options.markingEnabled && !noUnits ? (
          <p className="text-sm text-ds-ink-muted">
            O registro de ponto pelo sistema ainda não foi liberado. Quando for, as batidas e os comprovantes ficam aqui.
          </p>
        ) : null}
        {noUnits ? (
          <p className="text-sm text-ds-ink-muted">
            Seu vínculo de hoje não está habilitado para registro de ponto. Procure o DP se isso estiver errado.
          </p>
        ) : null}
        {options && !noUnits ? (
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            {options.executionUnits.length > 1 ? (
              <PanelSelectField id="execution-unit" label="Unidade onde você está trabalhando" value={unitId}
                onChange={setUnitId}
                options={options.executionUnits} />
            ) : (
              <p className="text-sm text-ds-ink-2">Unidade: <strong>{options.executionUnits[0]?.name}</strong></p>
            )}
            <Button type="button" variant="primary-page" size="xl" loading={recording} loadingLabel="Registrando…"
              disabled={!canRecord} onClick={() => void recordMarking()}>
              <Clock3 className="h-4 w-4" aria-hidden /> Registrar ponto
            </Button>
          </div>
        ) : null}
        {recordError ? <p role="alert" className="text-sm font-semibold text-ds-danger">{recordError}</p> : null}
        {lastMarking ? (
          <div className="space-y-3 rounded-ds-md border border-ds-border bg-ds-warm p-4" role="status">
            <p className="text-sm text-ds-ink">
              Ponto registrado em {brDate(lastMarking.marking.markedAt)} às <strong>{fiscalTime(lastMarking.marking.markedAt)}</strong> · NSR {lastMarking.marking.nsr}
              {lastMarking.status === "replayed" ? " (já estava gravado)" : ""}
            </p>
            <ReceiptPill status={lastMarking.receiptStatus} />
            {receiptActions({ receiptId: lastMarking.receiptId, nsr: lastMarking.marking.nsr,
              markedAt: lastMarking.marking.markedAt, receiptStatus: lastMarking.receiptStatus })}
            {receiptError?.id === lastMarking.receiptId ? <p role="alert" className="text-xs font-semibold text-ds-danger">{receiptError.message}</p> : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-4 rounded-ds-card border border-ds-border bg-ds-surface p-5" aria-labelledby="history-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="history-title" className="text-base font-extrabold text-ds-ink">Minhas batidas</h2>
          <Segmented<HistoryView> aria-label="Período do histórico" value={view} onChange={setView}
            options={[{ value: "today", label: "Hoje" }, { value: "day", label: "Dia" }, { value: "period", label: "Período" }]} />
        </div>
        {view === "day" ? (
          <Field label="Dia" htmlFor="history-day">
            <input id="history-day" type="date" className={fieldInputClass} value={day} max={today} onChange={(event) => setDay(event.target.value)} />
          </Field>
        ) : null}
        {view === "period" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="De" htmlFor="history-start">
              <input id="history-start" type="date" className={fieldInputClass} value={startDate} max={today} onChange={(event) => setStartDate(event.target.value)} />
            </Field>
            <Field label="Até" htmlFor="history-end" hint="Até 62 dias por consulta.">
              <input id="history-end" type="date" className={fieldInputClass} value={endDate} max={today} onChange={(event) => setEndDate(event.target.value)} />
            </Field>
          </div>
        ) : null}
        {historyError ? <p role="alert" className="text-sm font-semibold text-ds-danger">{historyError}</p> : null}
        {historyLoading ? (
          <p className="flex items-center gap-2 text-sm text-ds-ink-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando batidas…</p>
        ) : history && history.markings.length === 0 ? (
          <p className="text-sm text-ds-ink-muted">Nenhuma batida neste período.</p>
        ) : history ? (
          <ul className="divide-y divide-ds-divider">
            {history.markings.map((item) => (
              <li key={item.receiptId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  {markingOrder.has(item.receiptId) ? (
                    <span className="mt-0.5 inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-ds-warm px-2 text-sm font-extrabold text-ds-ink"
                      aria-label={`${markingOrder.get(item.receiptId)}ª batida do dia`}>
                      {markingOrder.get(item.receiptId)}ª
                    </span>
                  ) : null}
                  <div className="space-y-1">
                    <p className="text-sm text-ds-ink">
                      <strong className="font-ds-mono text-base">{fiscalTime(item.markedAt)}</strong>
                      <span className="text-ds-ink-muted"> · {brDate(item.markedAt)} · NSR {item.nsr}</span>
                    </p>
                    <p className="text-xs text-ds-ink-muted">{unitNames.get(item.executionUnitId) ?? "Unidade do registro"}</p>
                    <ReceiptPill status={item.receiptStatus} />
                  </div>
                </div>
                <div className="space-y-1">
                  {receiptActions(item)}
                  {receiptError?.id === item.receiptId ? <p role="alert" className="text-xs font-semibold text-ds-danger">{receiptError.message}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {history?.truncated ? <p className="text-xs text-ds-ink-muted">Mostrando as primeiras 300 batidas. Reduza o período para ver as demais.</p> : null}
      </section>
    </PageContainer>
  );
}
