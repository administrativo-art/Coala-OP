import Link from "next/link";
import { Landmark, Percent, RefreshCw, WalletCards } from "lucide-react";
import { cn } from "@/lib/utils";

export type StoneReceiptFlowStep = "receivables" | "anticipations" | "fees" | "credit";

type StoneReceiptFlowNavigationProps = {
  current: StoneReceiptFlowStep;
  feePending?: number | null;
  mappingId?: string;
  stoneCode?: string;
};

type ReceiptNavigationContext={month?:string;kioskId?:string|null};
function withScope(pathname: string, mappingId?: string, stoneCode?: string, tab?: "fees" | "credit", context?: ReceiptNavigationContext) {
  const query = new URLSearchParams();
  if (mappingId) query.set("mapping", mappingId);
  if (stoneCode) query.set("stoneCode", stoneCode);
  if (tab) query.set("tab", tab);
  if (context?.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(context.month)) query.set("month",context.month);
  if (context?.kioskId) query.set("kiosk",context.kioskId);
  const text = query.toString();
  return text ? `${pathname}?${text}` : pathname;
}

export function stoneReceiptFlowHref(step: StoneReceiptFlowStep, mappingId?: string, stoneCode?: string, context?: ReceiptNavigationContext) {
  if (step === "receivables") return withScope("/dashboard/financial/cash-flow/receivables", mappingId, stoneCode);
  if (step === "anticipations") return withScope("/dashboard/financial/stone-anticipations", mappingId, stoneCode);
  return withScope("/dashboard/financial/stone-receipts", mappingId, stoneCode, step, context);
}

const tabs = [
  { id: "receivables" as const, title: "A receber", description: "O que a Stone ainda deve pagar, e quando.", icon: WalletCards },
  { id: "anticipations" as const, title: "Antecipações", description: "O que foi pago antes do prazo e quanto custou.", icon: RefreshCw },
  { id: "fees" as const, title: "Taxas", description: "Quanto a Stone reteve de taxa, para contabilizar.", icon: Percent },
  { id: "credit" as const, title: "Recebido", description: "O previsto caiu na conta Stone, venda a venda.", icon: Landmark },
];

/**
 * Quatro conferências independentes sobre os mesmos arquivos da Stone (não são etapas em sequência).
 * Abas de contexto na faixa clara acima do conteúdo (docs/design/estrutura-e-navegacao.md).
 */
export function StoneReceiptFlowNavigation({ current, mappingId, stoneCode, feePending }: StoneReceiptFlowNavigationProps) {
  const active = tabs.find(tab => tab.id === current);
  return <nav aria-label="Recebíveis Stone" className="space-y-2">
    <div className="flex max-w-full overflow-x-auto"><div className="inline-flex rounded-ds-md bg-ds-seg p-[3px]">{tabs.map(tab => {
      const Icon = tab.icon;
      const selected = current === tab.id;
      return <Link
        key={tab.id}
        href={stoneReceiptFlowHref(tab.id, mappingId, stoneCode)}
        aria-current={selected ? "page" : undefined}
        title={tab.description}
        className={cn(
          "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-ds-sm px-4 text-[13px] font-bold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink",
          selected ? "bg-ds-surface text-ds-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-ds-ink-muted hover:text-ds-ink",
        )}
      >
        <Icon aria-hidden="true" className={cn("h-4 w-4", selected ? "text-ds-accent-ink" : "")} />{tab.title}{tab.id==="fees" && feePending!==undefined ? <span aria-label={feePending===null?"Alertas de taxas ainda não apurados":`${feePending} alertas de taxas`} className="rounded-full bg-ds-warn-bg px-2 text-xs">{feePending??"—"}</span> : null}
      </Link>;
    })}</div></div>
    {active ? <p className="text-[12.5px] text-ds-ink-muted">{active.description}</p> : null}
  </nav>;
}
