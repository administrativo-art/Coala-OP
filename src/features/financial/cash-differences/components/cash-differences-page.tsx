"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, RefreshCw, Repeat2 } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { formatBRL } from "@/features/financial/cash-closures/money";
import type { CashDifferenceClassification, CashDifferenceDecision } from "@/features/financial/cash-differences/types";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { financialCollection } from "@/features/financial/lib/repositories";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { filterUnitsByAccess } from "@/lib/unit-access";

type DifferenceRow = {
  closureId: string; kioskId: string; kioskName: string; date: string; status: string; sourceHash: string;
  expectedCashCents: number; countedCashCents: number; differenceAmountCents: number;
  decision: CashDifferenceDecision | null; decisionStale: boolean;
};

type LossAccount = {
  id: string;
  name: string;
  active?: boolean;
  isGroup?: boolean;
  is_dre_account?: boolean;
  dre_position?: string | null;
};

const CLASSIFICATIONS: Array<{ value: CashDifferenceClassification; label: string }> = [
  { value: "operational_loss", label: "Perda operacional de caixa" },
  { value: "unrecorded_sale", label: "Venda não registrada" },
  { value: "incorrect_cash_movement", label: "Sangria/suprimento incorreto" },
  { value: "employee_receivable", label: "Valor a receber do responsável" },
  { value: "unexplained_surplus", label: "Sobra sem origem identificada" },
  { value: "counting_error", label: "Erro de contagem" },
  { value: "integration_error", label: "Erro de integração" },
];

function currentPeriod() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : new Date().toISOString().slice(0, 7);
}

function classificationLabel(value?: CashDifferenceClassification | null) {
  return CLASSIFICATIONS.find((entry) => entry.value === value)?.label ?? "Pendente";
}

export function CashDifferencesPage({ initialPeriod, initialKioskId }: { initialPeriod?: string; initialKioskId?: string }) {
  const { isDefaultAdmin, permissions, user } = useAuth();
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const { kiosks } = useKiosks();
  const { data: accounts } = useFinancialCollection<LossAccount>(financialCollection("accounts"));
  const accessibleKiosks = useMemo(() => filterUnitsByAccess(kiosks, user ?? {}, { isDefaultAdmin }), [isDefaultAdmin, kiosks, user]);
  const lossAccounts = useMemo(() => (accounts ?? []).filter((account) => {
    const name = String(account.name ?? "").toLocaleLowerCase("pt-BR");
    return account.active !== false && account.isGroup !== true && account.is_dre_account !== false
      && account.dre_position === "despesas_operacionais" && name.includes("caixa") && (name.includes("quebra") || name.includes("diferen"));
  }), [accounts]);
  const canView = permissions.financial?.view === true && permissions.financial?.salesReconciliation?.view === true && permissions.financial?.cashClosures?.view === true;
  const canClassify = permissions.financial?.salesReconciliation?.classify === true;
  const [period, setPeriod] = useState(() => /^\d{4}-\d{2}$/.test(initialPeriod ?? "") ? initialPeriod! : currentPeriod());
  const [selectedKioskId, setSelectedKioskId] = useState(initialKioskId ?? "");
  const kioskId = accessibleKiosks.some((kiosk) => kiosk.id === selectedKioskId)
    ? selectedKioskId
    : accessibleKiosks[0]?.id ?? "";
  const [rows, setRows] = useState<DifferenceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<DifferenceRow | null>(null);
  const [classification, setClassification] = useState<CashDifferenceClassification>("counting_error");
  const [accountPlanId, setAccountPlanId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!canView || !kioskId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ kioskId, period });
      const payload = await api<{ differences: DifferenceRow[] }>(`/api/financial/cash-differences?${params}`, { fallbackError: "Falha ao carregar diferenças de caixa." });
      setRows(payload.differences ?? []);
    } catch (error) {
      toast({ variant: "destructive", title: "Não foi possível carregar as diferenças.", description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [api, canView, kioskId, period, toast]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  function openDecision(row: DifferenceRow) {
    setSelected(row);
    setClassification(row.decision?.classification ?? (row.differenceAmountCents < 0 ? "operational_loss" : "unrecorded_sale"));
    setAccountPlanId(row.decision?.accountPlanId ?? lossAccounts[0]?.id ?? "");
    setReason("");
  }

  async function saveDecision() {
    if (!selected) return;
    setSaving(true);
    try {
      await api(`/api/financial/cash-differences/${encodeURIComponent(selected.closureId)}/decision`, {
        method: "POST",
        body: JSON.stringify({ classification, accountPlanId: classification === "operational_loss" ? accountPlanId || null : null, reason: reason.trim() }),
        fallbackError: "Falha ao classificar a diferença de caixa.",
      });
      toast({ title: "Diferença classificada.", description: classification === "operational_loss" ? "A perda entrou na DRE sem criar obrigação bancária." : classification === "unrecorded_sale" ? "O ajuste entrou somente na Receita conciliada." : "A decisão foi registrada sem efeito automático na DRE." });
      setSelected(null);
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: "Não foi possível classificar.", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  const pendingCount = rows.filter((row) => !row.decision || row.decisionStale).length;
  const shortages = Math.abs(rows.filter((row) => row.differenceAmountCents < 0).reduce((total, row) => total + row.differenceAmountCents, 0));
  const surpluses = rows.filter((row) => row.differenceAmountCents > 0).reduce((total, row) => total + row.differenceAmountCents, 0);

  if (!canView) return <FinancialAccessGuard title="Fechamento mensal" description="A visão exige acesso à conciliação de vendas e aos fechamentos de caixa." />;

  return (
    <PageContainer variant="wide" className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><p className="text-xs font-extrabold uppercase tracking-[0.14em] text-emerald-700">Financeiro · Conciliação</p><h1 className="mt-1 text-3xl font-black tracking-tight">Fechamento mensal</h1><p className="mt-1 text-sm text-muted-foreground">Classifique diferenças físicas sem alterar a contagem, a sangria ou o depósito de origem.</p></div><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/dashboard/financial/reconciliation"><Repeat2 className="mr-2 h-4 w-4" />Vendas PDV × Stone</Link></Button><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button></div></div>
      <div className="grid gap-3 md:grid-cols-3"><Card><CardContent className="p-5"><p className="text-xs font-bold uppercase text-muted-foreground">Pendentes/revisados</p><p className="mt-2 text-2xl font-black">{pendingCount}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-xs font-bold uppercase text-muted-foreground">Faltas</p><p className="mt-2 font-mono text-2xl font-black text-rose-700">{formatBRL(shortages)}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-xs font-bold uppercase text-muted-foreground">Sobras</p><p className="mt-2 font-mono text-2xl font-black text-emerald-700">{formatBRL(surpluses)}</p></CardContent></Card></div>
      {lossAccounts.length === 0 && canClassify ? <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle className="h-5 w-5 shrink-0" /><span>Cadastre a conta-folha “Quebras e diferenças de caixa” em Despesas operacionais antes de classificar uma falta como perda.</span></div> : null}
      <Card><CardHeader className="gap-4 md:flex-row md:items-end md:justify-between"><div><CardTitle>Diferenças dos fechamentos</CardTitle><CardDescription>Somente fechamentos com diferença diferente de zero aparecem.</CardDescription></div><div className="flex flex-wrap gap-2"><Input className="w-40" type="month" min="2026-08" value={period} onChange={(event) => setPeriod(event.target.value)} /><Select value={kioskId} onValueChange={setSelectedKioskId}><SelectTrigger className="w-56"><SelectValue placeholder="Selecione a unidade" /></SelectTrigger><SelectContent>{accessibleKiosks.map((kiosk) => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}</SelectContent></Select></div></CardHeader><CardContent>
        <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead className="text-right">Esperado</TableHead><TableHead className="text-right">Contado</TableHead><TableHead className="text-right">Diferença</TableHead><TableHead>Classificação</TableHead><TableHead className="w-40" /></TableRow></TableHeader><TableBody>
          {loading ? <TableRow><TableCell colSpan={6} className="h-32 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow> : rows.length === 0 ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Nenhuma diferença encontrada.</TableCell></TableRow> : rows.map((row) => <TableRow key={row.closureId}><TableCell><p className="font-semibold">{row.date.split("-").reverse().join("/")}</p><Badge variant="outline">{row.status === "approved" ? "Aprovado" : row.status}</Badge></TableCell><TableCell className="text-right font-mono">{formatBRL(row.expectedCashCents)}</TableCell><TableCell className="text-right font-mono">{formatBRL(row.countedCashCents)}</TableCell><TableCell className={`text-right font-mono font-semibold ${row.differenceAmountCents < 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatBRL(row.differenceAmountCents)}</TableCell><TableCell><p>{classificationLabel(row.decision?.classification)}</p>{row.decisionStale ? <p className="text-xs text-amber-700">Revisar: a origem mudou</p> : row.decision ? <p className="text-xs text-muted-foreground">{row.decision.reason}</p> : null}</TableCell><TableCell className="text-right"><Button asChild size="sm" variant="ghost"><Link href={`/dashboard/financial/cash-closures/${encodeURIComponent(row.kioskId)}/${row.date.replaceAll("-", "/")}`}>Abrir origem</Link></Button>{canClassify ? <Button size="sm" variant="outline" onClick={() => openDecision(row)}>{row.decision ? "Reclassificar" : "Classificar"}</Button> : null}</TableCell></TableRow>)}
        </TableBody></Table>
      </CardContent></Card>
      <Dialog open={selected !== null} onOpenChange={(open) => !open && !saving && setSelected(null)}><DialogContent><DialogHeader><DialogTitle>Classificar diferença de caixa</DialogTitle><DialogDescription>A decisão cria somente o efeito contábil explicitamente escolhido; a origem permanece inalterada.</DialogDescription></DialogHeader>{selected ? <div className="rounded-xl border bg-muted/30 p-3 text-sm"><div className="flex justify-between"><span>{selected.date.split("-").reverse().join("/")}</span><strong>{formatBRL(selected.differenceAmountCents)}</strong></div></div> : null}<Select value={classification} onValueChange={(value) => setClassification(value as CashDifferenceClassification)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CLASSIFICATIONS.filter((entry) => selected?.differenceAmountCents && (selected.differenceAmountCents < 0 ? entry.value !== "unrecorded_sale" && entry.value !== "unexplained_surplus" : entry.value !== "operational_loss" && entry.value !== "employee_receivable")).map((entry) => <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>)}</SelectContent></Select>{classification === "operational_loss" ? <Select value={accountPlanId} onValueChange={setAccountPlanId}><SelectTrigger><SelectValue placeholder="Conta Quebras e diferenças de caixa" /></SelectTrigger><SelectContent>{lossAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent></Select> : null}<Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Justificativa e evidência consultada" rows={4} /><DialogFooter><Button variant="outline" onClick={() => setSelected(null)} disabled={saving}>Cancelar</Button><Button onClick={() => void saveDecision()} disabled={saving || reason.trim().length < 5 || (classification === "operational_loss" && !accountPlanId)}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Registrar decisão</Button></DialogFooter></DialogContent></Dialog>
    </PageContainer>
  );
}
