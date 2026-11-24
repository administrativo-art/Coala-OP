"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { StatusPill } from "@/components/ui/status-pill";
import { authenticatedApiRequest, type AuthenticatedApiRequestInit } from "@/lib/authenticated-api-client";
import { saveFile } from "@/features/dp/rep-p/marking-ui";
import type { PayslipComparison, ReconciliationKind, ReconciliationLine, ReconciliationPreviewInput } from "./payslip-reconciliation";
import type { readPayslipReconciliation, previewPayslipReconciliation } from "./payslip-reconciliation.server";

type State = Awaited<ReturnType<typeof readPayslipReconciliation>>;
type Preview = Awaited<ReturnType<typeof previewPayslipReconciliation>>;
const endpoint = "/api/dp/time-recording/payslip-reconciliation";
const kinds: ReconciliationKind[] = ["overtime", "discount", "expired_credit", "bank_payroll"];
const label: Record<ReconciliationKind, string> = { overtime: "Horas extras na folha", discount: "Tempo para desconto", expired_credit: "Créditos vencidos para folha", bank_payroll: "Banco encaminhado à folha" };
const field = "h-10 w-full rounded-md border border-ds-border bg-ds-surface px-3 text-sm";
function lineText(line: ReconciliationLine | null) {
  return line ? `${label[line.kind]}${line.kind === "overtime" ? ` · ${line.ratePercent.toLocaleString("pt-BR")}%` : ""} · ${line.quantity} min` : "Não consta";
}
function Comparison({ value }: { value: PayslipComparison }) {
  return <div className="space-y-3">
    <StatusPill variant={value.status === "match" ? "ok" : "danger"}>{value.status === "match" ? "Quantidades conferidas" : "Divergência no retorno"}</StatusPill>
    <div className="grid gap-3 sm:grid-cols-2">{([['Esperado na entrega', value.expected], ['Informado no retorno', value.actual]] as const).map(([title, lines]) => <div key={title} className="space-y-1 text-sm"><h4 className="font-bold">{title}</h4>{lines.length ? lines.map((line, index) => <p key={index}>{lineText(line)}</p>) : <p>Sem rubrica neste escopo.</p>}</div>)}</div>
    {value.differences.length ? <ul className="space-y-2 text-sm text-ds-danger">{value.differences.map((difference, index) => <li key={index}>{difference.code === "rate" ? "Percentual diferente" : difference.code === "quantity" ? "Quantidade diferente" : difference.code === "missing" ? "Rubrica ausente" : "Rubrica inesperada"}: {lineText(difference.expected)} → {lineText(difference.actual)}</li>)}</ul> : null}
    <p className="text-xs text-ds-ink-muted">Referências do ponto: {value.references.unjustifiedAbsenceDates.length} dias de falta injustificada; {value.references.nightMinutes} minutos noturnos. A conversão dessas referências e a conferência de valores permanecem com o RH e o contador.</p>
  </div>;
}
export function PayslipReconciliationPanel({ firebaseUser, competence, employeeUid, onChanged }: { firebaseUser: User | null; competence: string; employeeUid: string; onChanged?: () => void }) {
  // A mudança de pessoa/competência desmonta todos os dados e operações da consulta anterior.
  return <ReconciliationForm key={`${competence}/${employeeUid}`} {...{ firebaseUser, competence, employeeUid, onChanged }} />;
}
function ReconciliationForm({ firebaseUser, competence, employeeUid, onChanged }: { firebaseUser: User | null; competence: string; employeeUid: string; onChanged?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [releaseId, setReleaseId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [absent, setAbsent] = useState<ReconciliationKind[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [overtime, setOvertime] = useState([{ rate: "", quantity: "" }]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestId = useRef<string | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const request = useCallback(<T,>(input: string, init?: AuthenticatedApiRequestInit) => authenticatedApiRequest<T>(input, { ...init, getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null) }), [firebaseUser]);
  const document = state?.documents.find((item) => item.id === documentId);
  function invalidate() { setPreview(null); setConfirming(false); requestId.current = null; setMessage(""); }
  async function load() {
    setBusy(true); setError(""); invalidate();
    try {
      const result = await request<State>(`${endpoint}?competence=${competence}&employeeUid=${encodeURIComponent(employeeUid)}`);
      if (!active.current) return;
      setState(result);
      setDocumentId(result.documents[0]?.id ?? "");
      const releases = [...result.releases].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setReleaseId(result.current && result.current.status !== "stale" ? result.current.releaseId : releases[0]?.id ?? "");
    } catch (cause) { if (active.current) { setState(null); setError(cause instanceof Error ? cause.message : "Não foi possível consultar a conferência."); } }
    finally { if (active.current) setBusy(false); }
  }
  function input(): ReconciliationPreviewInput {
    if (!document || !releaseId || !acknowledged) throw new Error("Selecione a entrega, o documento e confirme a leitura do retorno.");
    const number = (text: string | undefined) => { if (text === undefined || text.trim() === "" || !/^\d+$/.test(text)) throw new Error("Informe os minutos inteiros ou marque que a rubrica não consta."); return Number(text); };
    const lines: ReconciliationLine[] = kinds.flatMap((kind): ReconciliationLine[] => absent.includes(kind) ? [] : kind === "overtime"
      ? overtime.map((row) => { if (!row.rate.trim() || !/^\d+(?:[.,]\d+)?$/.test(row.rate)) throw new Error("Informe o percentual de cada parcela de hora extra."); return { kind, unit: "minutes", quantity: number(row.quantity), ratePercent: Number(row.rate.replace(",", ".")) }; })
      : [{ kind, unit: "minutes", quantity: number(quantities[kind]) }]);
    return { competence, employeeUid, releaseId, documentId: document.id, documentHash: document.sha256, lines, absentKinds: absent, acknowledgment: true };
  }
  async function compare() {
    setBusy(true); setError(""); invalidate();
    try { const result = await request<Preview>(endpoint, { method: "POST", json: { action: "preview", input: input() } }); if (active.current) { setPreview(result); requestId.current = crypto.randomUUID(); } }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Não foi possível comparar o retorno."); }
    finally { if (active.current) setBusy(false); }
  }
  async function submit() {
    if (!state || !preview || !requestId.current) return;
    setBusy(true); setError("");
    try {
      await request(endpoint, { method: "POST", json: { action: "submit", input: { ...input(), expectedVersion: state.version, requestId: requestId.current } } });
      if (!active.current) return;
      const status = preview.comparison.status;
      await load();
      setMessage(status === "match" ? "Conferência registrada. Os eventos deste escopo correspondem à entrega." : "Divergência registrada. Corrija o retorno ou o fechamento antes de enviar para assinatura.");
      onChanged?.();
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Não foi possível registrar a conferência."); }
    finally { if (active.current) setBusy(false); }
  }
  async function download() {
    if (!document) return;
    setBusy(true); setError("");
    try { const blob = await request<Blob>(endpoint, { method: "POST", responseType: "blob", json: { action: "download", input: { competence, employeeUid, documentId, documentHash: document.sha256 } } }); if (active.current) await saveFile(new File([blob], `contracheque-${competence}.pdf`, { type: "application/pdf" })); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Não foi possível baixar o documento."); }
    finally { if (active.current) setBusy(false); }
  }
  return <section className="space-y-3 border-t border-ds-border pt-3">
    <Button size="sm" variant="ds-secondary" disabled={busy} onClick={() => { setExpanded(!expanded); if (!expanded) void load(); }}>Conferir retorno do contador</Button>
    {expanded ? <div className="space-y-4 rounded-ds-md bg-ds-page p-3">
      <p className="text-sm">Registre as quantidades lidas no contracheque. Esta conferência cobre os eventos de tempo enviados à folha. Salário, tributos e líquido serão conferidos no fluxo financeiro.</p>
      {error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : null}{message ? <p role="status" className="text-sm">{message}</p> : null}
      {busy ? <p role="status" className="text-sm">Conferindo…</p> : null}
      {state ? <>
        {state.current ? <div className="space-y-2 rounded-ds-md border border-ds-border bg-ds-surface p-3"><p className="text-sm font-bold">Última conferência · {new Date(state.current.createdAt).toLocaleString("pt-BR")}</p>{state.current.status === "stale" ? <p className="text-sm text-ds-danger">A fonte mudou. Registre uma nova conferência.</p> : <Comparison value={state.current.comparison} />}</div> : null}
        {!state.releases.length ? <p className="text-sm">Disponibilize primeiro o fechamento deste colaborador em Prestadores de serviço.</p> : null}
        {!state.documents.length ? <p className="text-sm">Cadastre o contracheque retornado nos documentos da pessoa, com a competência correta.</p> : null}
        <label className="block space-y-1 text-sm">Entrega enviada ao contador<span className="relative block"><select aria-label="Entrega enviada ao contador" className={`${field} appearance-none pr-9`} disabled={busy} value={releaseId} onChange={(event) => { invalidate(); setReleaseId(event.target.value); }}><option value="">Selecione a entrega</option>{[...state.releases].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((release) => <option key={release.id} value={release.id}>{release.employerName} · versão {release.closureVersion} · {new Date(release.createdAt).toLocaleString("pt-BR")}</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-3 h-4 w-4" /></span></label>
        <p className="text-sm">Contracheque ativo mais recente: <strong>{document ? `${document.name} · revisão ${document.version}` : "Indisponível"}</strong></p>
        {document ? <Button size="sm" variant="ds-secondary" disabled={busy} onClick={() => void download()}>Baixar contracheque para conferir</Button> : null}
        {kinds.map((kind) => <fieldset key={kind} disabled={busy} className="space-y-2 border-t border-ds-border pt-3"><legend className="pt-3 text-sm font-bold">{label[kind]}</legend>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={absent.includes(kind)} onChange={(event) => { invalidate(); setAbsent(event.target.checked ? [...absent, kind] : absent.filter((item) => item !== kind)); }} />Não consta no retorno</label>
          {!absent.includes(kind) ? kind === "overtime" ? <>{overtime.map((row, index) => <div key={index} className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">Percentual da parcela {index + 1}<input aria-label={`Percentual da parcela ${index + 1}`} className={field} inputMode="decimal" value={row.rate} onChange={(event) => { invalidate(); setOvertime(overtime.map((item, position) => position === index ? { ...item, rate: event.target.value } : item)); }} /></label><label className="min-w-0 flex-1 text-sm">Minutos da parcela {index + 1}<input aria-label={`Minutos da parcela ${index + 1}`} className={field} inputMode="numeric" value={row.quantity} onChange={(event) => { invalidate(); setOvertime(overtime.map((item, position) => position === index ? { ...item, quantity: event.target.value } : item)); }} /></label>{overtime.length > 1 ? <Button size="sm" variant="ds-secondary" onClick={() => { invalidate(); setOvertime(overtime.filter((_, position) => position !== index)); }}>Remover parcela {index + 1}</Button> : null}</div>)}<Button size="sm" variant="ds-secondary" disabled={overtime.length >= 50} onClick={() => { invalidate(); setOvertime([...overtime, { rate: "", quantity: "" }]); }}>Adicionar parcela</Button></> : <label className="block text-sm">Minutos · {label[kind]}<input aria-label={`Minutos · ${label[kind]}`} className={field} inputMode="numeric" value={quantities[kind] ?? ""} onChange={(event) => { invalidate(); setQuantities({ ...quantities, [kind]: event.target.value }); }} /></label> : null}
        </fieldset>)}
        <p className="text-xs text-ds-ink-muted">Exemplo: 8h = 480 minutos; 6h30 = 390 minutos. Se o documento não discrimina uma quantidade necessária, solicite o detalhamento ao contador.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={acknowledged} disabled={busy} onChange={(event) => { invalidate(); setAcknowledged(event.target.checked); }} />Li o documento selecionado e informei todas as parcelas desses quatro tipos, incluindo as que não constam.</label>
        <Button size="sm" variant="ds-secondary" disabled={busy || !document || !releaseId || !acknowledged} onClick={() => void compare()}>Comparar retorno</Button>
        {preview ? <div className="space-y-3 rounded-ds-md border border-ds-border bg-ds-surface p-3"><Comparison value={preview.comparison} />{!confirming ? <Button size="sm" variant="primary-modal" disabled={busy} onClick={() => setConfirming(true)}>Registrar conferência</Button> : <InlineConfirm message="Registrar esta conferência e preservar a anterior no histórico? Divergências continuam bloqueando novos envios para assinatura." confirmLabel="Registrar" loadingLabel="Registrando…" loading={busy} onConfirm={() => void submit()} onCancel={() => setConfirming(false)} />}</div> : null}
        <Button size="sm" variant="ds-secondary" disabled={busy} onClick={() => void load()}>Atualizar documentos e entregas</Button>
      </> : null}
    </div> : null}
  </section>;
}
