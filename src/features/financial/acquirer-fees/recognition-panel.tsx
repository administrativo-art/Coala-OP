"use client";
import { useState } from "react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FeeRecognitionPreview } from "./recognition-contracts";
import { centsLabel } from "../receipts-reconciliation/stone-account-format";
import { RecognitionPolicyForm, type FeeConfiguration } from "./recognition-policy-form";
import { RecognitionValues, recognitionStateLabels as states } from "./recognition-values";
export function SaleFeeRecognitionPanel({ mappingId, kioskId, stoneCode, month }: { mappingId: string; kioskId: string; stoneCode: string; month: string }) {
  const api = useAuthenticatedApi();
  const [date, setDate] = useState(`${month}-01`), [source, setSource] = useState<"cards" | "pix">("cards"), [paymentDate, setPaymentDate] = useState("");
  const [preview, setPreview] = useState<FeeRecognitionPreview | null>(null), [center, setCenter] = useState(""), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [configuration, setConfiguration] = useState<FeeConfiguration | null>(null);
  const [candidateGroups, setCandidateGroups] = useState<Record<string, Array<{ id: string; fingerprint: string }>>>({});
  const [confirmed, setConfirmed] = useState(false);
  const request = { mappingId, kioskId, stoneCode, referenceDate: date, source };
  const run = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(""); setMessage(""); try { await work(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível concluir."); } finally { setBusy(false); } };
  const load = async () => { const next = await api<FeeRecognitionPreview>("/api/financial/acquirer-fees", { method: "POST", json: { action: "preview_sales", request } }); setPreview(next); if (next.centers.length === 1) setCenter(next.centers[0].id); };
  const post = (action: Record<string, unknown>) => run(async () => { const result = await api<{ pending?: string[] }>("/api/financial/acquirer-fees", { method: "POST", json: { request, ...action } }); await load(); setMessage(result.pending?.length ? result.pending.join(" ") : "Apuração atualizada. Nenhum boleto ou pagamento bancário foi criado."); });
  const current = preview && preview.request.mappingId === mappingId && preview.request.kioskId === kioskId && preview.request.stoneCode === stoneCode && preview.request.referenceDate === date && preview.request.source === source;
  return <section className="space-y-3 rounded-ds-card border border-ds-border bg-ds-surface p-4" aria-label="Taxas por venda conciliada">
    <h2 className="text-base font-bold">Taxas por venda conciliada</h2>
    <p className="text-sm text-ds-ink-muted">Apure a taxa na competência da venda, sem aguardar o repasse. O líquido previsto é a receber. A liquidação exige evento da adquirente; a confirmação no extrato bancário continua separada. Espécie permanece no fechamento.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm">Data da venda<Input type="date" min={`${month}-01`} max={`${month}-31`} value={date} onChange={e => { setDate(e.target.value); setPreview(null); }} /></label>
      <label className="grid gap-1 text-sm">Meio<select className="rounded border p-2" value={source} onChange={e => { setSource(e.target.value as "cards" | "pix"); setPreview(null); }}><option value="cards">Cartão</option><option value="pix">PIX Stone</option></select></label>
      <Button disabled={busy || !date.startsWith(month)} onClick={() => void run(load)}>Conferir prévia</Button>
      <Button variant="ds-secondary" disabled={busy} onClick={() => void run(async () => { const next = await api<FeeConfiguration>(`/api/financial/acquirer-fees?${new URLSearchParams({ ...request, view: "configuration" })}`); setConfiguration(next);; })}>Configurar apuração</Button>
    </div>
    {configuration ? <RecognitionPolicyForm key={configuration.policy?.version??0} configuration={configuration} busy={busy} onSave={policy=>void run(async()=>{if(reason.trim().length<3)throw new Error("Informe o motivo (mínimo3 caracteres).");await api("/api/financial/acquirer-fees",{method:"POST",json:{action:"save_policy",request,policy,expectedVersion:configuration.policy?.version??0,reason}});setConfiguration(null);await load();setMessage("Configuração salva; histórico preservado.");})} /> : null}
    <label className="grid gap-1 text-sm">Motivo para revisão, configuração ou estorno<Textarea value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
    {current ? <><p className="text-sm font-semibold">{preview.sourceStatus}</p>{preview.pending.length ? <ul className="space-y-1 text-sm text-ds-alert-ink">{preview.pending.map(p => <li key={p}>{p}</li>)}</ul> : null}
      <label className="grid gap-1 text-sm">Centro exclusivo da unidade<select className="rounded border p-2" value={center} onChange={e => setCenter(e.target.value)}><option value="">Selecione</option>{preview.centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Conferi que não há despesa manual equivalente sem vínculo.</label>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Taxa / situação</th><th>Bruto</th><th>Taxa</th><th>Líquido previsto / liquidado</th><th>Vencimento</th><th>Ação</th></tr></thead><tbody>{preview.batches.map(batch => { const existing = preview.records.find(r => r.id === batch.id); return <tr key={batch.id}><RecognitionValues capture={batch} record={existing} /><td><Button size="xs" disabled={busy || !center || !confirmed || Boolean(existing && reason.trim().length < 3)} onClick={() => void post({ action: existing ? "revise_sale" : "recognize_sale", batchId: batch.id, fingerprint: batch.fingerprint, resultCenterId: center, expectedRevision: existing?.revision ?? 0, confirmedNoManualExpense: true, ...(reason.trim() ? { reason } : {}) })}>{existing ? "Revisar" : "Reconhecer"}</Button>{!existing ? <><Button size="xs" variant="ds-secondary" disabled={busy || !center} onClick={() => void run(async () => { const found = await api<{ candidates: Array<{ id: string; fingerprint: string }> }>("/api/financial/acquirer-fees", { method: "POST", json: { action: "candidates_sale", request, batchId: batch.id, fingerprint: batch.fingerprint, resultCenterId: center } }); setCandidateGroups(old => ({ ...old, [batch.id]: found.candidates })); if (!found.candidates.length) setMessage("Nenhuma despesa manual elegível nesta classificação e competência."); })}>Procurar despesa manual</Button>{candidateGroups[batch.id]?.map(candidate => <Button key={candidate.id} size="xs" disabled={busy || !confirmed || !center} onClick={() => void post({ action: "link_sale", batchId: batch.id, fingerprint: batch.fingerprint, resultCenterId: center, expectedRevision: 0, confirmedNoManualExpense: true, expenseId: candidate.id, expenseFingerprint: candidate.fingerprint, ...(reason.trim() ? { reason } : {}) })}>Vincular {candidate.id}</Button>)}</> : null}</td></tr>; })}</tbody></table></div>
      {!preview.batches.length ? <p className="text-sm">Nenhum componente elegível nesta prévia. Pendência não significa taxa zero.</p> : null}
      {preview.records.length ? <div className="space-y-2"><h3 className="font-semibold">Histórico por origem</h3>{preview.records.map(r => <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm"><span>{r.batch.kind.toUpperCase()} · {centsLabel(r.batch.amountCents)} · {states[r.state]} · revisão {r.revision}</span><Button size="xs" variant="ds-secondary" disabled={busy || !r.active || reason.trim().length < 3} onClick={() => void post({ action: "reverse_sale", batchId: r.id, expectedRevision: r.revision, reason })}>Reverter com motivo</Button></div>)}</div> : null}
      {source === "cards" ? <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm">Data do pagamento na adquirente<Input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} /></label><Button disabled={busy || !paymentDate} onClick={() => void post({ action: "settle_sales", paymentDate, ...(reason.trim() ? { reason } : {}) })}>Conferir liquidação e diferenças</Button></div> : null}
    </> : null}
    {busy ? <p role="status">Conferindo fontes…</p> : null}{error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : null}{message ? <p role="status" className="text-sm">{message}</p> : null}
  </section>;
}
