"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, FileText, Loader2, RefreshCw, Share2 } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { BackButton } from "@/components/navigation/back-button";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { PanelSelectField, errorMessageOf } from "@/components/patterns/panel-form";
import { Segmented } from "@/components/patterns/segmented";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useAuth } from "@/hooks/use-auth";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

import { formatOfficialClock, officialClockOffsetMs } from "./official-clock";

type ReceiptStatus = "available" | "pending";
type ExecutionUnit = { id: string; name: string; employer: boolean };
type OfficialClock = { available: true; instant: string; timeZone: string } | { available: false; issue: string };
type OptionsPayload = { workDate: string; eligible: boolean; executionUnits: ExecutionUnit[]; officialClock: OfficialClock | null };
type HistoryItem = {
  receiptId: string; workDate: string; nsr: number; markedAt: string; executionUnitId: string;
  collectorId: string; hash: string; receiptStatus: ReceiptStatus; receiptIssue: string | null;
};
type HistoryPayload = { markings: HistoryItem[]; truncated: boolean };
type MarkingPayload = {
  status: "recorded" | "replayed"; receiptId: string; receiptStatus: ReceiptStatus; receiptIssue: string | null;
  marking: { nsr: number; markedAt: string; executionUnitId: string };
};
type HistoryView = "today" | "day" | "period";
type RequestOptions = Omit<Parameters<typeof authenticatedApiRequest>[1], "getIdToken">;

/** Data civil local do aparelho; o servidor recusa se divergir da hora oficial do estabelecimento. */
function localDate(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function brDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}
/** O instante fiscal já vem no fuso do estabelecimento (AAAA-MM-DDThh:mm:00±hhmm). */
function fiscalTime(markedAt: string) {
  return markedAt.slice(11, 16);
}
function newAttemptId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Relógio digital com segundos exigido no coletor (Anexo IX, item 3), na hora oficial do estabelecimento. */
function OfficialClockDisplay({ clock }: { clock: OfficialClock | null }) {
  const [now, setNow] = useState(() => Date.now());
  const offset = useMemo(() => clock?.available ? officialClockOffsetMs(clock.instant, Date.now()) : 0, [clock]);
  useEffect(() => {
    if (!clock?.available) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [clock]);
  if (!clock) return null;
  if (!clock.available) {
    return <p className="text-sm font-semibold text-ds-warn">Hora oficial indisponível: o registro de ponto está temporariamente bloqueado.</p>;
  }
  return (
    <p className="text-ds-ink" aria-live="off">
      <span className="block text-xs font-bold text-ds-ink-muted">Hora oficial (Hora Legal Brasileira)</span>
      <strong className="font-ds-mono text-3xl tabular-nums">{formatOfficialClock(now + offset, clock.timeZone)}</strong>
    </p>
  );
}

function ReceiptPill({ status }: { status: ReceiptStatus }) {
  return status === "available"
    ? <StatusPill variant="ok">Comprovante disponível</StatusPill>
    : <StatusPill variant="warn">Comprovante pendente</StatusPill>;
}

export function MyTimeRecordingPage() {
  const { firebaseUser, permissions } = useAuth();
  const canView = permissions.dashboard.collaborator ?? permissions.dashboard.view;
  const today = useMemo(() => localDate(), []);
  const request = useCallback(<T,>(input: string, init: RequestOptions) => authenticatedApiRequest<T>(input, {
    ...init, getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null),
  }), [firebaseUser]);

  const [options, setOptions] = useState<OptionsPayload | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [unitId, setUnitId] = useState("");
  // A mesma tentativa é reenviada até haver resposta; o servidor devolve a batida já gravada sem duplicar.
  const [attemptId, setAttemptId] = useState(newAttemptId);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [lastMarking, setLastMarking] = useState<MarkingPayload | null>(null);

  const [view, setView] = useState<HistoryView>("today");
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
  const unitNames = useMemo(() => new Map(options?.executionUnits.map((unit) => [unit.id, unit.name]) ?? []), [options]);

  useEffect(() => {
    if (!firebaseUser) return;
    request<OptionsPayload>(`/api/dp/time-recording/options?workDate=${today}`, { fallbackError: "Não foi possível carregar as unidades." })
      .then((payload) => {
        setOptions(payload);
        setUnitId((current) => current || payload.executionUnits[0]?.id || "");
      })
      .catch((error) => setOptionsError(errorMessageOf(error, "Não foi possível carregar as unidades.")));
  }, [firebaseUser, request, today]);

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

  async function recordMarking() {
    if (!unitId) return;
    setRecording(true);
    setRecordError(null);
    try {
      const result = await request<MarkingPayload>("/api/dp/time-recording/markings", {
        method: "POST", json: { attemptId, workDate: localDate(), executionUnitId: unitId, channel: "browser" },
        fallbackError: "Não foi possível registrar o ponto.",
      });
      setLastMarking(result);
      setAttemptId(newAttemptId());
      if (view === "today") void loadHistory();
    } catch (error) {
      setRecordError(errorMessageOf(error, "Não foi possível registrar o ponto."));
    } finally {
      setRecording(false);
    }
  }

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

  async function fetchReceipt(receiptId: string, nsr: number, markedAt: string) {
    const blob = await request<Blob>(`/api/dp/time-recording/receipts/${receiptId}`,
      { responseType: "blob", fallbackError: "Não foi possível abrir o comprovante." });
    return new File([blob], `comprovante-ponto-${markedAt.slice(0, 10)}-nsr-${nsr}.pdf`, { type: "application/pdf" });
  }

  async function openReceipt(item: Pick<HistoryItem, "receiptId" | "nsr" | "markedAt">) {
    setBusyReceipt(item.receiptId);
    setReceiptError(null);
    try {
      const file = await fetchReceipt(item.receiptId, item.nsr, item.markedAt);
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
      <h1 className="text-2xl font-black tracking-tight text-ds-ink">Meu ponto</h1>

      <section className="space-y-4 rounded-ds-card border border-ds-border bg-ds-surface p-5" aria-labelledby="record-title">
        <h2 id="record-title" className="text-base font-extrabold text-ds-ink">Registrar ponto</h2>
        {optionsError ? <p role="alert" className="text-sm font-semibold text-ds-danger">{optionsError}</p> : null}
        {!options && !optionsError ? (
          <p className="flex items-center gap-2 text-sm text-ds-ink-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando unidades…</p>
        ) : null}
        {options && !noUnits ? <OfficialClockDisplay clock={options.officialClock} /> : null}
        {noUnits ? (
          <p className="text-sm text-ds-ink-muted">
            Seu vínculo de hoje não está habilitado para registro de ponto. Procure o DP se isso estiver errado.
          </p>
        ) : null}
        {options && !noUnits ? (
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            {options.executionUnits.length > 1 ? (
              <PanelSelectField id="execution-unit" label="Unidade onde você está trabalhando" value={unitId}
                onChange={(next) => { setUnitId(next); setAttemptId(newAttemptId()); }}
                options={options.executionUnits} />
            ) : (
              <p className="text-sm text-ds-ink-2">Unidade: <strong>{options.executionUnits[0]?.name}</strong></p>
            )}
            <Button type="button" variant="primary-page" size="xl" loading={recording} loadingLabel="Registrando…"
              disabled={!unitId || options.officialClock?.available !== true} onClick={recordMarking}>
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
                <div className="space-y-1">
                  <p className="text-sm text-ds-ink">
                    <strong className="font-ds-mono text-base">{fiscalTime(item.markedAt)}</strong>
                    <span className="text-ds-ink-muted"> · {brDate(item.markedAt)} · NSR {item.nsr}</span>
                  </p>
                  <p className="text-xs text-ds-ink-muted">{unitNames.get(item.executionUnitId) ?? "Unidade do registro"}</p>
                  <ReceiptPill status={item.receiptStatus} />
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
