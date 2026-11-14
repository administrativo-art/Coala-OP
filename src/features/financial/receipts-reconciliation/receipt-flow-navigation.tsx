import Link from "next/link";
import { ArrowRight, Landmark, Percent, RefreshCw, WalletCards } from "lucide-react";
import { cn } from "@/lib/utils";

export type StoneReceiptFlowStep = "receivables" | "anticipations" | "fees" | "credit";

type StoneReceiptFlowNavigationProps = {
  current: StoneReceiptFlowStep;
  mappingId?: string;
  stoneCode?: string;
};

function withScope(pathname: string, mappingId?: string, stoneCode?: string, tab?: "fees" | "credit") {
  const query = new URLSearchParams();
  if (mappingId) query.set("mapping", mappingId);
  if (stoneCode) query.set("stoneCode", stoneCode);
  if (tab) query.set("tab", tab);
  const text = query.toString();
  return text ? `${pathname}?${text}` : pathname;
}

export function stoneReceiptFlowHref(step: StoneReceiptFlowStep, mappingId?: string, stoneCode?: string) {
  if (step === "receivables") return withScope("/dashboard/financial/cash-flow/receivables", mappingId, stoneCode);
  if (step === "anticipations") return withScope("/dashboard/financial/stone-anticipations", mappingId, stoneCode);
  return withScope("/dashboard/financial/stone-receipts", mappingId, stoneCode, step);
}

const steps = [
  { id: "receivables" as const, number: "01", title: "Carteira e previsões", description: "Parcelas abertas, posição Stone e previsão por período.", icon: WalletCards },
  { id: "anticipations" as const, number: "02", title: "Antecipações", description: "Pagamentos antes do vencimento e seus custos explícitos.", icon: RefreshCw },
  { id: "fees" as const, number: "03", title: "Taxas praticadas", description: "Retenções comprovadas e apropriação da despesa.", icon: Percent },
  { id: "credit" as const, number: "04", title: "Pago na conta Stone", description: "Previsto × pago na conta Stone, por dia e por cartão, com a auditoria de cada venda.", icon: Landmark },
];

export function StoneReceiptFlowNavigation({ current, mappingId, stoneCode }: StoneReceiptFlowNavigationProps) {
  return <nav aria-label="Etapas dos recebimentos" className="rounded-2xl border border-ds-border bg-white p-4 sm:p-5">
    <p className="text-xs font-extrabold uppercase tracking-widest text-ds-ink-faint">Acompanhe o recebimento</p>
    <p className="mb-4 mt-1 text-sm text-muted-foreground">Da parcela prevista ao dinheiro que entrou na conta.</p>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{steps.map(step => {
      const Icon = step.icon;
      const active = current === step.id;
      return <Link
        key={step.id}
        href={stoneReceiptFlowHref(step.id, mappingId, stoneCode)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-3 rounded-xl border border-ds-border bg-ds-input px-3 py-3 transition hover:border-ds-border-input hover:bg-ds-warm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent focus-visible:ring-offset-2",
          active && "border-ds-accent bg-ds-accent-row"
        )}
      >
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", active ? "bg-white text-ds-accent-ink" : "bg-white text-ds-ink-muted")}><Icon className="h-4 w-4" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Etapa {step.number}</span>
          <span className="block text-sm font-bold text-ds-ink">{step.title}</span>
        </span>
        <span className="sr-only">{step.description} {active ? "Etapa atual" : "Abrir etapa"}</span>
        <ArrowRight className="h-4 w-4 shrink-0 text-ds-accent-ink" aria-hidden="true" />
      </Link>;
    })}</div>
  </nav>;
}
