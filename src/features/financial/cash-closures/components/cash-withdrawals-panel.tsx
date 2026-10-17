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
import type { listWithdrawalClassifications } from "../withdrawal-classification.server";

type Payload = Awaited<ReturnType<typeof listWithdrawalClassifications>>;
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
  const canConfigure = isDefaultAdmin || !!permissions.financial?.cashClosures?.edit && !!expensePermissions?.pay && !!expensePermissions?.create;
  const canClassify = editable && canConfigure;
  const path = `/api/financial/cash-closures/${encodeURIComponent(data.closure.id)}/withdrawals`;
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [account, setAccount] = useState("");
  const [center, setCenter] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
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
    setSelected(id); setAccount(""); setCenter(centerOptions.length === 1 ? centerOptions[0].id : "");
    setDescription(selectedSource?.pdvReason ?? ""); setReason(""); setError("");
  };
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar a classificação."); }
    finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const common = { sourceId: selected, ...(reason.trim() ? { reason: reason.trim() } : {}) };
    const json = active ? { action: "unlink", ...common }
      : { action: "create", ...common, fingerprint: source?.fingerprint, accountPlanId: account, resultCenterId: center, description };
    await api(path, { method: "PATCH", json });
    setSelected(null); refresh();
  });
  if (!canView) return <p className="text-sm text-muted-foreground">A classificação de sangrias exige acesso às despesas. A finalização continua validando os vínculos no servidor.</p>;
  return <Card className="rounded-[18px] border-ds-border bg-white font-ds text-ds-ink shadow-none">
    <CardHeader className="p-4 sm:p-5"><CardTitle className="text-2xl font-extrabold leading-tight tracking-[-.02em]">Sangrias — despesas pagas em espécie</CardTitle><CardDescription className="text-sm leading-6 text-ds-ink-muted">O PDV já descontou estas saídas do dinheiro esperado. Classifique cada sangria para criar uma nova despesa já quitada em espécie; não haverá outro pagamento bancário. O plano de contas mostra folhas ativas de despesa e compras de insumos para estoque.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {loading ? <p role="status">Consultando sangrias…</p> : !payload ? <Button variant="outline" onClick={refresh}>Tentar novamente</Button> : <>
        <p role="status" className="text-sm">{unresolved + orphaned.length} pendência(s) de vínculo. Todas as sangrias {operatorScopeId ? "deste operador" : "do fechamento"} devem estar classificadas para finalizar {operatorScopeId ? "sua contagem" : "a contagem"}.</p>
        {payload.issues.map(issue => <p key={issue} className="text-sm text-destructive">{issueCopy[issue] ?? "A origem da sangria precisa de conferência."}</p>)}
        {!scopedSources.length && !orphaned.length && <p className="text-sm text-muted-foreground">Nenhuma sangria em espécie {operatorScopeId ? "para este operador" : "neste fechamento"}.</p>}
        {[...scopedSources.map(row => ({ ...row, removed: false })), ...orphaned.map(row => ({ ...row, identityVerified: false, removed: true }))].map(row => {
          const link = payload.classifications.find(item => item.sourceId === row.sourceId && item.active);
          const name = data.operators.find(operator => operator.operatorId === row.operatorId)?.operatorName ?? row.operatorId;
          const pdvReason = "pdvReason" in row && typeof row.pdvReason === "string" ? row.pdvReason : null;
          return <div key={row.sourceId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <div><p className="font-medium">{name} · <span className="font-ds-mono font-bold tabular-nums">{formatBRL(row.amountCents)}</span></p><p className="text-muted-foreground">{row.removed ? "Removida do PDV: desfaça o vínculo anterior" : !row.identityVerified ? "Identificador ainda não comprovado: sincronize o PDV" : link?.fingerprint === row.fingerprint ? `${link.accountPlanName} · ${link.resultCenterName}` : "Classificação pendente ou origem alterada"}</p>
              {!row.removed && <p className="text-muted-foreground"><span className="font-medium text-foreground">Justificativa informada no PDV:</span> {pdvReason ?? "Não informada"}</p>}</div>
            <div className="flex gap-2">{link && <Button asChild variant="outline" size="sm"><Link href={`/dashboard/financial/expenses?search=${encodeURIComponent(link.description)}`}>Ver despesa</Link></Button>}
              {canClassify && <Button type="button" variant="outline" size="sm" disabled={busy} aria-expanded={selected === row.sourceId} onClick={() => choose(row.sourceId)}>{link ? "Corrigir despesa" : "Criar despesa"}</Button>}</div>
          </div>;
        })}
      </>}
      {selected && (source || classification) && <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
        <p className="font-semibold">{active ? "Corrigir despesa da sangria" : "Criar despesa da sangria"} · <span className="font-ds-mono font-bold tabular-nums">{formatBRL(source?.amountCents ?? classification?.amountCents ?? 0)}</span></p>
        {source && <div className="rounded-lg border bg-background p-3 text-sm"><p className="font-medium">Justificativa informada no PDV</p><p className="mt-1 text-muted-foreground">{source.pdvReason ?? "O operador não informou uma justificativa no PDV."}</p></div>}
        {finalized ? <p>Reabra a contagem deste operador no fechamento para corrigir a despesa.</p> : active ? <p className="text-sm">Ao desfazer, a despesa criada por esta sangria será cancelada com o histórico preservado. Depois, crie a classificação correta.</p> : <>
          <p className="rounded-lg bg-ds-info-bg px-3 py-2 text-sm font-semibold text-ds-info">Esta sangria sempre cria uma nova despesa já quitada em espécie.</p>
          <label className="block text-sm">Centro de resultado da unidade<select className="mt-1 w-full rounded-md border bg-background p-2" value={center} disabled={busy || centers.loading} onChange={event => setCenter(event.target.value)}><option value="">Selecione</option>{centerOptions.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="block text-sm">Plano de contas<AccountPlanTreeSelect value={account} onChange={setAccount} options={accountOptions} placeholder="Pesquise a categoria da despesa" disabled={busy || accounts.loading} /></label><label className="block text-sm">O que foi pago?<Input value={description} maxLength={240} disabled={busy} onChange={event => setDescription(event.target.value)} placeholder="Ex.: material de limpeza do quiosque" /></label>
        </>}
        {!finalized && <><label className="block text-sm">{classification ? "Motivo da correção (obrigatório)" : "Observação (opcional)"}<Textarea value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
          <Button type="button" disabled={busy || (active ? !canClassify : !source?.identityVerified || catalogOverflow || !!accounts.error || !!centers.error || !center || !account || description.trim().length < 3 || !canClassify) || (!!classification && reason.trim().length < 3)} onClick={() => void save()}>{busy ? "Salvando…" : active ? "Desfazer e cancelar despesa" : "Criar despesa quitada em espécie"}</Button></>}
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Fechar edição</Button>
      </div>}
      {(catalogOverflow || accounts.error || centers.error) && <p role="alert" className="text-sm text-destructive">Não foi possível carregar o catálogo completo para classificar. Revise os cadastros ou tente novamente; nada foi gravado.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
