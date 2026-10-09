"use client";

import type { ElementType } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { KpiTile, TileLink, WidgetCard, WidgetHead, toneClass, IconChip, type Tone } from "./kit";
import type { ManagementWidgetId } from "../types";

export type HubLink = { label: string; description: string; href: string; icon: ElementType; tone: Tone; badge?: number | null };
export type HubKpi = { label: string; value: string; note?: string; tone?: Tone; icon?: ElementType };
export type HubAttention = { title: string; text: string; href: string; tone: Tone; icon: ElementType };

export type HubWidgetProps = {
  widgetId: ManagementWidgetId;
  title: string;
  compactTitle?: string;
  subtitle: string;
  href: string;
  icon: ElementType;
  tone: Tone;
  links: HubLink[];
  kpis?: HubKpi[];
  attention?: HubAttention[];
  /** Frase curta do estado geral, mostrada no tamanho compacto. */
  status?: { tone: Tone; label: string } | null;
};

function AttentionList({ items }: { items: HubAttention[] }) {
  if (items.length === 0) return <p className="rounded-ds-card border border-dashed border-ds-border px-3 py-4 text-xs font-medium text-ds-ink-faint">Nada pedindo ação agora.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.slice(0, 4).map((item) => (
        <li key={item.title}>
          <Link href={item.href} className={cn("flex items-center gap-2.5 rounded-ds-card p-3 transition-opacity hover:opacity-90", toneClass[item.tone].soft)}>
            <IconChip icon={item.icon} tone={item.tone} size="sm" />
            <span className="min-w-0">
              <span className={cn("block truncate text-sm font-extrabold", toneClass[item.tone].ink)}>{item.title}</span>
              <span className="block truncate text-xs font-medium text-ds-ink-muted">{item.text}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function HubWidget({ widgetId, title, compactTitle, subtitle, href, icon, tone, links, kpis = [], attention = [], status }: HubWidgetProps) {
  return (
    <WidgetCard widgetId={widgetId}>
      {(density) => (
        <>
          <WidgetHead icon={icon} tone={tone} title={density === "compact" ? compactTitle ?? title : title} subtitle={subtitle} href={href} density={density} />
          {density === "compact" ? (
            <>
              {status ? <div><span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold", toneClass[status.tone].soft, toneClass[status.tone].ink)}><span className={cn("h-1.5 w-1.5 rounded-full", toneClass[status.tone].solid)} />{status.label}</span></div> : null}
              <div className="grid grid-cols-2 gap-2.5">{links.slice(0, 4).map((link) => <TileLink key={link.href + link.label} {...link} />)}</div>
            </>
          ) : density === "medium" ? (
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="grid grid-cols-2 gap-2.5">{links.slice(0, 6).map((link) => <TileLink key={link.href + link.label} {...link} />)}</div>
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-extrabold text-ds-ink">Atenção hoje</h4>
                <AttentionList items={attention} />
              </div>
            </div>
          ) : (
            <>
              {kpis.length > 0 ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{kpis.slice(0, 4).map((kpi) => <KpiTile key={kpi.label} {...kpi} />)}</div> : null}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{links.slice(0, 8).map((link) => <TileLink key={link.href + link.label} {...link} large />)}</div>
                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-extrabold text-ds-ink">Atenção hoje</h4>
                  <AttentionList items={attention} />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </WidgetCard>
  );
}
