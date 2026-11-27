"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { alertLabels, type ReviewableAlert } from "./closure-alerts";

type Review = { expectedVersion: number; alerts: ReviewableAlert[]; pendingOutsideScope: number };

export function ClosureAlertsPanel({ firebaseUser, competence, expectedVersion, closed, nameOf, busy, onClose, onCancel, onReleased }: {
  firebaseUser: User | null; competence: string; expectedVersion: number; closed: boolean;
  nameOf: (uid: string) => string; busy: boolean; onClose: () => Promise<void>; onCancel: () => void; onReleased?: () => void;
}) {
  const [result, setResult] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const getIdToken = useCallback(() => firebaseUser?.getIdToken() ?? Promise.resolve(null), [firebaseUser]);
  useEffect(() => {
    let active = true;
    authenticatedApiRequest<Review>(`/api/dp/time-recording/closures?competence=${competence}&alerts=1`, { getIdToken })
      .then((value) => {
        if (!active) return;
        if (value.expectedVersion !== expectedVersion) throw new Error("A versão mudou. Reabra a tela da competência.");
        setResult(value);
      }).catch((cause) => { if (active) setError(errorMessageOf(cause, "Falha ao conferir os alertas.")); });
    return () => { active = false; };
  }, [competence, expectedVersion, getIdToken, refresh]);

  function reload() { setResult(null); setError(""); setRefresh((value) => value + 1); }
  async function justify(item: ReviewableAlert) {
    setSaving(true); setError("");
    try {
      const decision = await authenticatedApiRequest<NonNullable<ReviewableAlert["decision"]>>("/api/dp/time-recording/closures", {
        method: "POST", getIdToken, json: { action: "justifyAlert", competence, expectedVersion,
          employeeUid: item.employeeUid, fingerprint: item.fingerprint, reason: reasons[item.fingerprint].trim() },
      });
      onReleased?.();
      setResult((current) => current && { ...current, alerts: current.alerts.map((old) => old.fingerprint === item.fingerprint ? { ...old, decision } : old) });
    } catch (cause) { setError(errorMessageOf(cause, "Falha ao justificar o alerta.")); }
    finally { setSaving(false); }
  }
  const pending = result ? result.pendingOutsideScope + result.alerts.filter((item) => !item.decision).length : 0;
  return <section className="space-y-3 rounded-ds-card border border-ds-border p-4" aria-label="Conferência de alertas">
    <h3 className="font-bold">{closed ? "Justificativas aplicadas no fechamento" : "Alertas que impedem o fechamento"}</h3>
    {error ? <p role="alert">{error}</p> : null}
    {!result && !error ? <p role="status">Conferindo a competência…</p> : null}
    {result && !result.alerts.length && !result.pendingOutsideScope ? <p>{closed ? "Nenhuma justificativa no seu escopo." : "Nenhum alerta grave pendente."}</p> : null}
    {result?.alerts.map((item) => <div key={item.fingerprint} className="space-y-2 border-t pt-2">
      <strong>{nameOf(item.employeeUid)} · {item.date.split("-").reverse().join("/")}</strong>
      <p>{item.incidents.map((incident) => alertLabels[incident]).join(" · ")}</p>
      {item.decision ? <p>Liberado por {nameOf(item.decision.by)} em {new Date(item.decision.at).toLocaleString("pt-BR")}. {item.decision.reason}</p>
        : item.canJustify ? <><label className="block text-sm">Justificativa do RH
          <textarea className="block w-full rounded border p-2" maxLength={1000} rows={2} value={reasons[item.fingerprint] ?? ""}
            onChange={(event) => setReasons({ ...reasons, [item.fingerprint]: event.target.value })} /></label>
          <Button variant="ds-secondary" disabled={busy || saving || (reasons[item.fingerprint]?.trim().length ?? 0) < 10} onClick={() => void justify(item)}>Liberar este dia</Button></>
          : <p>Aguardando justificativa de um revisor autorizado.</p>}
    </div>)}
    {result?.pendingOutsideScope ? <p>Há {result.pendingOutsideScope} dia(s) aguardando revisão em outras unidades.</p> : null}
    <div className="flex flex-wrap gap-2">
      {!closed && result ? <Button disabled={busy || saving || pending > 0} onClick={() => void onClose()}>Fechar competência de todas as organizações</Button> : null}
      {error || result ? <Button variant="ds-secondary" disabled={busy || saving} onClick={reload}>Atualizar conferência</Button> : null}
      <Button variant="ds-secondary" disabled={busy || saving} onClick={onCancel}>Voltar</Button>
    </div>
  </section>;
}
