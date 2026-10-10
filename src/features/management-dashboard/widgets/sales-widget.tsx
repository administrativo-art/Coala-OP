"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { widgetIcons } from "./icons";
import { DetailsLink, KpiTile, WidgetCard, WidgetEmpty, WidgetHead } from "./kit";

export type SalesItem = { name: string; quantity: number; previous: number; sameElapsedCurrent: number; sameElapsedPrevious: number };

export type SalesWidgetProps = {
  items: SalesItem[];
  totalQuantity: number;
  periodLabel: string;
  /** Seletor de unidade já montado pelo chamador (Select do design system). */
  unitFilter: ReactNode;
  onDetails: () => void;
};

const nf = new Intl.NumberFormat("pt-BR");
const signed = (value: number) => `${value >= 0 ? "+" : ""}${nf.format(value)}`;

function Rank({ index }: { index: number }) {
  return (
    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black", index === 0 ? "bg-ds-accent text-white" : index === 1 ? "bg-ds-warn-bg text-ds-warn" : index === 2 ? "bg-ds-info-bg text-ds-info" : "bg-ds-muted text-ds-ink-faint")}>
      {index + 1}
    </span>
  );
}

export function SalesWidget({ items, totalQuantity, periodLabel, unitFilter, onDetails }: SalesWidgetProps) {
  const leader = items[0];
  const max = Math.max(...items.map((item) => item.quantity), 1);
  const share = leader && totalQuantity > 0 ? leader.quantity / totalQuantity : 0;
  return (
    <WidgetCard widgetId="best-sellers">
      {(density) => (
        <>
          <WidgetHead icon={widgetIcons.sales} tone="accent" title={density === "compact" ? "Mais vendidas" : "Mercadorias mais vendidas"} subtitle={periodLabel} href="/dashboard/stock/analysis/sales" density={density} />
          {density !== "compact" ? unitFilter : null}
          {!leader ? (
            <WidgetEmpty>Nenhuma venda consolidada para exibir.</WidgetEmpty>
          ) : density === "compact" ? (
            <>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-black tracking-tight tabular-nums text-ds-accent-ink">{Math.round(share * 100)}%</span>
                <span className="min-w-0 text-xs font-medium leading-snug text-ds-ink-muted">dos itens são<br /><b className="font-extrabold text-ds-ink">{leader.name}</b></span>
              </div>
              <ul className="space-y-2.5">
                {items.slice(0, 3).map((item, index) => (
                  <li key={item.name} className="flex items-center gap-2.5">
                    <Rank index={index} />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2 text-xs"><span className="truncate font-semibold text-ds-ink">{item.name}</span><b className="tabular-nums text-ds-ink">{nf.format(item.quantity)}</b></div>
                      <div className="mt-1 h-1.5 rounded-full bg-ds-muted"><div className={cn("h-full rounded-full", index === 0 ? "bg-ds-accent" : "bg-ds-border")} style={{ width: `${Math.max(6, (item.quantity / max) * 100)}%` }} /></div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              {density === "wide" ? (
                <div className="grid grid-cols-3 gap-3">
                  <KpiTile label="Itens vendidos" value={nf.format(totalQuantity)} icon={widgetIcons.inventory} />
                  <KpiTile label="Líder do período" value={leader.name} note={`${Math.round(share * 100)}% dos itens`} tone="accent" icon={widgetIcons.sales} />
                  <KpiTile label="Variação do líder" value={signed(leader.quantity - leader.previous)} note="vs. mês anterior" tone={leader.quantity >= leader.previous ? "ok" : "danger"} icon={widgetIcons.income} />
                </div>
              ) : null}
              <ul className={cn("gap-2.5", density === "wide" ? "grid grid-cols-2" : "space-y-2.5")}>
                {items.slice(0, density === "wide" ? 8 : 5).map((item, index) => {
                  const delta = item.quantity - item.previous;
                  const periodDelta = item.sameElapsedCurrent - item.sameElapsedPrevious;
                  return (
                    <li key={item.name} className="flex items-center gap-3 rounded-ds-card border border-ds-divider bg-ds-surface p-3">
                      <Rank index={index} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-extrabold text-ds-ink">{item.name}</p>
                        <div className="mt-1.5 h-1.5 rounded-full bg-ds-muted"><div className="h-full rounded-full bg-ds-accent" style={{ width: `${Math.max(8, (item.quantity / max) * 100)}%` }} /></div>
                        <p className="mt-1 truncate text-[11px] font-medium text-ds-ink-faint">mês ant. {nf.format(item.previous)} · período {nf.format(item.sameElapsedCurrent)} vs {nf.format(item.sameElapsedPrevious)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-base font-black tabular-nums text-ds-ink">{nf.format(item.quantity)}</p>
                        <p className={cn("text-xs font-bold tabular-nums", delta >= 0 ? "text-ds-ok" : "text-ds-danger")}>{signed(delta)}</p>
                        <p className={cn("text-[11px] font-bold tabular-nums", periodDelta >= 0 ? "text-ds-ok" : "text-ds-danger")}>per. {signed(periodDelta)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {leader ? <DetailsLink onClick={onDetails}>Ver lista completa</DetailsLink> : null}
        </>
      )}
    </WidgetCard>
  );
}
