"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Landmark, Link2, Loader2, RefreshCw, Repeat2, Unlink, WalletCards } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { formatBRL } from "@/features/financial/cash-closures/money";
import type { StoneSettlement } from "@/features/financial/stone-receivables/types";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { resolveUnitAccess } from "@/lib/unit-access";

type ListResponse = { settlements: StoneSettlement[]; nextCursor: string | null };
type ReconciliationAction = { settlement: StoneSettlement; type: "link" | "unlink" };

function currentBelemDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Belem", dateStyle: "short", timeStyle: "short" });
}

function responseMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { message?: unknown; error?: { message?: unknown } | string };
  if (typeof value.error === "string") return value.error;
  if (typeof value.error?.message === "string") return value.error.message;
  if (typeof value.message === "string") return value.message;
  return fallback;
}

export function StoneSettlementsPage() {
  const { firebaseUser, isDefaultAdmin, permissions, user } = useAuth();
  const { toast } = useToast();
  const [from, setFrom] = useState(() => addDays(currentBelemDate(), -30));
  const [to, setTo] = useState(currentBelemDate);
  const [settlements, setSettlements] = useState<StoneSettlement[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [action, setAction] = useState<ReconciliationAction | null>(null);
  const [transactionId, setTransactionId] = useState("");
  const [reason, setReason] = useState("");

  const allUnits = resolveUnitAccess(user ?? {}, { isDefaultAdmin }).allUnits;
  const canView = Boolean(isDefaultAdmin || (
    permissions.financial?.view
    && permissions.financial?.salesReconciliation?.view
    && permissions.financial?.reconciliation?.view
    && allUnits
  ));
  const canLink = Boolean(isDefaultAdmin || permissions.financial?.reconciliation?.confirm);
  const canUnlink = Boolean(isDefaultAdmin || permissions.financial?.reconciliation?.correct);

  const authorizedFetch = useCallback(async (url: string, init?: RequestInit) => {
    if (!firebaseUser) throw new Error("Sessão não disponível.");
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${await firebaseUser.getIdToken()}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(responseMessage(payload, "Não foi possível concluir a operação."));
    return payload;
  }, [firebaseUser]);

  const load = useCallback(async (cursor?: string, append = false) => {
    if (!canView || !from || !to) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to, limit: "50" });
      if (cursor) params.set("cursor", cursor);
      const result = await authorizedFetch(`/api/financial/stone-settlements?${params}`) as ListResponse;
      setSettlements((current) => append ? [...current, ...result.settlements] : result.settlements);
      setNextCursor(result.nextCursor);
    } catch (error) {
      if (!append) setSettlements([]);
      toast({ variant: "destructive", title: "Não foi possível carregar as liquidações Stone.", description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch, canView, from, to, toast]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const totals = useMemo(() => settlements.reduce((result, entry) => ({
    gross: result.gross + entry.grossAmountCents,
    fees: result.fees + entry.feeAmountCents,
    net: result.net + entry.netAmountCents,
    linked: result.linked + Number(Boolean(entry.linkedBankTransactionId)),
  }), { gross: 0, fees: 0, net: 0, linked: 0 }), [settlements]);

  function openAction(settlement: StoneSettlement, type: ReconciliationAction["type"]) {
    setAction({ settlement, type });
    setTransactionId(settlement.linkedBankTransactionId ?? "");
    setReason("");
  }

  async function submitAction() {
    if (!action) return;
    setWorking(true);
    try {
      await authorizedFetch(`/api/financial/stone-settlements/${encodeURIComponent(action.settlement.id)}/bank-transaction`, {
        method: action.type === "link" ? "POST" : "DELETE",
        body: JSON.stringify({ transactionId: transactionId || undefined, reason: reason.trim() }),
      });
      toast({ title: action.type === "link" ? "Liquidação vinculada." : "Vínculo removido.", description: "A correção foi gravada com auditoria e sem criar nova transação." });
      setAction(null);
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: "Não foi possível atualizar o vínculo.", description: error instanceof Error ? error.message : undefined });
    } finally {
      setWorking(false);
    }
  }

  if (!canView) {
    return <FinancialAccessGuard title="Liquidações Stone" description="Liquidações agregadas exigem acesso a todas as unidades e às conciliações de vendas e bancária." />;
  }

  return (
    <PageContainer variant="wide" className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-emerald-700">Financeiro · Conciliação</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">Liquidações Stone</h1>
          <p className="mt-1 text-sm text-muted-foreground">Vincule cada liquidação a uma única entrada já existente no extrato da conta Stone.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/dashboard/financial/reconciliation"><Repeat2 className="mr-2 h-4 w-4" />Vendas</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/financial/reconciliation/receivables"><WalletCards className="mr-2 h-4 w-4" />Recebíveis</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard/financial/expenses/import"><Landmark className="mr-2 h-4 w-4" />Extratos</Link></Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl"><CardContent className="p-5"><p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Bruto da página</p><p className="mt-2 font-mono text-2xl font-black">{formatBRL(totals.gross)}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-5"><p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Taxas e descontos</p><p className="mt-2 font-mono text-2xl font-black">{formatBRL(totals.fees)}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-5"><p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Líquido realizado</p><p className="mt-2 font-mono text-2xl font-black">{formatBRL(totals.net)}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-5"><p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Vínculos bancários</p><p className="mt-2 font-mono text-2xl font-black">{totals.linked}/{settlements.length}</p></CardContent></Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div><CardTitle>Liquidações importadas</CardTitle><p className="mt-1 text-sm text-muted-foreground">Conta, valor e janela de três dias precisam conferir antes da confirmação humana.</p></div>
          <div className="flex gap-2"><Input aria-label="Início" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="w-40" /><Input aria-label="Fim" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="w-40" /></div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Data / identificação</TableHead><TableHead>Conta</TableHead><TableHead className="text-right">Bruto</TableHead><TableHead className="text-right">Taxas</TableHead><TableHead className="text-right">Ajustes</TableHead><TableHead className="text-right">Líquido</TableHead><TableHead>Conciliação</TableHead><TableHead className="w-28" /></TableRow></TableHeader>
            <TableBody>
              {loading && settlements.length === 0 ? <TableRow><TableCell colSpan={8} className="h-32 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
                : settlements.length === 0 ? <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">Nenhuma liquidação no período.</TableCell></TableRow>
                  : settlements.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell><p className="font-semibold">{formatDate(entry.settledAt)}</p><p className="max-w-56 truncate font-mono text-xs text-muted-foreground">{entry.externalSettlementId}</p></TableCell>
                      <TableCell className="font-mono text-xs">{entry.accountId}</TableCell>
                      <TableCell className="text-right font-mono">{formatBRL(entry.grossAmountCents)}</TableCell>
                      <TableCell className="text-right font-mono">{formatBRL(entry.feeAmountCents)}</TableCell>
                      <TableCell className="text-right font-mono">{formatBRL(entry.adjustmentAmountCents)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{formatBRL(entry.netAmountCents)}</TableCell>
                      <TableCell>{entry.linkedBankTransactionId ? <div><Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3" />Vinculada</Badge><p className="mt-1 max-w-40 truncate font-mono text-[10px] text-muted-foreground">{entry.linkedBankTransactionId}</p></div> : <Badge variant="destructive">Pendente</Badge>}</TableCell>
                      <TableCell className="text-right">{entry.linkedBankTransactionId ? canUnlink && <Button size="sm" variant="ghost" onClick={() => openAction(entry, "unlink")}><Unlink className="mr-1 h-4 w-4" />Corrigir</Button> : canLink && <Button size="sm" variant="ghost" onClick={() => openAction(entry, "link")}><Link2 className="mr-1 h-4 w-4" />Vincular</Button>}</TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          {nextCursor ? <div className="mt-4 flex justify-center"><Button variant="outline" onClick={() => void load(nextCursor, true)} disabled={loading}>Carregar mais<ChevronRight className="ml-1 h-4 w-4" /></Button></div> : null}
        </CardContent>
      </Card>

      <Dialog open={action !== null} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{action?.type === "link" ? "Vincular entrada bancária" : "Remover vínculo bancário"}</DialogTitle><DialogDescription>{action?.type === "link" ? "A transação deve ser uma entrada na mesma conta, ter o valor líquido exato e estar na janela de três dias." : "A transação permanece no livro bancário; somente a relação auditável será removida."}</DialogDescription></DialogHeader>
          {action && <div className="rounded-xl border bg-muted/30 p-3 text-sm"><div className="flex justify-between"><span>{action.settlement.externalSettlementId}</span><strong>{formatBRL(action.settlement.netAmountCents)}</strong></div></div>}
          <div className="space-y-3">
            <Input value={transactionId} onChange={(event) => setTransactionId(event.target.value)} placeholder="ID da transação bancária" disabled={action?.type === "unlink"} />
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Justificativa e evidência consultada" rows={4} />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setAction(null)}>Cancelar</Button><Button onClick={() => void submitAction()} disabled={working || !transactionId || reason.trim().length < 5}>{working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : action?.type === "link" ? <Link2 className="mr-2 h-4 w-4" /> : <Unlink className="mr-2 h-4 w-4" />}{action?.type === "link" ? "Confirmar vínculo" : "Remover vínculo"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
