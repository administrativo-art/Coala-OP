"use client";

import Link from "next/link";
import { budgetExpenseHref } from "@/features/financial/budgets/comparison";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FinancialBudgetSummary } from "@/features/financial/budgets/types";
import { formatCurrency } from "@/features/financial/lib/utils";
import { BudgetCoverageEditor } from "./budget-coverage-editor";
import { BudgetRevisionEditor } from "./budget-revision-editor";
import { canDispensePurchase, type BudgetAccountOption } from "./budget-ui-model";

const coverageLabels: Record<string, string> = { open: "Compra prevista", partial: "Parcial", final: "Compra encerrada", invalidated: "Conferir novamente", not_required: "Compra dispensada" };

export function BudgetDetails({ budget, accounts, canManage, canViewPersonnel, canEditPersonnel, canViewExpenses = false, defaultOpen = false, onSaved }: {
  budget: FinancialBudgetSummary; accounts: BudgetAccountOption[];
  canManage: boolean; canViewPersonnel: boolean; canEditPersonnel: boolean; canViewExpenses?: boolean; defaultOpen?: boolean; onSaved: () => Promise<void>;
}) {
  const [coverageLineId, setCoverageLineId] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const composed = Boolean(budget.hasComposition || budget.composition?.length);
  const nominal = canViewPersonnel && !budget.personnelDetailsRedacted;
  const canRevise = canManage && (!composed || (canEditPersonnel && nominal));
  const coverageLine = nominal ? budget.people?.find((line) => line.id === coverageLineId) : undefined;

  return <details open={defaultOpen || undefined} className="mt-3 rounded-lg border p-3" data-testid="budget-details">
    <summary className="cursor-pointer text-sm font-medium">Comparar planejamento e despesas</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">Previsto é o planejamento. O valor em despesas inclui documentos abertos e pagos. A diferença compara esses dois valores; a compra ainda esperada considera a conferência de cada pessoa.</p>
      {composed && <div className="grid gap-3 sm:grid-cols-3">{[
        ["Compra ainda esperada", budget.residualAmountCents], ["Comprometido a identificar", budget.unidentifiedAmountCents], ["Fora da composição", budget.outsideCompositionAmountCents],
      ].map(([label, cents]) => <div key={String(label)} className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{label}</p><strong className="font-mono">{typeof cents === "number" ? formatCurrency(cents / 100) : "Não informado"}</strong></div>)}</div>}
      {composed && !nominal && <p className="text-sm text-muted-foreground">Detalhamento pessoal restrito ao perfil autorizado.</p>}
      {nominal && Boolean(budget.people?.length) && <Table><TableHeader><TableRow>
        {["Colaborador / conta", "Centro de custo", "Compra prevista", "Previsto", "Em despesas", "Diferença", "Compra adicional", "Cobertura", ...(canEditPersonnel ? ["Conferência"] : [])].map((label) => <TableHead key={label}>{label}</TableHead>)}
      </TableRow></TableHeader><TableBody>{budget.people!.map((line) => <TableRow key={line.id}>
        <TableCell><p className="font-medium">{line.employeeName}</p><p className="text-xs text-muted-foreground">{accounts.find((account) => account.id === line.accountPlanId)?.name ?? "Conta do orçamento"}</p></TableCell>
        <TableCell>{budget.resultCenterName}</TableCell><TableCell>{line.expectedPurchaseDate}</TableCell>
        {[line.amountCents, line.committedAmountCents, line.balanceAmountCents, line.residualAmountCents].map((cents, index) => <TableCell key={index} className="whitespace-nowrap font-mono">{formatCurrency(cents / 100)}</TableCell>)}
        <TableCell><Badge variant={line.coverageState === "invalidated" ? "destructive" : "outline"}>{budget.expectationStops?.some((stop) => stop.lineId === line.id) ? "Encerrada por desligamento" : coverageLabels[line.coverageState] ?? "Conferir"}</Badge></TableCell>
        {canEditPersonnel && <TableCell>{budget.active && !budget.expectationStops?.some((stop) => stop.lineId === line.id) && (line.documentIds.length > 0 || canDispensePurchase(line)) && <Button size="sm" variant="outline" onClick={() => { setCoverageLineId(line.id); setRevising(false); }}>Conferir</Button>}</TableCell>}
      </TableRow>)}</TableBody></Table>}
      {coverageLine && canEditPersonnel && budget.active && <BudgetCoverageEditor key={coverageLine.id} budget={budget} line={coverageLine} onSaved={onSaved} onCancel={() => setCoverageLineId(null)} />}
      <div className="space-y-2"><p className="text-sm font-semibold">Despesas que realizam este orçamento</p>
        {budget.expenses.length ? <ul className="space-y-2">{budget.expenses.map((document) => <li key={document.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm"><div><p>{document.description}</p><p className="text-xs text-muted-foreground">Competência: {budget.competenceMonth} · Parcela neste orçamento</p>{canViewExpenses && !budget.personnelDetailsRedacted && <Link className="mt-1 inline-block text-primary underline underline-offset-4" href={budgetExpenseHref(document.id, budget.competenceMonth)}>Ver despesa</Link>}</div><strong className="font-mono">{formatCurrency(document.amountCents / 100)}</strong></li>)}</ul>
          : <p className="text-sm text-muted-foreground">Nenhum documento compromete este orçamento. Isso não comprova nova dívida nem dispensa a compra automaticamente.</p>}</div>
      {nominal && Boolean(budget.coverage?.length) && <div className="space-y-2"><p className="text-sm font-semibold">Conferências registradas</p>{budget.coverage!.map((coverage) => <p key={coverage.lineId} className="text-sm">
        {budget.composition?.find((line) => line.id === coverage.lineId)?.employeeName ?? "Linha do orçamento"} · {coverageLabels[coverage.state]} · {coverage.reason} · {coverage.confirmedAt}
      </p>)}</div>}
      {canRevise && <Button variant="outline" onClick={() => { setRevising(!revising); setCoverageLineId(null); }}>{revising ? "Fechar revisão" : "Revisar snapshot deste mês"}</Button>}
      {revising && canRevise && <BudgetRevisionEditor key={budget.id} budget={budget} accounts={accounts} onSaved={onSaved} onCancel={() => setRevising(false)} />}
    </div>
  </details>;
}
