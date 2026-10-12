import Link from "next/link";
import { Button } from "@/components/ui/button";

export function FinancialAnalysisNavigation({ topic }: { topic: "anticipations" | "receivables" | "management" }) {
  const variant = (active: boolean) => (active ? "primary-modal" : "ds-secondary");
  return <nav aria-label="Análises do Coala Financeiro" className="flex flex-wrap gap-2">
    <Button asChild size="md" variant={variant(topic === "management")}>
      <Link href="/dashboard/financial/cash-flow/agent?topic=management" aria-current={topic === "management" ? "page" : undefined}>DRE, caixa e rotina</Link>
    </Button>
    <Button asChild size="md" variant="ds-secondary"><Link href="/dashboard/financial/sales-reconciliation">PDV × Stone</Link></Button>
    <Button asChild size="md" variant={variant(topic === "anticipations")}>
      <Link href="/dashboard/financial/cash-flow/agent" aria-current={topic === "anticipations" ? "page" : undefined}>Antecipações</Link>
    </Button>
    <Button asChild size="md" variant={variant(topic === "receivables")}>
      <Link href="/dashboard/financial/cash-flow/agent?topic=receivables" aria-current={topic === "receivables" ? "page" : undefined}>Recebíveis por período</Link>
    </Button>
  </nav>;
}
