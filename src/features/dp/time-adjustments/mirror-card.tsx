"use client";

import { useCallback, useEffect, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { saveFile } from "@/features/dp/rep-p/marking-ui";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

type MirrorState = {
  closure: { status: "open" | "closed"; version: number } | null;
  mirror: { snapshotHash: string; generatedAt: string; agreement: { at: string } | null } | null;
};
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const whenBR = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)} às ${value.slice(11, 16)}`;

/**
 * Espelho do mês fechado: abrir (gera uma vez, na primeira abertura) e, para o próprio titular, concordar.
 * Sem fechamento não aparece nada; no painel do DP (`employeeUid`) só abre e mostra a situação da concordância.
 */
export function MirrorCard({ firebaseUser, competence, employeeUid }: { firebaseUser: FirebaseUser | null; competence: string; employeeUid?: string }) {
  const [state, setState] = useState<MirrorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const own = !employeeUid;
  const query = `competence=${competence}${employeeUid ? `&employeeUid=${encodeURIComponent(employeeUid)}` : ""}`;
  const request = useCallback(<T,>(input: string, init: { method?: string; json?: unknown; responseType?: "blob"; fallbackError: string }) =>
    authenticatedApiRequest<T>(input, { ...init, getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null) }), [firebaseUser]);

  const load = useCallback(async () => {
    setError(null);
    try { setState(await request<MirrorState>(`/api/dp/time-recording/mirrors?${query}`, { fallbackError: "Não foi possível ler o espelho." })); }
    catch (cause) { setError(errorMessageOf(cause, "Não foi possível ler o espelho.")); }
  }, [query, request]);
  useEffect(() => { void load(); }, [load]);

  async function open() {
    if (!state?.closure) return;
    setBusy(true);
    setError(null);
    try {
      if (!state.mirror) {
        await request("/api/dp/time-recording/mirrors", { method: "POST", json: { action: "generate", competence, expectedVersion: state.closure.version, ...(employeeUid ? { employeeUid } : {}) },
          fallbackError: "Não foi possível gerar o espelho." });
      }
      const blob = await request<Blob>(`/api/dp/time-recording/mirrors/pdf?${query}`, { responseType: "blob", fallbackError: "Não foi possível abrir o espelho." });
      saveFile(new File([blob], `espelho-ponto-${competence}-v${state.closure.version}.pdf`, { type: "application/pdf" }));
      await load();
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível abrir o espelho."));
    } finally {
      setBusy(false);
    }
  }
  async function agree() {
    if (!state?.closure || !state.mirror) return;
    setBusy(true);
    setError(null);
    try {
      await request("/api/dp/time-recording/mirrors", { method: "POST", json: { action: "agree", competence, expectedVersion: state.closure.version, snapshotHash: state.mirror.snapshotHash },
        fallbackError: "Não foi possível registrar a concordância." });
      setConfirming(false);
      await load();
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível registrar a concordância."));
    } finally {
      setBusy(false);
    }
  }

  if (!state?.closure || state.closure.status !== "closed") return error ? <p role="alert" className="text-xs text-ds-danger">{error}</p> : null;
  const closure = state.closure;
  const [year, month] = competence.split("-").map(Number);
  const agreement = state.mirror?.agreement ?? null;
  return (
    <div className="space-y-2 rounded-ds-card border border-ds-border bg-ds-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-extrabold text-ds-ink">Espelho de {MONTHS[month - 1]} de {year}</p>
        {agreement ? <StatusPill variant="ok">Concordou em {whenBR(agreement.at)}</StatusPill>
          : state.mirror ? <StatusPill variant="warn">Concordância pendente</StatusPill> : <StatusPill variant="neutral">Mês fechado</StatusPill>}
      </div>
      <p className="text-xs text-ds-ink-muted">Versão {closure.version} do fechamento: escala, batidas, ajustes e ausências do mês. {own ? "Confira antes de concordar; se discordar, fale com o DP." : ""}</p>
      {error ? <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="ds-secondary" size="sm" loading={busy && !confirming} loadingLabel="Abrindo…" onClick={() => void open()}>Abrir espelho</Button>
        {own && state.mirror && !agreement && !confirming ? <Button variant="primary-page" size="sm" disabled={busy} onClick={() => setConfirming(true)}>Concordo com o espelho</Button> : null}
      </div>
      {confirming ? <InlineConfirm message="Confirmo que conferi este espelho e concordo com ele. A concordância fica registrada com data e hora." confirmLabel="Registrar concordância"
        loadingLabel="Registrando…" loading={busy} onConfirm={() => void agree()} onCancel={() => setConfirming(false)} /> : null}
    </div>
  );
}
