"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import type { User } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { errorMessageOf } from "@/components/patterns/panel-form";
import type { AdjustmentView } from "./types";
import type { DayCorrection, DayCorrectionInput } from "./day-corrections";

export function DayCorrectionsPanel({ firebaseUser, month, employeeUid, workDate, adjustments, onChanged }: {
  firebaseUser: User | null; month: string; employeeUid?: string; workDate?: string;
  adjustments: AdjustmentView[]; onChanged: () => void;
}) {
  const generation = useRef(0);
  const [contextKey, setContextKey] = useState("");
  const key = [firebaseUser?.uid, month, employeeUid, workDate].join("|");
  const [items, setItems] = useState<DayCorrection[]>([]);
  const [selectedAdjustments, setSelectedAdjustments] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const request = useCallback(<T,>(url: string, options = {}) => authenticatedApiRequest<T>(url, {
    getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null), ...options,
  }), [firebaseUser]);
  const load = useCallback(async () => {
    const active = ++generation.current;
    try {
      const result = await request<{ items: DayCorrection[] }>(`/api/dp/time-recording/day-corrections?month=${month}${employeeUid ? "&employeeUid=" + employeeUid : ""}`);
      if (active !== generation.current) return;
      setContextKey(key);
      setItems(result.items);
      setLoaded(true);
      setError("");
    } catch (cause) { if (active === generation.current) setError(errorMessageOf(cause, "Não foi possível consultar os dias devolvidos.")); }
  }, [request, month, employeeUid, key]);
  useEffect(() => {
    setItems([]);
    setLoaded(false);
    setReason("");
    setSelectedAdjustments({});
    void load();
    return () => { generation.current++; };
  }, [load]);
  async function act(input: DayCorrectionInput) {
    setBusy(true);
    try {
      await request("/api/dp/time-recording/day-corrections", { method: "POST", body: JSON.stringify(input) });
      setReason("");
      await load();
      onChanged();
    } catch (cause) { setError(errorMessageOf(cause, "Não foi possível registrar a ação.")); }
    finally { setBusy(false); }
  }
  const visible = (contextKey === key ? items : []).filter((item) => !workDate || item.workDate === workDate);
  const open = visible.some((item) => item.status !== "resolved");
  const loadedForContext = loaded && contextKey === key;
  if (!loadedForContext) return <section aria-label="Dias devolvidos para correção">
    {error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : <p role="status">Consultando devoluções…</p>}
  </section>;
  if (!visible.length && !employeeUid) return null;
  return <section className="space-y-3 rounded-ds-md border border-ds-border bg-ds-surface p-3" aria-label="Dias devolvidos para correção">
    <h3 className="text-sm font-bold">Dias devolvidos para correção</h3>
    {error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : null}
    {!loaded && !error ? <p role="status">Consultando devoluções…</p> : null}
    {visible.map((item) => {
      const related = adjustments.filter((adjustment) => adjustment.workDate === item.workDate && adjustment.scope !== "pilot");
      const adjustment = related.find((entry) => entry.id === selectedAdjustments[item.id]);
      return <div key={item.id} className="space-y-2 border-t border-ds-border pt-2 text-sm">
        <p><strong>{item.workDate.split("-").reverse().join("/")}</strong> · {item.status === "requested" ? "Aguardando colaborador" : item.status === "responded" ? "Aguardando decisão do RH" : "Concluído pelo RH"}</p>
        <p>{item.reason}</p>
        {item.response ? <p>Resposta do colaborador · {item.response}</p> : null}
        {!employeeUid && item.status === "requested" ? <>
          <p>Se precisar corrigir horários, envie primeiro o pedido em “Pedir ajuste”. Depois registre sua resposta aqui.</p>
          <label className="block">Pedido de ajuste relacionado
            <select className="ml-2 rounded border p-1" value={selectedAdjustments[item.id] ?? ""} onChange={(event) => setSelectedAdjustments((current) => ({ ...current, [item.id]: event.target.value }))}>
              <option value="">Somente justificativa</option>
              {related.map((entry) => <option key={entry.id} value={entry.id}>{entry.createdAt ? new Date(entry.createdAt).toLocaleString("pt-BR") : entry.id} · {entry.status}</option>)}
            </select>
          </label>
          <Button variant="ds-secondary" size="sm" disabled={busy || reason.trim().length < 10}
            onClick={() => void act({ action: "respond", id: item.id, expectedVersion: item.version, reason, ...(adjustment ? { adjustmentId: adjustment.id } : {}) })}>
            {adjustment ? "Enviar resposta com ajuste" : "Enviar justificativa ao RH"}
          </Button>
        </> : null}
        {employeeUid && item.status === "responded" ? <div className="flex flex-wrap gap-2">
          <Button variant="ds-secondary" size="sm" disabled={busy || reason.trim().length < 10}
            onClick={() => void act({ action: "accept", id: item.id, expectedVersion: item.version, reason })}>Concluir conferência</Button>
          <Button variant="ds-secondary" size="sm" disabled={busy || reason.trim().length < 10}
            onClick={() => void act({ action: "return", id: item.id, expectedVersion: item.version, reason })}>Pedir nova correção</Button>
        </div> : null}
        {employeeUid && item.status !== "resolved" ? <Button variant="ds-secondary" size="sm" disabled={busy || reason.trim().length < 10}
          onClick={() => confirmCancel === item.id ? void act({ action: "cancel", id: item.id, expectedVersion: item.version, reason }) : setConfirmCancel(item.id)}>
          {confirmCancel === item.id ? "Confirmar encerramento com justificativa" : "Encerrar devolução com justificativa"}
        </Button> : null}
        <details><summary className="cursor-pointer">Histórico recente</summary>
          {item.history.map((entry, index) => <p key={index} className="mt-1">{new Date(entry.at).toLocaleString("pt-BR")} · {entry.action === "respond" ? "Resposta" : entry.action === "accept" ? "Conferência" : entry.action === "cancel" ? "Encerramento justificado" : "Devolução"} · {entry.reason}{entry.adjustmentId ? " · Ajuste " + entry.adjustmentId : ""}</p>)}
        </details>
      </div>;
    })}
    {employeeUid && workDate && loaded && !open ? <>
      <p className="text-sm">Informe ao colaborador o que precisa justificar ou corrigir neste dia.</p>
      <Button variant="ds-secondary" size="sm" disabled={busy || reason.trim().length < 10}
        onClick={() => void act({ action: "request", employeeUid, workDate, reason })}>Devolver dia ao colaborador</Button>
    </> : null}
    {(!employeeUid && open || employeeUid && workDate) ? <label className="block text-sm">Justificativa ou orientação
      <Textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} disabled={busy} />
    </label> : null}
  </section>;
}

export function DayCorrectionBatch({ firebaseUser, employeeUid, dates, onChanged }: {
  firebaseUser: User | null; employeeUid: string; dates: string[]; onChanged: () => void;
}) {
  const [reason, setReason] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  if (!dates.length) return null;
  async function send() {
    setBusy(true);
    let sent = 0;
    const failures: string[] = [];
    for (const workDate of dates) {
      try {
        await authenticatedApiRequest("/api/dp/time-recording/day-corrections", {
          getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null),
          method: "POST", body: JSON.stringify({ action: "request", employeeUid, workDate, reason }),
        });
        sent++;
      } catch (cause) {
        failures.push(workDate.split("-").reverse().join("/") + " · " + errorMessageOf(cause, "Falha ao devolver."));
      }
    }
    setResult(sent + " dia(s) devolvido(s)." + (failures.length ? "\n" + failures.join("\n") : ""));
    setBusy(false);
    onChanged();
  }
  return <section className="space-y-2 rounded-ds-md border border-ds-border p-3">
    <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => setExpanded(!expanded)}>
      Devolver dias com alerta grave
    </Button>
    {expanded ? <>
      <p className="text-sm">A mesma orientação será enviada para {dates.length} dia(s) desta pessoa.</p>
      <label className="block text-sm">Orientação ao colaborador
        <Textarea maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} />
      </label>
      <Button variant="ds-secondary" disabled={busy || reason.trim().length < 10} onClick={() => void send()}>
        {busy ? "Devolvendo…" : "Confirmar devolução dos dias"}
      </Button>
    </> : null}
    {result ? <p role="status" className="whitespace-pre-line text-sm">{result}</p> : null}
  </section>;
}
