"use client";

import { useCallback, useEffect, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

type PackageState = {
  closure: { status: "open" | "closed"; version: number } | null;
  payslip: { documentId: string; name: string } | null;
  email: boolean;
  package: { status: "sending" | "sent" | "signed" | "refused" | "failed" | "treated"; sentAt: string | null; signedAt: string | null; lastError: string | null; viewedAt?: string | null } | null;
};
const STATUS: Record<NonNullable<PackageState["package"]>["status"], { label: string; variant: "ok" | "warn" | "danger" | "neutral" }> = {
  sending: { label: "Enviando", variant: "neutral" },
  sent: { label: "Aguardando assinatura", variant: "warn" },
  signed: { label: "Assinado", variant: "ok" },
  refused: { label: "Recusado", variant: "danger" },
  failed: { label: "Falha no envio", variant: "danger" },
  treated: { label: "Tratado pelo DP", variant: "neutral" },
};
// Prazo da assinatura: 24 horas depois do envio (decisão do programador).
const DEADLINE_MS = 24 * 60 * 60_000;
const whenBR = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)} às ${value.slice(11, 16)}`;

/**
 * Pacote do fechamento da pessoa: espelho de ponto e contracheque do mês num único PDF, assinado pela empresa (e-CNPJ)
 * e enviado à Autentique para a assinatura do trabalhador. Mostra o que falta (contracheque, e-mail) e a situação.
 */
export function ClosingPackageCard({ firebaseUser, competence, employeeUid, onChanged }: { firebaseUser: FirebaseUser | null; competence: string; employeeUid: string; onChanged?: () => void }) {
  const [state, setState] = useState<PackageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [treating, setTreating] = useState(false);
  const [reason, setReason] = useState("");
  const request = useCallback(<T,>(input: string, init: { method?: string; json?: unknown; fallbackError: string }) =>
    authenticatedApiRequest<T>(input, { ...init, getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null) }), [firebaseUser]);
  const load = useCallback(async () => {
    setError(null);
    try { setState(await request<PackageState>(`/api/dp/time-recording/closing-packages?competence=${competence}&employeeUid=${encodeURIComponent(employeeUid)}`, { fallbackError: "Não foi possível ler o pacote." })); }
    catch (cause) { setError(errorMessageOf(cause, "Não foi possível ler o pacote.")); }
  }, [competence, employeeUid, request]);
  useEffect(() => { void load(); }, [load]);

  async function treat() {
    if (!state?.closure) return;
    setBusy(true);
    setError(null);
    try {
      await request("/api/dp/time-recording/closing-packages", { method: "POST", json: { action: "treat", competence, expectedVersion: state.closure.version, employeeUid, reason },
        fallbackError: "Não foi possível registrar o tratamento." });
      setTreating(false);
      setReason("");
      await load();
      onChanged?.();
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível registrar o tratamento."));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!state?.closure) return;
    setBusy(true);
    setError(null);
    try {
      await request("/api/dp/time-recording/closing-packages", { method: "POST", json: { action: "send", competence, expectedVersion: state.closure.version, employeeUid },
        fallbackError: "Não foi possível enviar o pacote." });
      setConfirming(false);
      await load();
      onChanged?.();
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível enviar o pacote."));
    } finally {
      setBusy(false);
    }
  }

  if (!state) return error ? <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p> : null;
  if (state.closure?.status !== "closed") return null;
  const status = state.package ? STATUS[state.package.status] : null;
  const overdue = state.package?.status === "refused" || (state.package?.status === "sent" && Boolean(state.package.sentAt) && Date.now() - Date.parse(state.package.sentAt!) > DEADLINE_MS);
  const canSend = (!state.package || state.package.status === "failed" || overdue) && state.payslip && state.email;
  const canTreat = overdue || state.package?.status === "failed";
  return (
    <div className="space-y-2 rounded-ds-card border border-ds-border bg-ds-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-extrabold text-ds-ink">Espelho e contracheque para assinatura</p>
        {status ? <StatusPill variant={status.variant}>{status.label}{state.package?.signedAt ? ` em ${whenBR(state.package.signedAt)}` : ""}</StatusPill> : <StatusPill variant="neutral">Não enviado</StatusPill>}
      </div>
      <ul className="space-y-1 text-xs text-ds-ink-muted">
        <li>Espelho: gerado na versão {state.closure.version} do fechamento e assinado pela empresa com o e-CNPJ.</li>
        <li>Contracheque: {state.payslip ? state.payslip.name : <strong className="text-ds-danger">ainda não está nos documentos da pessoa</strong>}.</li>
        {!state.email ? <li><strong className="text-ds-danger">A pessoa não tem e-mail cadastrado.</strong></li> : null}
        {state.package?.sentAt ? <li>Enviado em {whenBR(state.package.sentAt)}{state.package.viewedAt ? ` · aberto pela pessoa em ${whenBR(state.package.viewedAt)}` : " · ainda não aberto pela pessoa"}.</li> : null}
        {state.package?.status === "refused" ? <li><strong className="text-ds-danger">A pessoa recusou a assinatura. Trate a divergência e, se preciso, reabra o mês.</strong></li> : null}
        {overdue && state.package?.status === "sent" ? <li><strong className="text-ds-danger">Sem assinatura há mais de 24 horas: o fechamento do mês só finaliza depois de tratar.</strong></li> : null}
        {state.package?.lastError && state.package.status === "failed" ? <li className="text-ds-danger">{state.package.lastError}</li> : null}
      </ul>
      {error ? <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {canSend && !confirming && !treating ? <Button variant="primary-page" size="sm" onClick={() => setConfirming(true)}>{overdue ? "Reenviar para assinatura" : state.package?.status === "failed" ? "Tentar enviar de novo" : "Enviar para assinatura"}</Button> : null}
        {canTreat && !confirming && !treating ? <Button variant="ds-secondary" size="sm" onClick={() => setTreating(true)}>Dar como tratado</Button> : null}
      </div>
      {treating ? <div className="space-y-2">
        <textarea rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Justificativa do tratamento"
          className="w-full rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2 text-sm text-ds-ink" placeholder="Como foi tratado (ex.: conversa com a pessoa, espelho mantido). Mínimo de 10 caracteres." />
        <div className="flex gap-2">
          <Button variant="ds-secondary" size="sm" loading={busy} loadingLabel="Registrando…" disabled={reason.trim().length < 10} onClick={() => void treat()}>Registrar tratamento</Button>
          <Button variant="ds-ghost" size="sm" disabled={busy} onClick={() => setTreating(false)}>Cancelar</Button>
        </div>
      </div> : null}
      {confirming ? <InlineConfirm message="Enviar o espelho e o contracheque num único documento para a pessoa assinar na Autentique? O envio fica registrado e não é desfeito."
        confirmLabel="Enviar" loadingLabel="Enviando…" loading={busy} onConfirm={() => void send()} onCancel={() => setConfirming(false)} /> : null}
    </div>
  );
}
