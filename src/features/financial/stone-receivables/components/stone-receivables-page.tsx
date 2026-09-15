"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronRight, Landmark, Loader2, RefreshCw, Repeat2 } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { formatBRL } from "@/features/financial/cash-closures/money";
import type { StoneReceivable, StoneReceivableStatus } from "@/features/financial/stone-receivables/types";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { filterUnitsByAccess } from "@/lib/unit-access";

type ListResponse = {
  receivables: StoneReceivable[];
  nextCursor: string | null;
};

const STATUS_LABELS: Record<StoneReceivableStatus, string> = {
  scheduled: "Programado",
  partially_settled: "Parcial",
  settled: "Liquidado",
  overdue: "Vencido",
  cancelled: "Cancelado",
  chargeback: "Chargeback",
};

function currentBelemDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 10).split("-").reverse().join("/") : "—";
}

function responseMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { message?: unknown; error?: { message?: unknown } | string };
  if (typeof value.error === "string") return value.error;
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

export function StoneReceivablesPage() {
  const { firebaseUser, isDefaultAdmin, permissions, user } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const [from, setFrom] = useState(currentBelemDate);
  const [to, setTo] = useState(() => addDays(currentBelemDate(), 90));
  const [kioskId, setKioskId] = useState("all");
  const [status, setStatus] = useState("all");
  const [receivables, setReceivables] = useState<StoneReceivable[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canView = permissions.financial?.view === true
    && permissions.financial?.salesReconciliation?.view === true;
  const authorizedUnits = useMemo(
    () => filterUnitsByAccess(kiosks, user ?? {}, { isDefaultAdmin }),
    [isDefaultAdmin, kiosks, user],
  );
  const unitNames = useMemo(() => new Map(kiosks.map((unit) => [unit.id, unit.name])), [kiosks]);

  const load = useCallback(async (cursor?: string, append = false) => {
    if (!firebaseUser || !canView || !from || !to) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to, limit: "50" });
      if (kioskId !== "all") params.set("kioskId", kioskId);
      if (status !== "all") params.set("status", status);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/financial/stone-receivables?${params}`, {
        headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(payload, "Não foi possível carregar os recebíveis."));
      const result = payload as ListResponse;
      setReceivables((current) => append ? [...current, ...result.receivables] : result.receivables);
      setNextCursor(result.nextCursor);
    } catch (error) {
      if (!append) setReceivables([]);
      toast({
        variant: "destructive",
        title: "Não foi possível carregar os recebíveis Stone.",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [canView, firebaseUser, from, kioskId, status, to, toast]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const totals = useMemo(() => receivables.reduce((result, entry) => ({
    gross: result.gross + entry.grossAmountCents,
    fees: result.fees + entry.mdrAmountCents + entry.anticipationFeeAmountCents,
    net: result.net + entry.netAmountCents,
    pending: result.pending + Math.max(0, entry.netAmountCents - entry.settledAmountCents),
  }), { gross: 0, fees: 0, net: 0, pending: 0 }), [receivables]);

  if (!canView) {
    return <FinancialAccessGuard title="Recebíveis Stone" description="Seu perfil não possui permissão para consultar os detalhes da conciliação Stone." />;
  }

  return (
    <PageContainer variant="wide" className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-emerald-700">Financeiro · Conciliação</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">Recebíveis Stone</h1>
          <p className="mt-1 text-sm text-muted-foreground">Acompanhe bruto, MDR, antecipação, líquido e mudanças da data prevista por parcela.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/dashboard/financial/reconciliation"><Repeat2 className="mr-2 h-4 w-4" />Vendas PDV × Stone</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/financial/expenses/import"><Landmark className="mr-2 h-4 w-4" />Extratos bancários</Link></Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Bruto da página" value={formatBRL(totals.gross)} detail={`${receivables.length} parcela(s) carregada(s)`} />
        <Kpi label="Taxas Stone" value={formatBRL(totals.fees)} detail="MDR e antecipação, sem inferência residual" />
        <Kpi label="Líquido" value={formatBRL(totals.net)} detail="Bruto menos taxas mais ajustes" />
        <Kpi label="Saldo a receber" value={formatBRL(totals.pending)} detail="Líquido menos valor já liquidado" />
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <CardTitle>Agenda por parcela</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">A data original é preservada quando a Stone revisa a previsão atual.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative"><CalendarRange className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Início" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="w-40 pl-9" /></div>
            <Input aria-label="Fim" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="w-40" />
            <Select value={kioskId} onValueChange={setKioskId}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todas as unidades</SelectItem>{authorizedUnits.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos os estados</SelectItem>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Previsão / unidade</TableHead>
                <TableHead>Venda / parcela</TableHead>
                <TableHead className="text-right">Bruto</TableHead>
                <TableHead className="text-right">MDR</TableHead>
                <TableHead className="text-right">Antecipação</TableHead>
                <TableHead className="text-right">Líquido</TableHead>
                <TableHead className="text-right">A receber</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && receivables.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="h-32 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
              ) : receivables.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">Nenhum recebível encontrado para os filtros.</TableCell></TableRow>
              ) : receivables.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <p className="font-semibold">{formatDate(entry.currentExpectedDate)}</p>
                    <p className="text-xs text-muted-foreground">{entry.currentExpectedDate !== entry.originalExpectedDate ? `Original ${formatDate(entry.originalExpectedDate)} · ` : ""}{entry.kioskName || (entry.kioskId ? unitNames.get(entry.kioskId) : null) || "Sem unidade"}</p>
                  </TableCell>
                  <TableCell><p className="max-w-44 truncate font-mono text-xs">{entry.externalSaleId || entry.receivableKey}</p><p className="text-xs text-muted-foreground">Parcela {entry.installmentNumber}/{entry.installmentCount} · rev. {entry.sourceRevision}</p></TableCell>
                  <TableCell className="text-right font-mono">{formatBRL(entry.grossAmountCents)}</TableCell>
                  <TableCell className="text-right font-mono">{formatBRL(entry.mdrAmountCents)}</TableCell>
                  <TableCell className="text-right font-mono">{formatBRL(entry.anticipationFeeAmountCents)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatBRL(entry.netAmountCents)}</TableCell>
                  <TableCell className="text-right font-mono">{formatBRL(Math.max(0, entry.netAmountCents - entry.settledAmountCents))}</TableCell>
                  <TableCell><Badge variant={entry.status === "overdue" || entry.status === "chargeback" ? "destructive" : "outline"}>{STATUS_LABELS[entry.status]}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {nextCursor ? <div className="mt-4 flex justify-center"><Button variant="outline" onClick={() => void load(nextCursor, true)} disabled={loading}>Carregar mais<ChevronRight className="ml-1 h-4 w-4" /></Button></div> : null}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
