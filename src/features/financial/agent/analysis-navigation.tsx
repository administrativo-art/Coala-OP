import Link from "next/link";
import { Button } from "@/components/ui/button";

export function FinancialAnalysisNavigation({ topic }: { topic: "anticipations" | "receivables" | "management" }) {
  return <nav aria-label="Análises do Coala Financeiro" className="flex flex-wrap gap-2">
    <Button asChild variant={topic === "management" ? "secondary" : "outline"}>
      <Link href="/dashboard/financial/cash-flow/agent?topic=management" aria-current={topic === "management" ? "page" : undefined}>DRE, caixa e rotina</Link>
    </Button>
    <Button asChild variant="outline"><Link href="/dashboard/financial/sales-reconciliation">PDV × Stone</Link></Button>
    <Button asChild variant={topic === "anticipations" ? "secondary" : "outline"}>
      <Link href="/dashboard/financial/cash-flow/agent" aria-current={topic === "anticipations" ? "page" : undefined}>Antecipações</Link>
    </Button>
    <Button asChild variant={topic === "receivables" ? "secondary" : "outline"}>
      <Link href="/dashboard/financial/cash-flow/agent?topic=receivables" aria-current={topic === "receivables" ? "page" : undefined}>Recebíveis por período</Link>
    </Button>
  </nav>;
}
