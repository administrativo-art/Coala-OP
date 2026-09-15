"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Cable,
  CheckCircle2,
  ChevronRight,
  Landmark,
  Loader2,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  ScrollText,
  WalletCards,
} from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { formatBRL } from "@/features/financial/cash-closures/money";
import type {
  PersistedSalesReconciliationCase,
  RevenueReconciliationPeriodSummary,
  SalesReconciliationDecision,
  SalesReconciliationReviewStatus,
} from "@/features/financial/sales-reconciliation/types";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

type ListResponse = {
  cases: PersistedSalesReconciliationCase[];
  periods: RevenueReconciliationPeriodSummary[];
  nextCursor: string | null;
  projectionId: string | null;
};

type PeriodAction = { period: RevenueReconciliationPeriodSummary; action: "close" | "reopen" };

const CASE_LABELS: Record<PersistedSalesReconciliationCase["kind"], string> = {
  matched: "Conciliada",
  pdv_only: "Somente PDV",
  stone_only: "Somente Stone",
  amount_mismatch: "Valor divergente",
  status_mismatch: "Status divergente",
  unit_mismatch: "Unidade divergente",
  unit_unmapped: "Stone sem unidade",
  ambiguous: "Correspondência ambígua",
};

const STATUS_LABELS: Record<SalesReconciliationReviewStatus, string> = {
  matched_auto: "Automática",
  pending_review: "Pendente",
  resolved: "Resolvida",
  ignored: "Ignorada",
};

const PERIOD_STATUS_LABELS: Record<string, string> = {
  open: "Aberta",
  partial: "Em revisão",
  ready: "Pronta para fechar",
  closed: "Fechada",
  reopened: "Reaberta",
  stale: "Desatualizada",
};

const CLASSIFICATIONS: Array<{ value: NonNullable<SalesReconciliationDecision["classification"]>; label: string }> = [
  { value: "valid_sale", label: "Venda válida" },
  { value: "stone_only_sale", label: "Venda Stone não registrada no PDV" },
  { value: "invalid_pdv_payment", label: "Pagamento PDV inválido" },
  { value: "other_acquirer", label: "Venda de outra adquirente" },
  { value: "wrong_unit", label: "Unidade Stone incorreta" },
  { value: "timing_difference", label: "Diferença temporal" },
  { value: "cancelled_or_refunded", label: "Cancelamento ou estorno confirmado" },
];

function currentBelemPeriod() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

function responseMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { message?: unknown; error?: { message?: unknown } };
  if (typeof value.error?.message === "string") return value.error.message;
  if (typeof value.message === "string") return value.message;
  return fallback;
}

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <p className="mt-2 font-mono text-2xl font-black tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function SalesReconciliationPage() {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [period, setPeriod] = useState(currentBelemPeriod);
  const [kioskId, setKioskId] = useState("all");
  const [status, setStatus] = useState("all");
  const [cases, setCases] = useState<PersistedSalesReconciliationCase[]>([]);
  const [periods, setPeriods] = useState<RevenueReconciliationPeriodSummary[]>([]);
  const [knownPeriods, setKnownPeriods] = useState<RevenueReconciliationPeriodSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [projectionId, setProjectionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [selectedCase, setSelectedCase] = useState<PersistedSalesReconciliationCase | null>(null);
  const [decisionAction, setDecisionAction] = useState<SalesReconciliationDecision["action"]>("confirm");
  const [classification, setClassification] = useState<NonNullable<SalesReconciliationDecision["classification"]>>("valid_sale");
  const [targetKioskId, setTargetKioskId] = useState("");
  const [reason, setReason] = useState("");
  const [periodAction, setPeriodAction] = useState<PeriodAction | null>(null);
  const [periodReason, setPeriodReason] = useState("");

  const canView = permissions.financial?.view === true
    && permissions.financial?.salesReconciliation?.view === true;
  const canReview = permissions.financial?.salesReconciliation?.review === true;
  const canClassify = permissions.financial?.salesReconciliation?.classify === true;

  const authorizedFetch = useCallback(async (url: string, init?: RequestInit) => {
    if (!firebaseUser) throw new Error("Sessão não disponível.");
    const token = await firebaseUser.getIdToken();
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(responseMessage(payload, "Não foi possível concluir a operação."));
    return payload;
  }, [firebaseUser]);

  const load = useCallback(async (cursor?: string, append = false) => {
    if (!firebaseUser || !canView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ period, limit: "50" });
      if (kioskId !== "all") params.set("kioskId", kioskId);
      if (status !== "all") params.set("status", status);
      if (cursor) params.set("cursor", cursor);
      const result = await authorizedFetch(`/api/financial/sales-reconciliation?${params}`) as ListResponse;
      setCases((current) => append ? [...current, ...result.cases] : result.cases);
      setPeriods(result.periods);
      setKnownPeriods((current) => {
        const byId = new Map(current.map((entry) => [entry.id, entry]));
        result.periods.forEach((entry) => byId.set(entry.id, entry));
        return [...byId.values()].filter((entry) => entry.period === period);
      });
      setNextCursor(result.nextCursor);
      setProjectionId(result.projectionId);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Não foi possível carregar a conciliação.",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch, canView, firebaseUser, kioskId, period, status, toast]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const totals = useMemo(() => {
    const pdv = periods.reduce((sum, entry) => sum + entry.pdvGrossAmountCents, 0);
    const stone = periods.reduce((sum, entry) => sum + entry.stoneGrossAmountCents, 0);
    const caseCount = periods.reduce((sum, entry) => sum + entry.caseCount, 0);
    const decided = periods.reduce((sum, entry) => sum + entry.decidedCaseCount, 0);
    return {
      pdv,
      stone,
      difference: stone - pdv,
      coverage: caseCount === 0 ? 0 : Math.round((decided / caseCount) * 10_000) / 100,
    };
  }, [periods]);

  function openDecision(entry: PersistedSalesReconciliationCase) {
    setSelectedCase(entry);
    setDecisionAction(entry.decision?.action ?? "confirm");
    setClassification(entry.decision?.classification ?? "valid_sale");
    setTargetKioskId(entry.decision?.targetKioskId ?? "");
    setReason(entry.decision?.reason ?? "");
  }

  async function submitDecision() {
    if (!selectedCase) return;
    setWorking(true);
    try {
      const body: SalesReconciliationDecision = {
        action: decisionAction,
        reason: reason.trim(),
        ...(decisionAction === "classify" ? { classification } : {}),
        ...(decisionAction === "classify" && classification === "wrong_unit" && targetKioskId
          ? { targetKioskId }
          : {}),
      };
      await authorizedFetch(
        `/api/financial/sales-reconciliation/cases/${encodeURIComponent(selectedCase.id)}/decision`,
        { method: "POST", body: JSON.stringify(body) },
      );
      setSelectedCase(null);
      toast({ title: "Decisão registrada.", description: "Caso, auditoria e resumo foram atualizados." });
      await load();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Não foi possível registrar a decisão.",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setWorking(false);
    }
  }

  async function submitPeriodAction() {
    if (!periodAction) return;
    setWorking(true);
    try {
      await authorizedFetch(
        `/api/financial/sales-reconciliation/periods/${encodeURIComponent(periodAction.period.id)}/${periodAction.action}`,
        { method: "POST", body: JSON.stringify({ reason: periodReason.trim() }) },
      );
      toast({
        title: periodAction.action === "close" ? "Competência fechada." : "Competência reaberta.",
        description: "A alteração ficou registrada na trilha de auditoria.",
      });
      setPeriodAction(null);
      setPeriodReason("");
      await load();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Não foi possível alterar a competência.",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setWorking(false);
    }
  }

  if (!canView) {
    return (
      <FinancialAccessGuard
        title="Conciliação de vendas"
        description="Seu perfil não possui permissão para consultar a conciliação PDV × Stone."
      />
    );
  }

  return (
    <PageContainer variant="wide" className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-emerald-700">Financeiro · Conciliação</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">Vendas PDV × Stone</h1>
          <p className="mt-1 text-sm text-muted-foreground">Compare valores brutos por venda, classifique exceções e feche a competência com auditoria.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/dashboard/financial/reconciliation/receivables"><WalletCards className="mr-2 h-4 w-4" />Recebíveis Stone</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/financial/reconciliation/settlements"><ScrollText className="mr-2 h-4 w-4" />Liquidações</Link></Button>
          {permissions.financial?.stoneIntegration?.manage ? <Button asChild variant="outline"><Link href="/dashboard/financial/reconciliation/integration"><Cable className="mr-2 h-4 w-4" />Integração</Link></Button> : null}
          <Button asChild variant="outline"><Link href="/dashboard/financial/expenses/import"><Landmark className="mr-2 h-4 w-4" />Extratos bancários</Link></Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Kpi label="PDV eletrônico bruto" value={formatBRL(totals.pdv)} detail="Pix, débito e crédito aprovados" />
        <Kpi label="Stone Vendas bruto" value={formatBRL(totals.stone)} detail="Vendas Stone aprovadas" />
        <Kpi label="Diferença" value={formatBRL(totals.difference)} detail="Stone menos PDV, antes das decisões" />
        <Kpi label="Cobertura" value={`${totals.coverage.toLocaleString("pt-BR")} %`} detail="Casos automáticos ou decididos" />
      </div>

      {!projectionId && !loading ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Competência ainda sem projeção ativa</AlertTitle>
          <AlertDescription>Carregue as fontes PDV e Stone por uma integração autorizada. A tela não presume igualdade quando uma fonte está ausente.</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-2xl">
        <CardHeader className="gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <CardTitle>Casos da competência</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">A correspondência ambígua permanece pendente até uma decisão explícita.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input className="w-40" type="month" min="2026-08" value={period} onChange={(event) => { setKnownPeriods([]); setKioskId("all"); setPeriod(event.target.value); }} />
            <Select value={kioskId} onValueChange={setKioskId}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Todas as unidades" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as unidades</SelectItem>
                {knownPeriods.map((entry) => <SelectItem key={entry.kioskId} value={entry.kioskId}>{entry.kioskName || entry.kioskId}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data / canal</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">PDV</TableHead>
                <TableHead className="text-right">Stone</TableHead>
                <TableHead className="text-right">Diferença</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && cases.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-32 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
              ) : cases.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Nenhum caso encontrado para os filtros.</TableCell></TableRow>
              ) : cases.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell><p className="font-semibold">{entry.businessDate.split("-").reverse().join("/")}</p><p className="text-xs text-muted-foreground">{entry.channel === "pix" ? "Pix" : entry.channel === "debit_card" ? "Débito" : "Crédito"}</p></TableCell>
                  <TableCell><Badge variant={entry.kind === "matched" ? "secondary" : "outline"}>{CASE_LABELS[entry.kind]}</Badge></TableCell>
                  <TableCell className="text-right font-mono">{formatBRL(entry.pdvGrossAmountCents)}</TableCell>
                  <TableCell className="text-right font-mono">{formatBRL(entry.stoneGrossAmountCents)}</TableCell>
                  <TableCell className="text-right font-mono">{formatBRL(entry.differenceAmountCents)}</TableCell>
                  <TableCell><Badge variant={entry.reviewStatus === "pending_review" ? "destructive" : "outline"}>{STATUS_LABELS[entry.reviewStatus]}</Badge></TableCell>
                  <TableCell className="text-right">
                    {canReview && entry.kind !== "unit_unmapped" ? <Button size="sm" variant="ghost" onClick={() => openDecision(entry)}>Revisar<ChevronRight className="ml-1 h-4 w-4" /></Button> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {nextCursor ? <div className="mt-4 flex justify-center"><Button variant="outline" onClick={() => void load(nextCursor, true)} disabled={loading}>Carregar mais</Button></div> : null}
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        {periods.map((entry) => {
          const canClose = permissions.financial?.salesReconciliation?.close === true
            && ["ready", "reopened"].includes(entry.status);
          const canReopen = permissions.financial?.salesReconciliation?.reopen === true
            && ["closed", "stale"].includes(entry.status);
          return (
            <Card key={entry.id} className="rounded-2xl">
              <CardHeader><CardTitle className="flex items-center justify-between gap-3 text-base"><span>{entry.kioskName || entry.kioskId}</span><Badge variant="outline">{PERIOD_STATUS_LABELS[entry.status] || entry.status}</Badge></CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Cobertura</span><strong>{entry.coveragePercent.toLocaleString("pt-BR")} %</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Pendências</span><strong>{entry.pendingCaseCount}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Receita conciliada</span><strong>{formatBRL(entry.reconciledRevenueCents)}</strong></div>
                {canClose ? <Button className="w-full" onClick={() => setPeriodAction({ period: entry, action: "close" })}><LockKeyhole className="mr-2 h-4 w-4" />Fechar competência</Button> : null}
                {canReopen ? <Button className="w-full" variant="outline" onClick={() => setPeriodAction({ period: entry, action: "reopen" })}><RotateCcw className="mr-2 h-4 w-4" />Reabrir competência</Button> : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={selectedCase !== null} onOpenChange={(open) => !open && setSelectedCase(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revisar caso de conciliação</DialogTitle>
            <DialogDescription>A decisão altera somente a projeção auditável; os fatos originais do PDV e da Stone permanecem intactos.</DialogDescription>
          </DialogHeader>
          {selectedCase ? <div className="rounded-xl border bg-muted/30 p-3 text-sm"><div className="flex items-center justify-between"><span>{CASE_LABELS[selectedCase.kind]}</span><strong>{formatBRL(selectedCase.differenceAmountCents)}</strong></div><p className="mt-1 text-xs text-muted-foreground">PDV {formatBRL(selectedCase.pdvGrossAmountCents)} · Stone {formatBRL(selectedCase.stoneGrossAmountCents)}</p></div> : null}
          <div className="space-y-3">
            <Select value={decisionAction} onValueChange={(value) => setDecisionAction(value as SalesReconciliationDecision["action"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="confirm">Confirmar correspondência</SelectItem>
                {canClassify ? <SelectItem value="classify">Classificar divergência</SelectItem> : null}
                <SelectItem value="ignore">Ignorar com motivo</SelectItem>
              </SelectContent>
            </Select>
            {decisionAction === "classify" ? (
              <Select value={classification} onValueChange={(value) => { setClassification(value as typeof classification); setTargetKioskId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CLASSIFICATIONS.map((entry) => <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>)}</SelectContent>
              </Select>
            ) : null}
            {decisionAction === "classify" && classification === "wrong_unit" && selectedCase ? (
              <Select value={targetKioskId} onValueChange={setTargetKioskId}>
                <SelectTrigger><SelectValue placeholder="Selecione a unidade correta" /></SelectTrigger>
                <SelectContent>{selectedCase.kioskIds.map((id) => <SelectItem key={id} value={id}>{knownPeriods.find((entry) => entry.kioskId === id)?.kioskName || id}</SelectItem>)}</SelectContent>
              </Select>
            ) : null}
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Justificativa e evidência consultada" rows={4} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedCase(null)}>Cancelar</Button>
            <Button onClick={() => void submitDecision()} disabled={working || reason.trim().length < 5 || (decisionAction === "classify" && classification === "wrong_unit" && !targetKioskId)}>
              {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Registrar decisão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={periodAction !== null} onOpenChange={(open) => !open && setPeriodAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{periodAction?.action === "close" ? "Fechar competência" : "Reabrir competência"}</DialogTitle>
            <DialogDescription>{periodAction?.action === "close" ? "O fechamento exige as duas fontes e nenhuma pendência." : "A reabertura permite revisar decisões e mantém o histórico anterior."}</DialogDescription>
          </DialogHeader>
          <Alert><ArrowRightLeft className="h-4 w-4" /><AlertTitle>{periodAction?.period.kioskName || periodAction?.period.kioskId}</AlertTitle><AlertDescription>{periodAction ? `${periodAction.period.pendingCaseCount} pendência(s) · ${periodAction.period.coveragePercent.toLocaleString("pt-BR")} % de cobertura` : null}</AlertDescription></Alert>
          <Textarea value={periodReason} onChange={(event) => setPeriodReason(event.target.value)} placeholder="Motivo auditável" rows={4} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPeriodAction(null)}>Cancelar</Button>
            <Button onClick={() => void submitPeriodAction()} disabled={working || periodReason.trim().length < 5}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{periodAction?.action === "close" ? "Confirmar fechamento" : "Confirmar reabertura"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
