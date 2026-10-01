"use client";
import { useMemo, useState } from "react";
import { query, limit, where } from "firebase/firestore";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { useFinancialCollection } from "../hooks/use-financial-collection";
import { financialCollection } from "../lib/repositories";
import { AccountPlanTreeSelect } from "@/components/purchasing/account-plan-tree-select";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatBRL } from "../cash-closures/money";
import { FEE_LABELS, type FeePreview, type FeeRecordView, type FeeRequest } from "./contracts";

type Account = { id: string; name: string; parentId?: string; active?: boolean; is_dre_account?: boolean };
type Center = { id: string; name: string; active?: boolean; unitIds: string[] };
export function AcquirerFeesPanel({ kioskId, mappingId, stoneCode }: Pick<FeeRequest, "kioskId" | "mappingId" | "stoneCode">) {
  const api = useAuthenticatedApi();
  const [date, setDate] = useState("");
  const [source, setSource] = useState<FeeRequest["source"]>("pix");
  const [preview, setPreview] = useState<FeePreview | null>(null);
  const [history, setHistory] = useState<FeeRecordView[]>([]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"create" | "link">("create");
  const [account, setAccount] = useState("");
  const [center, setCenter] = useState("");
  const [existingId, setExistingId] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [candidates, setCandidates] = useState<Array<{ id: string; description: string; totalValue: number }>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const editing = !!selected;
  const accountQuery = useMemo(() => editing ? query(financialCollection<Account>("accounts"), limit(501)) : null, [editing]);
  const centerQuery = useMemo(() => editing ? query(financialCollection<Center>("resultCenters"), where("unitIds", "array-contains", kioskId), limit(51)) : null, [editing, kioskId]);
  const accounts = useFinancialCollection<Account>(accountQuery), centers = useFinancialCollection<Center>(centerQuery);
  const overflow = (accounts.data?.length ?? 0) > 500 || (centers.data?.length ?? 0) > 50;
  const centerOptions = (centers.data ?? []).filter(row => row.active !== false && row.unitIds.length === 1 && row.unitIds[0] === kioskId);
  const batch = preview?.batches.find(row => row.id === selected);
  const record = history.find(row => row.id === selected);
  const request: FeeRequest = { kioskId, mappingId, stoneCode, referenceDate: date, source };
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (caught) { setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível concluir. Consulte o histórico antes de repetir."); }
    finally { setBusy(false); }
  };
  const reset = () => { setPreview(null); setHistory([]); setSelected(""); setCandidates([]); setCursor(null); setError(""); setMessage(""); };
  const choose = (id: string) => { setSelected(id); setAccount(""); setCenter(""); setReason(""); setConfirmed(false); setExistingId(""); setCandidates([]); setCursor(null); };
  const loadHistory = async () => {
    const result = await api<{ records: FeeRecordView[] }>(`/api/financial/acquirer-fees?${new URLSearchParams(request)}`);
    setHistory(result.records);
  };
  const loadCandidates = (next?: string) => run(async () => {
    if (!batch) return;
    const params = new URLSearchParams({ ...request, referenceDate: batch.competenceDate, resultCenterId: center });
    if (next) params.set("cursor", next);
    const result = await api<{ candidates: typeof candidates; nextCursor: string | null }>(`/api/financial/acquirer-fees?${params}`);
    setCandidates(current => next ? [...current, ...result.candidates] : result.candidates); setCursor(result.nextCursor);
  });
  const save = () => run(async () => {
    const action = record?.active ? { action: "cancel", request, batchId: selected, reason }
      : mode === "link" ? { action: "link", request, batchId: selected, fingerprint: batch?.fingerprint, existingExpenseId: existingId, ...(reason ? { reason } : {}) }
        : { action: "create", request, batchId: selected, fingerprint: batch?.fingerprint, accountPlanId: account, resultCenterId: center, confirmedNoManualExpense: confirmed, ...(reason ? { reason } : {}) };
    await api("/api/financial/acquirer-fees", { method: "POST", json: action });
    await loadHistory(); setSelected(""); setMessage("Registro atualizado. Nenhum pagamento ou débito bancário foi criado.");
  });
  return <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">Taxas praticadas e apropriação</CardTitle><CardDescription>Consulte as retenções explícitas da Stone e, em seguida, confirme cada grupo como despesa quitada na origem. Não haverá outra saída no banco.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-2"><label className="text-sm">Fonte<select className="mt-1 w-full rounded-md border bg-background p-2" value={source} onChange={event => { setSource(event.target.value as FeeRequest["source"]); reset(); }}><option value="pix">Pix — arquivo já processado</option><option value="cards">Cartões e antecipação — arquivo de pagamentos</option></select></label>
        <label className="text-sm">{source === "pix" ? "Dia das vendas Pix" : "Dia do pagamento informado pela Stone"}<Input type="date" value={date} onChange={event => { setDate(event.target.value); reset(); }} /></label></fieldset>
      <p className="text-sm text-muted-foreground">Pix/MDR pertencem ao dia da venda; antecipação, ao dia da retenção. Decimais são somados antes de arredondar. Valores combinados ou sem evidência ficam pendentes. Cada grupo aceita até 100 parcelas.</p>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !date} onClick={() => void run(async () => {
        const data = await api<FeePreview>("/api/financial/acquirer-fees", { method: "POST", json: { action: "preview", request } });
        setPreview(data); setHistory(data.records); setSelected("");
      })}>{busy ? "Consultando…" : "Consultar prévia — sem gravar"}</Button>
        <Button variant="outline" disabled={busy || !date} onClick={() => void run(loadHistory)}>Consultar registros anteriores</Button></div>
      {preview?.pending.map((text, index) => <p key={index} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-950">{text}</p>)}
      {preview && !preview.batches.length && <p role="status">Nenhum grupo elegível neste recorte. Isso não comprova ausência de taxas; confira as pendências.</p>}
      {(preview?.batches ?? []).map(row => {
        const registered = history.find(item => item.id === row.id && item.active);
        return <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div><p className="font-medium">{FEE_LABELS[row.kind]} · {formatBRL(row.amountCents)}</p><p className="text-sm text-muted-foreground">Competência {row.competenceDate} · Retenção {row.settledOn} · {row.members.length} evidência(s) · {registered ? registered.fingerprint === row.fingerprint ? "Já registrado" : "Origem alterada — corrigir" : "A confirmar"}</p></div><Button variant="outline" disabled={busy} onClick={() => choose(row.id)}>{registered ? "Corrigir" : "Classificar e confirmar"}</Button></div>;
      })}
      {history.filter(row => row.active && !preview?.batches.some(batch => batch.id === row.id)).map(row => <div key={row.id} className="rounded-lg border p-3"><p>{FEE_LABELS[row.kind]} · {formatBRL(row.amountCents)} · Registro anterior / fora da prévia atual</p><Button variant="outline" disabled={busy} onClick={() => choose(row.id)}>Corrigir registro anterior</Button></div>)}
      {selected && <fieldset disabled={busy} className="space-y-3 rounded-xl border bg-muted/20 p-4"><legend className="px-1 font-semibold">{record?.active ? "Estornar vínculo com histórico" : "Confirmar despesa quitada na origem"}</legend>
        {record?.active ? <p className="text-sm">Uma despesa criada aqui será cancelada. Uma despesa vinculada voltará ao estado anterior, preservando notas e anexos. Depois consulte novamente para reclassificar.</p> : <>
          <label className="block text-sm">Forma de registro<select className="mt-1 w-full rounded-md border bg-background p-2" value={mode} onChange={event => setMode(event.target.value as "create" | "link")}><option value="create">Criar despesa</option><option value="link">Vincular despesa existente</option></select></label>
          <label className="block text-sm">Centro exclusivo da unidade<select className="mt-1 w-full rounded-md border bg-background p-2" value={center} onChange={event => { setCenter(event.target.value); setCandidates([]); setCursor(null); }}><option value="">Selecione</option>{centerOptions.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          {mode === "create" ? <><label className="block text-sm">Plano de contas<AccountPlanTreeSelect placeholder="Selecione uma conta de despesa" value={account} onChange={setAccount} options={(accounts.data ?? []).filter(row => row.active !== false && row.is_dre_account !== false)} /></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Conferi que esta taxa não foi lançada manualmente. Se já existe, usarei o vínculo.</label></> : <>
            <Button variant="outline" disabled={!center || busy} onClick={() => void loadCandidates()}>Buscar despesas da competência e centro</Button>
            <label className="block text-sm">ID da despesa existente<Input value={existingId} onChange={event => setExistingId(event.target.value)} placeholder="Cole o ID ou selecione abaixo" /></label>
            {candidates.map(row => <Button key={row.id} variant="outline" className="mr-2 max-w-full whitespace-normal" onClick={() => setExistingId(row.id)}>{row.description} · {formatBRL(Math.round(row.totalValue * 100))}</Button>)}
            {cursor && <Button variant="outline" onClick={() => void loadCandidates(cursor)}>Próxima página de despesas</Button>}
            <p className="text-sm text-muted-foreground">Somente despesa avulsa em aberto, mesmo valor e competência, sem outro pagamento. O servidor confere novamente.</p>
          </>}
        </>}
        <label className="block text-sm">Motivo (obrigatório para correção/reclassificação)<Textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
        <Button disabled={busy || (record?.active ? reason.trim().length < 3 : !batch || overflow || !!accounts.error || !!centers.error || mode === "create" && (!account || !center || !confirmed) || mode === "link" && !existingId)} onClick={() => void save()}>{record?.active ? "Confirmar estorno do vínculo" : "Confirmar — sem novo pagamento"}</Button>
        <Button variant="ghost" onClick={() => setSelected("")}>Fechar edição</Button>
      </fieldset>}
      {overflow && <p role="alert">Catálogo acima do limite. Nenhum lançamento será feito; revise os cadastros.</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}{message && <p role="status">{message}</p>}
    </CardContent></Card>;
}
