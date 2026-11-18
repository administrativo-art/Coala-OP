"use client";
import { useCallback, useEffect, useState } from "react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { Button } from "@/components/ui/button";
import { centsLabel } from "../receipts-reconciliation/stone-account-format";
import type { AutoMode, AutoRunSummary } from "./auto-recognition";

type AutoState = { mode: AutoMode; lastRun: AutoRunSummary | null; updatedAt: string | null };
const MODE_TEXT: Record<AutoMode, string> = { off: "Desligado", simulation: "Simulação", active: "Ativo" };
const MODE_HELP: Record<AutoMode, string> = {
  off: "Nada roda sozinho. Você reconhece as taxas dia a dia, como antes.",
  simulation: "Todo dia a rotina confere os últimos 3 dias e mostra o que reconheceria, sem lançar nada.",
  active: "Todo dia a rotina reconhece sozinha as taxas apuradas; o que não passa nas conferências fica nas pendências.",
};
const dayLabel = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

export function AutoRecognitionCard({ mappingId, kioskId, stoneCode, month }: { mappingId: string; kioskId: string; stoneCode: string; month: string }) {
  const api = useAuthenticatedApi();
  const [state, setState] = useState<AutoState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useCallback(() => ({ mappingId, kioskId, stoneCode, referenceDate: `${month}-01`, source: "cards" as const }), [mappingId, kioskId, stoneCode, month]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => api<AutoState>(`/api/financial/acquirer-fees?${new URLSearchParams({ ...request(), view: "auto" })}`))
      .then(next => { if (alive) setState(next); })
      .catch(() => { if (alive) setError("Não foi possível ler o modo automático."); });
    return () => { alive = false; };
  }, [api, request]);
  const change = async (mode: "off" | "simulation") => {
    if (busy || state?.mode === mode) return;
    setBusy(true); setError("");
    try {
      const saved = await api<{ mode: AutoMode; updatedAt: string }>("/api/financial/acquirer-fees", { method: "POST", json: { action: "save_auto_mode", request: request(), mode, reason: "Alteração do modo automático pela tela de taxas" } });
      setState(current => ({ lastRun: current?.lastRun ?? null, mode: saved.mode, updatedAt: saved.updatedAt }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível gravar o modo."); }
    finally { setBusy(false); }
  };
  const run = state?.lastRun;
  return <div className="space-y-2 rounded-ds-card border border-ds-border bg-ds-muted p-3" aria-label="Reconhecimento automático">
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="text-sm font-bold">Reconhecimento automático</h3>
      <div className="flex gap-1.5" role="group" aria-label="Modo automático">
        {(["off", "simulation"] as const).map(mode => <Button key={mode} size="xs" variant={state?.mode === mode ? "primary-modal" : "ds-secondary"} disabled={busy || !state} aria-pressed={state?.mode === mode} onClick={() => void change(mode)}>{MODE_TEXT[mode]}</Button>)}
      </div>
      <span className="text-xs text-ds-ink-muted">{state ? MODE_HELP[state.mode] : "Carregando…"}</span>
    </div>
    {run ? <div className="space-y-1 text-sm">
      <p>Última rodada em {new Date(run.at).toLocaleString("pt-BR")}, dias {run.dates.map(dayLabel).join(", ")}: {run.mode === "simulation"
        ? <><b>{run.wouldRecognize}</b> grupo(s) seriam reconhecidos ({centsLabel(run.amountCents)})</>
        : <><b>{run.recognized}</b> grupo(s) reconhecidos ({centsLabel(run.amountCents)})</>}, {run.alreadyDone} já feitos, {run.pending.length}{run.pendingTruncated ? "+" : ""} pendência(s).</p>
      {run.pending.length ? <ul className="max-h-40 space-y-0.5 overflow-auto text-xs text-ds-alert-ink">{run.pending.map((item, index) => <li key={`${item.date}:${item.source}:${index}`}>{dayLabel(item.date)} · {item.source === "pix" ? "PIX" : "Cartão"} — {item.reason}</li>)}</ul> : null}
    </div> : state && state.mode !== "off" ? <p className="text-xs text-ds-ink-muted">Ainda não houve rodada. A primeira acontece na próxima madrugada.</p> : null}
    {error ? <p role="alert" className="text-xs text-ds-danger">{error}</p> : null}
  </div>;
}
