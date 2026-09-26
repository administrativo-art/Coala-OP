import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "../../lib/utils";
import type { BudgetPlanningComparison } from "../../budgets/projection-view";

export function BudgetPlanningComparisonCard({ rows, month, unitId }: { rows: BudgetPlanningComparison[]; month: string; unitId: string }) {
  const selected = rows.filter((row) => row.competenceMonth === month && (unitId === "all" || row.unitIds.includes(unitId)));
  if (!selected.length) return null;
  return <Card><CardHeader><CardTitle>Planejamento por unidade × documentos reais</CardTitle>
    <CardDescription>Competência {month}. Orçamentos são comparação, não despesas adicionais da DRE. As previsões antigas continuam na DRE até sua conversão explícita.</CardDescription></CardHeader>
    <CardContent><Table><TableHeader><TableRow>{["Orçamento / centro", "Orçado", "Comprometido", "Saldo do orçamento", "Compra ainda prevista"].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{selected.map((row) => <TableRow key={row.id}><TableCell><p className="font-medium">{row.name}</p><p>{row.resultCenterName}</p>
        {row.unitIds.length > 1 && <p className="text-xs text-muted-foreground">Centro compartilhado: valor integral, sem divisão presumida entre unidades.</p>}
        {(row.conflictCount > 0 || row.issueCount > 0) && <p className="text-xs text-amber-700">Conferir classificação ou provisões antigas coexistentes.</p>}</TableCell>
        {[row.budgetedAmountCents, row.committedAmountCents, row.balanceAmountCents, row.residualAmountCents].map((cents, i) => <TableCell key={i} className="font-mono">{formatCurrency(cents / 100)}</TableCell>)}</TableRow>)}</TableBody></Table>
      <p className="mt-3 text-xs text-muted-foreground">Comprometido inclui documentos abertos e pagos. Compra prevista não é dívida; depende da conferência da cobertura. A data de compra alimenta o caixa, não altera a competência acima.</p>
    </CardContent></Card>;
}
