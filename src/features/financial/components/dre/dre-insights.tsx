"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Clock3 } from "lucide-react";

import { formatCurrency as currency } from "@/features/financial/lib/utils";
import type { DreCmvCriterion } from "@/features/financial/dre/stock-cmv";
import { cn } from "@/lib/utils";

function money(value: number) {
  return Number.isFinite(value) ? currency(value) : null;
}

function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group text-[12.5px]">
      <summary className="cursor-pointer list-none font-semibold text-ds-accent-ink marker:hidden">
        <span className="underline-offset-2 group-open:underline">{summary}</span>
      </summary>
      <div className="mt-1.5 space-y-1 leading-relaxed text-ds-ink-muted">{children}</div>
    </details>
  );
}

export type DreCashCardProps = {
  revenue: number;
  shortage: number;
  surplus: number;
  coveredDays: number;
  totalDays: number;
  coverageComplete: boolean;
  provisional: boolean;
  className?: string;
};

/** Caixa em espécie na competência de origem. Falta e sobra indisponíveis nunca aparecem como zero. */
export function DreCashCard({ revenue, shortage, surplus, coveredDays, totalDays, coverageComplete, provisional, className }: DreCashCardProps) {
  const pendingDays = Math.max(totalDays - coveredDays, 0);
  const waiting = (value: number) => money(value) === null;
  return (
    <section className={cn("flex flex-col gap-3.5 rounded-ds-card border border-ds-border bg-ds-surface p-5", className)} aria-labelledby="dre-cash-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="dre-cash-title" className="text-[15px] font-extrabold">Caixa em espécie</h2>
          <p className="text-[12.5px] text-ds-ink-muted">Competência de origem</p>
        </div>
        {pendingDays > 0 || provisional ? (
          <span className="whitespace-nowrap rounded-full bg-ds-warn-bg px-2.5 py-1 text-[11.5px] font-bold text-ds-alert-ink">
            {pendingDays > 0 ? `${pendingDays} ${pendingDays === 1 ? "dia" : "dias"} sem diferença comprovada` : "Valores provisórios"}
          </span>
        ) : null}
      </div>
      <div className="flex items-baseline justify-between gap-3 border-b border-ds-divider pb-3">
        <span className="text-[13px] text-ds-ink-2">Vendas integrais do PDV</span>
        <strong className="font-ds-mono text-[19px] font-bold">{money(revenue) ?? "Indisponível"}</strong>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {([["(−) Faltas de caixa", shortage, "text-ds-danger"], ["(+) Sobras de caixa", surplus, "text-ds-ok"]] as const).map(([label, value, tone]) => (
          <div key={label} className={cn("rounded-ds-md p-3", waiting(value) ? "border border-dashed border-ds-border-input bg-ds-input" : "bg-ds-muted")}>
            <p className="text-[12px] font-semibold text-ds-ink-2">{label}</p>
            {waiting(value) ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ds-ink-muted"><Clock3 className="h-3.5 w-3.5" aria-hidden /> Aguardando conferência</p>
            ) : (
              <p className={cn("mt-1 font-ds-mono text-[16px] font-bold", tone)}>{money(value)}</p>
            )}
          </div>
        ))}
      </div>
      {!coverageComplete ? (
        <div className="flex flex-wrap items-center gap-3 rounded-ds-md border border-ds-alert-border bg-ds-alert-bg px-3 py-2.5">
          <span className="flex-1 text-[12.5px] text-ds-alert-ink">Diferenças comprovadas em {coveredDays} de {totalDays} dias. Enquanto isso, o resultado é provisório.</span>
          <Link href="/dashboard/financial/cash-closures" className="text-[12.5px] font-bold text-ds-accent-ink underline-offset-2 hover:underline">Abrir fechamento de caixa</Link>
        </div>
      ) : null}
      <Disclosure summary="Como o caixa entra na DRE">
        <p>As sangrias já reduzem o dinheiro esperado na contagem e entram uma única vez como despesa, nas categorias escolhidas, sem reduzir o faturamento do PDV.</p>
        <p>Diferenças de dias ou contagens pendentes ficam fora da soma. A contagem financeira finalizada prevalece por operador; antes dela, vale a contagem do PDV.</p>
      </Disclosure>
    </section>
  );
}

export type DreCmvCardProps = {
  criterion: DreCmvCriterion;
  onCriterionChange: (criterion: DreCmvCriterion) => void;
  compositionCmv: number;
  stock: {
    loading: boolean;
    error: string | null;
    available: boolean;
    total: number;
    consumption: number;
    losses: number;
    adjustments: number;
  };
  /** Painel de fechamento do CMV pela composição (somente no critério composição). */
  children?: ReactNode;
  className?: string;
};

/** Comparação e escolha do critério do CMV que entra na DRE. */
export function DreCmvCard({ criterion, onCriterionChange, compositionCmv, stock, children, className }: DreCmvCardProps) {
  const stockReady = !stock.loading && !stock.error && stock.available;
  const difference = stockReady && Number.isFinite(compositionCmv) ? stock.total - compositionCmv : null;
  const differencePct = difference !== null && compositionCmv > 0 ? (difference / compositionCmv) * 100 : null;
  const breakdown = stockReady && stock.total > 0
    ? [
        { key: "consumption", label: "Consumo", value: stock.consumption, className: "bg-ds-ink" },
        { key: "losses", label: "Perdas", value: stock.losses, className: "bg-ds-danger" },
        { key: "adjustments", label: "Ajustes negativos", value: stock.adjustments, className: "bg-ds-accent" },
      ]
    : [];
  const options: Array<{ value: DreCmvCriterion; title: string; hint: string; amount: string }> = [
    { value: "composition", title: "Pela composição", hint: "Fichas × vendas do PDV", amount: money(compositionCmv) ?? "Indisponível" },
    {
      value: "stock_movement",
      title: "Pela movimentação",
      hint: "Saídas reais do estoque",
      amount: stock.loading ? "Calculando…" : stockReady ? (money(stock.total) ?? "Indisponível") : "Indisponível",
    },
  ];
  return (
    <section className={cn("flex flex-col gap-3.5 rounded-ds-card border border-ds-border bg-ds-surface p-5", className)} aria-labelledby="dre-cmv-title">
      <div>
        <h2 id="dre-cmv-title" className="text-[15px] font-extrabold">Critério dos insumos</h2>
        <p className="text-[12.5px] text-ds-ink-muted">Escolha qual CMV entra no resultado</p>
      </div>
      <div role="radiogroup" aria-label="Critério do CMV" className="grid grid-cols-2 gap-2.5">
        {options.map((option) => {
          const active = option.value === criterion;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onCriterionChange(option.value)}
              className={cn(
                "flex min-h-11 flex-col gap-1 rounded-ds-md px-3.5 py-3 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink",
                active ? "border-2 border-ds-accent bg-ds-accent-soft" : "border border-ds-border bg-ds-input hover:bg-ds-muted",
              )}
            >
              <span className={cn("flex justify-between gap-2 text-[12px] font-semibold", active ? "text-ds-accent-ink" : "text-ds-ink-2")}>
                {option.title}{active ? <span>✓ em uso</span> : null}
              </span>
              <span className="font-ds-mono text-[17px] font-bold">{option.amount}</span>
              <span className="text-[12px] text-ds-ink-muted">{option.hint}</span>
            </button>
          );
        })}
      </div>
      {difference !== null ? (
        <p className="text-[13px]">
          <strong className={cn("font-ds-mono", difference > 0 ? "text-ds-alert-ink" : "text-ds-ok")}>
            {difference > 0 ? "+" : "−"}{currency(Math.abs(difference))}{differencePct !== null ? ` (${difference > 0 ? "+" : "−"}${Math.abs(differencePct).toFixed(1).replace(".", ",")}%)` : ""}
          </strong>{" "}
          {difference > 0
            ? "a mais pela movimentação: o estoque saiu mais do que as fichas explicam."
            : difference < 0 ? "a menos pela movimentação: as fichas preveem mais consumo do que o estoque registrou." : "— os dois critérios coincidem."}
        </p>
      ) : stock.error ? (
        <p className="text-[12.5px] text-ds-danger">O CMV pela movimentação não pôde ser calculado: {stock.error}</p>
      ) : null}
      {breakdown.length > 0 ? (
        <div>
          <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={breakdown.map((item) => `${item.label} ${currency(item.value)}`).join(", ")}>
            {breakdown.map((item) => item.value > 0 ? (
              <span key={item.key} className={cn("h-full min-w-[3px]", item.className)} style={{ width: `${(item.value / stock.total) * 100}%` }} />
            ) : null)}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[12px] text-ds-ink-2">
            {breakdown.map((item) => (
              <span key={item.key}><span className={cn("mr-1.5 inline-block h-2 w-2 rounded-[2px]", item.className)} />{item.label}<br /><strong className="font-ds-mono">{currency(item.value)}</strong></span>
            ))}
          </div>
        </div>
      ) : null}
      {children}
      <Disclosure summary="Como cada critério é calculado">
        <p>Composição: enquanto aberto, usa as vendas e os custos atuais das fichas; após a confirmação do fechamento mensal, usa o valor congelado daquela unidade e competência.</p>
        <p>Movimentação: consumo, perdas e ajustes negativos registrados no estoque, valorizados pelo último custo efetivo na data de cada saída. Transferências e movimentos estornados não entram.</p>
      </Disclosure>
    </section>
  );
}
