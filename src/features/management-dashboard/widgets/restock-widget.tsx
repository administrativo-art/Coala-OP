"use client";

import { cn } from "@/lib/utils";

import { widgetIcons } from "./icons";
import { IconChip, KpiTile, Pill, WidgetCard, WidgetEmpty, WidgetHead, type Tone } from "./kit";

export type RestockItem = {
  id: string;
  name: string;
  current: number;
  minimumLabel: string;
  leadTime: number;
  /** Dias até a ruptura pelo consumo médio; null quando não há consumo. */
  daysUntilRupture: number | null;
  ruptureLabel: string;
  orderLimitLabel: string;
  /** Fração do mínimo atendida pelo estoque atual (0 a 1), quando há mínimo numérico. */
  coverage: number | null;
};

export type RestockWidgetProps = {
  unitName: string | null;
  unavailableReason: string | null;
  items: RestockItem[];
};

function urgency(item: RestockItem): { tone: Tone; label: string } {
  if (item.daysUntilRupture === null) return { tone: "neutral", label: "sem consumo" };
  if (item.daysUntilRupture <= 0) return { tone: "danger", label: "hoje" };
  if (item.daysUntilRupture <= 3) return { tone: "warn", label: `${item.daysUntilRupture} d` };
  return { tone: "info", label: `${item.daysUntilRupture} d` };
}

function Row({ item, wide }: { item: RestockItem; wide?: boolean }) {
  const state = urgency(item);
  const bar = state.tone === "danger" ? "bg-ds-danger" : state.tone === "warn" ? "bg-ds-warn" : "bg-ds-info";
  return (
    <li className="flex items-center gap-3 rounded-ds-card border border-ds-divider bg-ds-surface p-3">
      <IconChip icon={item.daysUntilRupture !== null && item.daysUntilRupture <= 0 ? widgetIcons.restock : widgetIcons.inventory} tone={state.tone} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-ds-ink">{item.name}</p>
        <p className="truncate text-xs font-medium text-ds-ink-faint">
          atual {item.current.toLocaleString("pt-BR")} · mín. {item.minimumLabel}
          {wide ? ` · ruptura ${item.ruptureLabel} · pedir até ${item.orderLimitLabel}` : ""}
        </p>
        {item.coverage !== null ? (
          <div className="mt-1.5 h-1.5 rounded-full bg-ds-muted"><div className={cn("h-full rounded-full", bar)} style={{ width: `${Math.max(3, Math.min(100, item.coverage * 100))}%` }} /></div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Pill tone={state.tone}>{state.label}</Pill>
        {item.leadTime > 0 ? <span className="text-[11px] font-semibold text-ds-ink-faint">prazo {item.leadTime} d</span> : null}
      </div>
    </li>
  );
}

export function RestockWidget({ unitName, unavailableReason, items }: RestockWidgetProps) {
  const ruptureNow = items.filter((item) => item.daysUntilRupture !== null && item.daysUntilRupture <= 0).length;
  const soon = items.filter((item) => item.daysUntilRupture !== null && item.daysUntilRupture > 0 && item.daysUntilRupture <= 3).length;
  const watch = items.length - ruptureNow - soon;
  return (
    <WidgetCard widgetId="critical-restock">
      {(density) => (
        <>
          <WidgetHead icon={widgetIcons.restock} tone="warn" title={density === "compact" ? "Reposição" : "Reposição crítica do CD"} subtitle={unitName ? `Itens no mínimo em ${unitName}` : "Itens no mínimo, priorizando lead time"} href="/dashboard/stock/analysis/restock" density={density} />
          {unavailableReason ? (
            <WidgetEmpty>{unavailableReason}</WidgetEmpty>
          ) : items.length === 0 ? (
            <WidgetEmpty>Nenhum item crítico encontrado{unitName ? ` para ${unitName}` : ""}.</WidgetEmpty>
          ) : density === "compact" ? (
            <>
              <div className="flex items-center gap-4">
                <p className={cn("text-5xl font-black leading-none tracking-tight tabular-nums", ruptureNow > 0 ? "text-ds-danger" : "text-ds-ink")}>{ruptureNow > 0 ? ruptureNow : items.length}</p>
                <div className="flex flex-col gap-1.5 text-xs font-semibold text-ds-ink-muted">
                  <span>{ruptureNow > 0 ? "rupturas hoje" : "itens no mínimo"}</span>
                  <Pill tone="warn">{soon} em até 3 dias</Pill>
                </div>
              </div>
              <ul className="space-y-2">{items.slice(0, 2).map((item) => <Row key={item.id} item={item} />)}</ul>
            </>
          ) : density === "medium" ? (
            <>
              <div className="grid grid-cols-3 gap-2.5">
                <KpiTile label="Ruptura hoje" value={String(ruptureNow)} tone={ruptureNow > 0 ? "danger" : "muted"} icon={widgetIcons.restock} />
                <KpiTile label="Até 3 dias" value={String(soon)} tone={soon > 0 ? "warn" : "muted"} icon={widgetIcons.workday} />
                <KpiTile label="Em atenção" value={String(watch)} icon={widgetIcons.inventory} />
              </div>
              <ul className="max-h-[340px] space-y-2 overflow-y-auto pr-1">{items.slice(0, 5).map((item) => <Row key={item.id} item={item} />)}</ul>
            </>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-3">
                <KpiTile label="Itens críticos" value={String(items.length)} icon={widgetIcons.restock} tone="warn" />
                <KpiTile label="Ruptura hoje" value={String(ruptureNow)} tone={ruptureNow > 0 ? "danger" : "muted"} icon={widgetIcons.alerts} />
                <KpiTile label="Até 3 dias" value={String(soon)} tone={soon > 0 ? "warn" : "muted"} icon={widgetIcons.workday} />
                <KpiTile label="Em atenção" value={String(watch)} icon={widgetIcons.inventory} />
              </div>
              <ul className="grid max-h-[420px] grid-cols-2 gap-2.5 overflow-y-auto pr-1">{items.slice(0, 10).map((item) => <Row key={item.id} item={item} wide />)}</ul>
            </>
          )}
        </>
      )}
    </WidgetCard>
  );
}
