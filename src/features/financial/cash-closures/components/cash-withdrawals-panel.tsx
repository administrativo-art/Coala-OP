"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { limit, query, where } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useFinancialCollection } from "../../hooks/use-financial-collection";
import { financialCollection } from "../../lib/repositories";
import { AccountPlanTreeSelect } from "@/components/purchasing/account-plan-tree-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "../money";
import type { CashClosureWithLines } from "../types";
import { isWithdrawalClassifiableAccount } from "../withdrawal-account-policy";
import type { listWithdrawalClassifications, listWithdrawalExpenseCandidates } from "../withdrawal-classification.server";

type Payload = Awaited<ReturnType<typeof listWithdrawalClassifications>>;
type Candidates = Awaited<ReturnType<typeof listWithdrawalExpenseCandidates>>;
type CatalogAccount = { id: string; name: string; parentId?: string; active?: boolean; dre_position?: string; is_dre_account?: boolean; isGroup?: boolean };
type Center = { id: string; name: string; unitIds: string[]; active?: boolean };
const issueCopy: Record<string, string> = {
  unassigned_movements: "Há movimento sem operador. Corrija a origem e sincronize o PDV.",
  movement_total_mismatch: "O detalhamento das sangrias não fecha com o total do PDV.",
  movement_scope_invalid: "Há sangria com data, operador ou valor inválido.",
  duplicate_movement_identity: "O PDV repetiu a identificação de uma sangria.",
  withdrawal_limit: "O fechamento ultrapassa o limite de sangrias para classificação.",
};

/** One bounded request per closure, never one per operator or per keystroke. */
export function CashWithdrawalsPanel({ data, editable, operatorId: operatorScopeId }: { data: CashClosureWithLines; editable: boolean; operatorId?: string }) {
  const { permissions, isDefaultAdmin } = useAuth();
  const api = useAuthenticatedApi();
  const expensePermissions = permissions.financial?.expenses;
  const canView = isDefaultAdmin || !!expensePermissions?.view && !!permissions.financial?.cashClosures?.view;
  const canConfigure = isDefaultAdmin || !!permissions.financial?.cashClosures?.edit && !!expensePermissions?.pay && (!!expensePermissions?.create || !!expensePermissions?.edit);
  const canClassify = editable && canConfigure;
  const canCreate = canClassify && (isDefaultAdmin || !!expensePermissions?.create);
  const canLink = canClassify && (isDefaultAdmin || !!expensePermissions?.edit);
  const path = `/api/financial/cash-closures/${encodeURIComponent(data.closure.id)}/withdrawals`;
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"create" | "link">("create");
  const [account, setAccount] = useState("");
  const [center, setCenter] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [existingId, setExistingId] = useState("");
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [reload, setReload] = useState(0);
  const accountsQuery = useMemo(() => canView && canConfigure ? query(financialCollection<CatalogAccount>("accounts"), limit(501)) : null, [canView, canConfigure]);
  const centersQuery = useMemo(() => canView && canConfigure ? query(financialCollection<Center>("resultCenters"), where("unitIds", "array-contains", data.closure.kioskId), limit(51)) : null, [canView, canConfigure, data.closure.kioskId]);
  const accounts = useFinancialCollection<CatalogAccount>(accountsQuery);
  const centers = useFinancialCollection<Center>(centersQuery);
  const catalogOverflow = (accounts.data?.length ?? 0) > 500 || (centers.data?.length ?? 0) > 50;
  const centerOptions = (centers.data ?? []).filter(row => row.active !== false && row.unitIds.length === 1 && row.unitIds[0] === data.closure.kioskId);
  const accountOptions = useMemo(() => {
    const catalogAccounts = accounts.data ?? [];
    const activeAccounts = catalogAccounts.filter(row => row.active !== false);
    const byId = new Map(activeAccounts.map(row => [row.id, row]));
    const hasChild = new Set(catalogAccounts.flatMap(row => row.parentId ? [row.parentId] : []));
    const classifiableLeaves = activeAccounts.filter(row => isWithdrawalClassifiableAccount(row) && !hasChild.has(row.id));
    const visibleIds = new Set(classifiableLeaves.map(row => row.id));
    classifiableLeaves.forEach(row => {
      let parentId = row.parentId;
      while (parentId) {
        const parent = byId.get(parentId);
        if (!parent || visibleIds.has(parent.id)) break;
        visibleIds.add(parent.id);
        parentId = parent.parentId;
      }
    });
    return activeAccounts.filter(row => visibleIds.has(row.id));
  }, [accounts.data]);
  const refresh = useCallback(() => setReload(value => value + 1), []);
  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(""); setPayload(null); setSelected(null);
    void api<Payload>(path, { signal: controller.signal, fallbackError: "Não foi possível consultar as sangrias." })
      .then(result => { if (!controller.signal.aborted) setPayload(result); })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Falha na consulta."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, path, canView, reload, data.closure.sourceHash]);

  const source = payload?.sources.find(row => row.sourceId === selected && (!operatorScopeId || row.operatorId === operatorScopeId));
  const classification = payload?.classifications.find(row => row.sourceId === selected && (!operatorScopeId || row.operatorId === operatorScopeId));
  const active = classification?.active === true;
  const operatorId = source?.operatorId ?? classification?.operatorId;
  const finalized = data.operators.some(row => row.operatorId === operatorId && row.status === "approved");
  const scopedSources = payload?.sources.filter(row => !operatorScopeId || row.operatorId === operatorScopeId) ?? [];
  const orphaned = payload?.classifications.filter(row => row.active && (!operatorScopeId || row.operatorId === operatorScopeId) && !payload.sources.some(source => source.sourceId === row.sourceId)) ?? [];
  const unresolved = scopedSources.filter(row => !row.identityVerified || !payload?.classifications.some(link => link.active && link.sourceId === row.sourceId && link.fingerprint === row.fingerprint)).length;
  const choose = (id: string) => {
    const selectedSource = scopedSources.find(row => row.sourceId === id);
    setSelected(id); setMode(canCreate ? "create" : "link"); setAccount(""); setCenter(centerOptions.length === 1 ? centerOptions[0].id : "");
    setDescription(selectedSource?.pdvReason ?? ""); setReason(""); setExistingId(""); setCandidates(null); setError("");
  };
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar a classificação."); }
    finally { setBusy(false); }
  };
  const loadCandidates = (cursor?: string) => run(async () => {
    const params = new URLSearchParams({ sourceId: selected!, resultCenterId: center });
    if (cursor) params.set("cursor", cursor);
    const result = await api<Candidates>(`${path}?${params}`);
    setCandidates(current => ({ ...result, candidates: cursor ? [...(current?.candidates ?? []), ...result.candidates] : result.candidates }));
  });
  // The operator already attached the invoice in the app: prefill the link, the closure only confirms it.
  const usePreLink = (preLink: Payload["preLinks"][number]) => {
    setSelected(preLink.sourceId); setMode("link"); setAccount(""); setCenter(preLink.resultCenterId);
    setDescription(""); setReason(""); setExistingId(preLink.expenseId); setCandidates(null); setError("");
  };
  const selectedPreLink = payload?.preLinks.find(row => row.sourceId === selected && row.expenseId === existingId);
  const save = () => run(async () => {
    const common = { sourceId: selected, ...(reason.trim() ? { reason: reason.trim() } : {}) };
    const json = active ? { action: "unlink", ...common }
      : mode === "link" ? { action: "link", ...common, fingerprint: source?.fingerprint, existingExpenseId: existingId }
        : { action: "create", ...common, fingerprint: source?.fingerprint, accountPlanId: account, resultCenterId: center, description };
    await api(path, { method: "PATCH", json });
    setSelected(null); refresh();
  });
  if (!canView) return <p className="text-sm text-muted-foreground">A classificação de sangrias exige acesso às despesas. A finalização continua validando os vínculos no servidor.</p>;
  return <Card className="border-ds-border">
    <CardHeader><CardTitle>Sangrias — despesas pagas em espécie</CardTitle><CardDescription>O PDV já descontou estas saídas do dinheiro esperado. Classifique cada uma ou vincule uma despesa existente; não haverá outro pagamento bancário. O plano de contas mostra folhas ativas de despesa e compras de insumos para estoque.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {loading ? <p role="status">Consultando sangrias…</p> : !payload ? <Button variant="outline" onClick={refresh}>Tentar novamente</Button> : <>
        <p role="status" className="text-sm">{unresolved + orphaned.length} pendência(s) de vínculo. Todas as sangrias {operatorScopeId ? "deste operador" : "do fechamento"} devem estar classificadas para finalizar {operatorScopeId ? "sua contagem" : "a contagem"}.</p>
        {payload.issues.map(issue => <p key={issue} className="text-sm text-destructive">{issueCopy[issue] ?? "A origem da sangria precisa de conferência."}</p>)}
        {!scopedSources.length && !orphaned.length && <p className="text-sm text-muted-foreground">Nenhuma sangria em espécie {operatorScopeId ? "para este operador" : "neste fechamento"}.</p>}
        {[...scopedSources.map(row => ({ ...row, removed: false })), ...orphaned.map(row => ({ ...row, identityVerified: false, removed: true }))].map(row => {
          const link = payload.classifications.find(item => item.sourceId === row.sourceId && item.active);
          const name = data.operators.find(operator => operator.operatorId === row.operatorId)?.operatorName ?? row.operatorId;
          const preLink = link || row.removed ? undefined : payload.preLinks.find(item => item.sourceId === row.sourceId);
          const pdvReason = "pdvReason" in row && typeof row.pdvReason === "string" ? row.pdvReason : null;
          return <div key={row.sourceId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <div><p className="font-medium">{name} · {formatBRL(row.amountCents)}</p><p className="text-muted-foreground">{row.removed ? "Removida do PDV: desfaça o vínculo anterior" : !row.identityVerified ? "Identificador ainda não comprovado: sincronize o PDV" : link?.fingerprint === row.fingerprint ? `${link.accountPlanName} · ${link.resultCenterName}` : "Classificação pendente ou origem alterada"}</p>
              {!row.removed && <p className="text-muted-foreground"><span className="font-medium text-foreground">Justificativa informada no PDV:</span> {pdvReason ?? "Não informada"}</p>}
              {preLink && <p className="text-muted-foreground">Nota enviada pelo aplicativo: {preLink.supplierName} · {formatBRL(preLink.totalCents)}{preLink.changeCents > 0 ? ` · troco de ${formatBRL(preLink.changeCents)}: exige um suprimento desse valor no PDV neste dia` : ""}</p>}</div>
            <div className="flex gap-2">{link && <Button asChild variant="outline" size="sm"><Link href={`/dashboard/financial/expenses?search=${encodeURIComponent(link.description)}`}>Ver despesa</Link></Button>}
              {canLink && preLink && preLink.changeCents >= 0 && row.identityVerified && <Button type="button" size="sm" disabled={busy} onClick={() => usePreLink(preLink)}>Usar nota do aplicativo</Button>}
              {canClassify && <Button type="button" variant="outline" size="sm" disabled={busy} aria-expanded={selected === row.sourceId} onClick={() => choose(row.sourceId)}>{link ? "Corrigir vínculo" : "Classificar"}</Button>}</div>
          </div>;
        })}
      </>}
      {selected && (source || classification) && <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
        <p className="font-semibold">{active ? "Corrigir classificação" : "Classificar sangria"} · {formatBRL(source?.amountCents ?? classification?.amountCents ?? 0)}</p>
        {source && <div className="rounded-lg border bg-background p-3 text-sm"><p className="font-medium">Justificativa informada no PDV</p><p className="mt-1 text-muted-foreground">{source.pdvReason ?? "O operador não informou uma justificativa no PDV."}</p></div>}
        {finalized ? <p>Reabra a contagem deste operador no fechamento para corrigir o vínculo.</p> : active ? <p className="text-sm">Ao desvincular, uma despesa criada aqui será cancelada; uma despesa previamente existente voltará ao estado anterior. O histórico será preservado. Depois, classifique novamente.</p> : <>
          <label className="block text-sm">Como registrar?<select className="mt-1 w-full rounded-md border bg-background p-2" value={mode} disabled={busy} onChange={event => setMode(event.target.value as "create" | "link")}>{canCreate && <option value="create">Criar a despesa paga pela sangria</option>}{canLink && <option value="link">Vincular despesa já cadastrada</option>}</select></label>
          <label className="block text-sm">Centro de resultado da unidade<select className="mt-1 w-full rounded-md border bg-background p-2" value={center} disabled={busy || centers.loading} onChange={event => { setCenter(event.target.value); setCandidates(null); setExistingId(""); }}><option value="">Selecione</option>{centerOptions.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          {mode === "create" ? <><label className="block text-sm">Plano de contas<AccountPlanTreeSelect value={account} onChange={setAccount} options={accountOptions} placeholder="Pesquise a categoria da despesa" disabled={busy || accounts.loading} /></label><label className="block text-sm">O que foi pago?<Input value={description} maxLength={240} disabled={busy} onChange={event => setDescription(event.target.value)} placeholder="Ex.: material de limpeza do quiosque" /></label></> : <>
            {selectedPreLink && <p className="text-sm">Compra pré-vinculada pelo aplicativo: {selectedPreLink.supplierName} · {formatBRL(selectedPreLink.totalCents)}. Confirme abaixo ou busque outra despesa.</p>}
            <Button type="button" variant="outline" disabled={busy || !center} onClick={() => void loadCandidates()}>Buscar despesas em aberto desta unidade e competência</Button>
            {candidates && <><label className="block text-sm">Compra ou despesa já cadastrada<select className="mt-1 w-full rounded-md border bg-background p-2" value={existingId} disabled={busy} onChange={event => setExistingId(event.target.value)}><option value="">Selecione</option>{candidates.candidates.map(row => <option key={row.id} value={row.id}>{row.localPurchase ? "Compra local · " : ""}{row.description} · {formatBRL(row.amountCents)}</option>)}</select></label>{!candidates.candidates.length && <p className="text-sm">Nenhuma compra local ou despesa elegível nesta página. O valor, a competência e a unidade precisam coincidir e não pode existir outro pagamento.</p>}{candidates.nextCursor && <Button type="button" variant="outline" disabled={busy} onClick={() => void loadCandidates(candidates.nextCursor!)}>Buscar mais</Button>}</>}
          </>}
        </>}
        {!finalized && <><label className="block text-sm">{classification ? "Motivo da correção (obrigatório)" : "Observação (opcional)"}<Textarea value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
          <Button type="button" disabled={busy || (active ? !canLink : !source?.identityVerified || catalogOverflow || !!accounts.error || !!centers.error || !center || (mode === "create" ? !account || description.trim().length < 3 || !canCreate : !existingId || !canLink)) || (!!classification && reason.trim().length < 3)} onClick={() => void save()}>{busy ? "Salvando…" : active ? "Confirmar desvinculação" : mode === "create" ? "Criar despesa quitada na origem" : "Confirmar vínculo sem novo pagamento"}</Button></>}
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Fechar edição</Button>
      </div>}
      {(catalogOverflow || accounts.error || centers.error) && <p role="alert" className="text-sm text-destructive">Não foi possível carregar o catálogo completo para classificar. Revise os cadastros ou tente novamente; nada foi gravado.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
