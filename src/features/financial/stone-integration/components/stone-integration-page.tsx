"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Cable, Loader2, Pencil, Plus, RefreshCw, Repeat2, ScrollText, WalletCards } from "lucide-react";

import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { financialCollection } from "@/features/financial/lib/repositories";
import type { StoneIngestionRun, StoneMerchantMapping } from "@/features/financial/stone-integration/types";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type BankAccount = { id: string; name?: string; active?: boolean };
type IntegrationPayload = { mappings: StoneMerchantMapping[]; runs: StoneIngestionRun[]; nextCursor: string | null };
type MappingForm = {
  kioskId: string; accountId: string; stoneCodes: string; terminalIds: string;
  legalEntityDocument: string; merchantName: string; secretReference: string;
  status: "active" | "inactive"; validFrom: string; validTo: string; notes: string; reason: string;
};

function todayInBelem() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function emptyForm(): MappingForm {
  return { kioskId: "", accountId: "", stoneCodes: "", terminalIds: "", legalEntityDocument: "", merchantName: "", secretReference: "", status: "active", validFrom: todayInBelem(), validTo: "", notes: "", reason: "" };
}

function codes(value: string) {
  return [...new Set(value.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean))];
}

function runSourceLabel(source: StoneIngestionRun["source"]) {
  return { pdv: "PDV", stone_sales: "Stone Vendas", stone_receivables: "Stone Recebíveis", stone_settlements: "Stone Liquidações" }[source] ?? source;
}

function runStatusLabel(status: StoneIngestionRun["status"]) {
  return status === "completed" ? "Concluída" : status === "processing" ? "Processando" : "Falhou";
}

function formatInstant(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR", { timeZone: "America/Belem" });
}

export function StoneIntegrationPage() {
  const { permissions } = useAuth();
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const { kiosks } = useKiosks();
  const { data: bankAccounts } = useFinancialCollection<BankAccount>(financialCollection("bankAccounts"));
  const canManage = permissions.financial?.view === true && permissions.financial?.stoneIntegration?.manage === true;
  const [mappings, setMappings] = useState<StoneMerchantMapping[]>([]);
  const [runs, setRuns] = useState<StoneIngestionRun[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StoneMerchantMapping | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MappingForm>(emptyForm);
  const accounts = useMemo(() => (bankAccounts ?? []).filter((account) => account.active !== false).sort((left, right) => String(left.name).localeCompare(String(right.name), "pt-BR")), [bankAccounts]);

  const load = useCallback(async (cursor?: string) => {
    if (!canManage) return;
    cursor ? setLoadingMore(true) : setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (cursor) params.set("cursor", cursor);
      const payload = await api<IntegrationPayload>(`/api/financial/stone-integration?${params}`, { fallbackError: "Falha ao carregar a administração da Stone." });
      setMappings(payload.mappings ?? []);
      setRuns((current) => cursor ? [...current, ...(payload.runs ?? [])] : (payload.runs ?? []));
      setNextCursor(payload.nextCursor ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar a administração da Stone.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [api, canManage]);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(mapping: StoneMerchantMapping) {
    setEditing(mapping);
    setForm({
      kioskId: mapping.kioskId, accountId: mapping.accountId, stoneCodes: mapping.stoneCodes.join(", "), terminalIds: mapping.terminalIds.join(", "),
      legalEntityDocument: mapping.legalEntityDocument ?? "", merchantName: mapping.merchantName ?? "", secretReference: mapping.secretReference ?? "",
      status: mapping.status, validFrom: mapping.validFrom, validTo: mapping.validTo ?? "", notes: mapping.notes ?? "", reason: "",
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.kioskId || !form.accountId || codes(form.stoneCodes).length === 0 || form.reason.trim().length < 5) {
      toast({ variant: "destructive", title: "Preencha unidade, conta, Stonecode e justificativa." });
      return;
    }
    setSaving(true);
    try {
      await api(editing ? `/api/financial/stone-integration/${encodeURIComponent(editing.id)}` : "/api/financial/stone-integration", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({ ...form, stoneCodes: codes(form.stoneCodes), terminalIds: codes(form.terminalIds), legalEntityDocument: form.legalEntityDocument || null, merchantName: form.merchantName || null, secretReference: form.secretReference || null, validTo: form.validTo || null, notes: form.notes || null, reason: form.reason.trim() }),
        fallbackError: "Falha ao salvar o mapeamento Stone.",
      });
      toast({ title: editing ? "Mapeamento atualizado." : "Mapeamento criado.", description: "A alteração foi registrada na trilha de auditoria." });
      setDialogOpen(false);
      setEditing(null);
      await load();
    } catch (saveError) {
      toast({ variant: "destructive", title: "Não foi possível salvar.", description: saveError instanceof Error ? saveError.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) return <FinancialAccessGuard title="Integração Stone" description="A configuração e as execuções são restritas aos administradores da integração." />;

  return (
    <PageContainer variant="wide" className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div><p className="text-xs font-extrabold uppercase tracking-[0.14em] text-emerald-700">Financeiro · Conciliação</p><h1 className="mt-1 text-3xl font-black tracking-tight">Integração Stone</h1><p className="mt-1 text-sm text-muted-foreground">Mapeie estabelecimentos para IDs canônicos e acompanhe importações sem expor credenciais.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/dashboard/financial/reconciliation"><Repeat2 className="mr-2 h-4 w-4" />Vendas</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/financial/reconciliation/receivables"><WalletCards className="mr-2 h-4 w-4" />Recebíveis</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/financial/reconciliation/settlements"><ScrollText className="mr-2 h-4 w-4" />Liquidações</Link></Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
          <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Novo mapeamento</Button>
        </div>
      </div>
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</div> : null}
      <Card><CardHeader><CardTitle>Mapeamentos de estabelecimento</CardTitle><CardDescription>Um Stonecode/terminal ativo só pode apontar para uma unidade e uma conta. O possível alias “Whopping” não cria uma unidade nova.</CardDescription></CardHeader><CardContent className="space-y-3">
        {loading ? <div className="flex h-32 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div> : mappings.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum mapeamento cadastrado.</div> : mappings.map((mapping) => (
          <div key={mapping.id} className="flex flex-col gap-3 rounded-xl border p-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{mapping.kioskName}</p><Badge variant={mapping.status === "active" ? "default" : "secondary"}>{mapping.status === "active" ? "Ativo" : "Inativo"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Stonecode: {mapping.stoneCodes.join(", ")} · Conta: {mapping.accountName}</p><p className="mt-1 text-xs text-muted-foreground">Terminais: {mapping.terminalIds.length ? mapping.terminalIds.join(", ") : "todos"} · Vigência: {mapping.validFrom}{mapping.validTo ? ` a ${mapping.validTo}` : " em diante"}</p><p className="mt-1 text-xs text-muted-foreground">Segredo: {mapping.secretReference || "não configurado"}</p></div><Button variant="outline" size="sm" onClick={() => openEdit(mapping)}><Pencil className="mr-2 h-4 w-4" />Editar</Button></div>
        ))}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Execuções da integração</CardTitle><CardDescription>Histórico paginado das cargas canônicas. Falhas não exibem payload, token ou dados do portador.</CardDescription></CardHeader><CardContent className="space-y-3">
        {loading ? <div className="flex h-32 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div> : runs.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma execução registrada.</div> : runs.map((run) => (
          <div key={run.id} className="grid gap-3 rounded-xl border p-4 md:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(90px,0.6fr))] md:items-center"><div className="min-w-0"><p className="truncate font-semibold">{runSourceLabel(run.source)}</p><p className="truncate font-mono text-xs text-muted-foreground">{run.id}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Status</p><Badge variant={run.status === "failed" ? "destructive" : run.status === "completed" ? "default" : "secondary"}>{runStatusLabel(run.status)}</Badge></div><div><p className="text-[10px] uppercase text-muted-foreground">Competência</p><p className="text-sm">{run.period || "—"}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Linhas / duplicadas</p><p className="text-sm">{run.rowCount ?? 0} / {run.duplicateCount ?? 0}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Atualização</p><p className="text-xs">{formatInstant(run.updatedAt ?? run.createdAt)}</p></div></div>
        ))}
        {nextCursor ? <Button variant="outline" className="w-full" disabled={loadingMore} onClick={() => void load(nextCursor)}>{loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Carregar mais execuções</Button> : null}
      </CardContent></Card>
      <Dialog open={dialogOpen} onOpenChange={(open) => !saving && setDialogOpen(open)}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{editing ? "Editar mapeamento Stone" : "Novo mapeamento Stone"}</DialogTitle><DialogDescription>Informe referências operacionais. Tokens e chaves devem permanecer no gerenciador de segredos.</DialogDescription></DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label>Unidade canônica</Label><Select value={form.kioskId} onValueChange={(value) => setForm((current) => ({ ...current, kioskId: value }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{kiosks.map((kiosk) => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Conta Stone</Label><Select value={form.accountId} onValueChange={(value) => setForm((current) => ({ ...current, accountId: value }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name || account.id}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Stonecodes</Label><Input value={form.stoneCodes} onChange={(event) => setForm((current) => ({ ...current, stoneCodes: event.target.value }))} placeholder="123456789, 987654321" /></div>
          <div className="space-y-2"><Label>Terminais (opcional)</Label><Input value={form.terminalIds} onChange={(event) => setForm((current) => ({ ...current, terminalIds: event.target.value }))} placeholder="POS01, POS02" /></div>
          <div className="space-y-2"><Label>CNPJ (somente números)</Label><Input value={form.legalEntityDocument} maxLength={14} onChange={(event) => setForm((current) => ({ ...current, legalEntityDocument: event.target.value.replace(/\D/g, "") }))} /></div>
          <div className="space-y-2"><Label>Nome no provedor</Label><Input value={form.merchantName} onChange={(event) => setForm((current) => ({ ...current, merchantName: event.target.value }))} /></div>
          <div className="space-y-2 md:col-span-2"><Label>Referência do segredo</Label><Input value={form.secretReference} onChange={(event) => setForm((current) => ({ ...current, secretReference: event.target.value }))} placeholder="secret-manager://stone/merchant" /><p className="text-xs text-muted-foreground">Aceita apenas referências secret-manager:// ou env://. O valor do segredo nunca é salvo aqui.</p></div>
          <div className="space-y-2"><Label>Início da vigência</Label><Input type="date" value={form.validFrom} onChange={(event) => setForm((current) => ({ ...current, validFrom: event.target.value }))} /></div>
          <div className="space-y-2"><Label>Fim da vigência (opcional)</Label><Input type="date" value={form.validTo} onChange={(event) => setForm((current) => ({ ...current, validTo: event.target.value }))} /></div>
          <div className="space-y-2"><Label>Status</Label><Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value as MappingForm["status"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Ativo</SelectItem><SelectItem value="inactive">Inativo</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label>Justificativa da alteração</Label><Input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Motivo auditável" /></div>
          <div className="space-y-2 md:col-span-2"><Label>Observações</Label><Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button><Button onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cable className="mr-2 h-4 w-4" />}Salvar mapeamento</Button></DialogFooter>
      </DialogContent></Dialog>
    </PageContainer>
  );
}
