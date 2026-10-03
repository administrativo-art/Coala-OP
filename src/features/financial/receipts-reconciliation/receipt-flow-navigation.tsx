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
  { id: "credit" as const, number: "04", title: "Crédito bancário", description: "Líquido Stone confirmado na conta vinculada.", icon: Landmark },
];

export function StoneReceiptFlowNavigation({ current, mappingId, stoneCode }: StoneReceiptFlowNavigationProps) {
  return <nav aria-label="Etapas dos recebimentos" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
    {steps.map(step => {
      const Icon = step.icon;
      const active = current === step.id;
      return <Link
        key={step.id}
        href={stoneReceiptFlowHref(step.id, mappingId, stoneCode)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group rounded-2xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[#c9c7bf] hover:bg-[#fffdfd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#df2f78] focus-visible:ring-offset-2",
          active && "border-[#df2f78] bg-[#fdf4f8] shadow-[0_10px_24px_-18px_#df2f78]"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <span className={cn("font-mono text-xs font-bold", active ? "text-[#bd185c]" : "text-muted-foreground")}>{step.number}</span>
          <span className={cn("grid h-9 w-9 place-items-center rounded-xl", active ? "bg-[#fdeef4] text-[#bd185c]" : "bg-muted text-muted-foreground")}><Icon className="h-4 w-4" aria-hidden="true" /></span>
        </div>
        <p className="mt-4 text-sm font-extrabold tracking-tight text-[#1d1d26]">{step.title}</p>
        <p className="mt-1 min-h-9 text-xs leading-5 text-muted-foreground">{step.description}</p>
        <span className={cn("mt-4 inline-flex items-center gap-1 text-xs font-bold", active ? "text-[#bd185c]" : "text-[#6f6f7c] group-hover:text-[#bd185c]")}>
          {active ? "Nesta etapa" : "Abrir"}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </Link>;
    })}
  </nav>;
}
