"use client";

import Link from "next/link";
import { createContext, useContext, useLayoutEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

import { ManagementWidgetFrame } from "../builder-context";
import type { ManagementWidgetId } from "../types";
import { densityFromWidth, type WidgetDensity } from "./density";

export type Tone = "accent" | "ok" | "warn" | "danger" | "info" | "neutral" | "muted";

export const toneClass: Record<Tone, { soft: string; ink: string; solid: string; ring: string }> = {
  accent: { soft: "bg-ds-accent-soft", ink: "text-ds-accent-ink", solid: "bg-ds-accent", ring: "border-ds-accent" },
  ok: { soft: "bg-ds-ok-bg", ink: "text-ds-ok", solid: "bg-ds-ok", ring: "border-ds-ok" },
  warn: { soft: "bg-ds-warn-bg", ink: "text-ds-warn", solid: "bg-ds-warn", ring: "border-ds-warn" },
  danger: { soft: "bg-ds-danger-bg", ink: "text-ds-danger", solid: "bg-ds-danger", ring: "border-ds-danger" },
  info: { soft: "bg-ds-info-bg", ink: "text-ds-info", solid: "bg-ds-info", ring: "border-ds-info" },
  neutral: { soft: "bg-ds-neutral-bg", ink: "text-ds-neutral", solid: "bg-ds-neutral", ring: "border-ds-neutral" },
  muted: { soft: "bg-ds-muted", ink: "text-ds-ink-muted", solid: "bg-ds-ink-faint", ring: "border-ds-border" },
};

/** Força uma densidade (testes e miniaturas do mapa do painel); sem ela o cartão mede a própria largura. */
export const WidgetDensityOverride = createContext<WidgetDensity | null>(null);

/** Cartão do widget: mede a própria largura e entrega a densidade (compacto, médio ou amplo) a quem desenha. */
export function WidgetCard({ widgetId, className, children }: { widgetId: ManagementWidgetId; className?: string; children: (density: WidgetDensity) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const forced = useContext(WidgetDensityOverride);
  const [measured, setMeasured] = useState<WidgetDensity>("medium");
  const density = forced ?? measured;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setMeasured(densityFromWidth(node.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <ManagementWidgetFrame id={widgetId} className={className}>
      <div
        ref={ref}
        data-density={density}
        className={cn(
          "flex flex-col overflow-hidden rounded-ds-card-lg border border-ds-border bg-ds-surface shadow-sm",
          density === "compact" ? "gap-3 p-4" : density === "medium" ? "gap-4 p-5" : "gap-4 p-6",
        )}
      >
        {children(density)}
      </div>
    </ManagementWidgetFrame>
  );
}

export function IconChip({ icon: Icon, tone = "accent", size = "md" }: { icon: ElementType; tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const box = size === "sm" ? "h-7 w-7 rounded-lg" : size === "lg" ? "h-10 w-10 rounded-xl" : "h-9 w-9 rounded-xl";
  const glyph = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-5 w-5" : "h-[18px] w-[18px]";
  return (
    <span className={cn("flex shrink-0 items-center justify-center", box, toneClass[tone].soft, toneClass[tone].ink)}>
      <Icon className={glyph} aria-hidden="true" />
    </span>
  );
}

export function Pill({ tone = "muted", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  const base = tone === "accent" || tone === "muted" ? cn(toneClass[tone].soft, toneClass[tone].ink) : null;
  const inner = (
    <>
      {dot ? <span className={cn("mr-1.5 h-1.5 w-1.5 rounded-full", toneClass[tone].solid)} /> : null}
      {children}
    </>
  );
  // ok/warn/danger/info/neutral reaproveitam o StatusPill do design system; accent/muted não existem lá.
  return base ? (
    <span className={cn("inline-flex h-[21px] items-center whitespace-nowrap rounded-full px-[9px] text-[11.5px] font-bold", base, className)}>{inner}</span>
  ) : (
    <StatusPill variant={tone as StatusPillVariant} className={className}>{inner}</StatusPill>
  );
}

export function WidgetHead({ icon, tone, title, subtitle, href, density, aside }: { icon: ElementType; tone?: Tone; title: string; subtitle?: string; href?: string; density: WidgetDensity; aside?: ReactNode }) {
  const compact = density === "compact";
  return (
    <div className="flex items-center gap-3">
      <IconChip icon={icon} tone={tone} size={compact ? "md" : "lg"} />
      <div className="min-w-0 flex-1">
        <h3 className={cn("truncate font-extrabold tracking-tight text-ds-ink", compact ? "text-sm" : "text-base")}>{title}</h3>
        {subtitle ? <p className="truncate text-xs font-medium text-ds-ink-muted">{subtitle}</p> : null}
      </div>
      {aside}
      {href ? (
        <Link href={href} aria-label={`Abrir ${title}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ds-btn border border-ds-border text-ds-ink-muted transition-colors hover:bg-ds-muted hover:text-ds-ink">
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  );
}

export function KpiTile({ label, value, note, tone = "muted", icon: Icon }: { label: string; value: string; note?: string; tone?: Tone; icon?: ElementType }) {
  return (
    <div className={cn("flex min-w-0 flex-col justify-between gap-2 rounded-ds-card p-3.5", toneClass[tone].soft)}>
      <div className={cn("flex items-center gap-1.5 text-xs font-bold", tone === "muted" ? "text-ds-ink-muted" : toneClass[tone].ink)}>
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className={cn("whitespace-nowrap text-xl font-black tracking-tight tabular-nums", tone === "muted" ? "text-ds-ink" : toneClass[tone].ink)}>{value}</span>
        {note ? <span className="min-w-0 truncate text-xs font-medium text-ds-ink-muted">{note}</span> : null}
      </div>
    </div>
  );
}

export function TileLink({ href, icon, label, description, badge, tone = "accent", large }: { href: string; icon: ElementType; label: string; description?: string; badge?: number | null; tone?: Tone; large?: boolean }) {
  return (
    <Link href={href} className={cn("group relative flex min-w-0 flex-col justify-between rounded-ds-card border border-ds-divider bg-ds-muted transition-colors hover:border-ds-border hover:bg-ds-divider", large ? "gap-6 p-4" : "gap-4 p-3")}>
      <IconChip icon={icon} tone={tone} size={large ? "lg" : "md"} />
      {badge ? (
        <span className={cn("absolute right-3 top-3 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-black tabular-nums text-white", toneClass[tone].solid)}>
          {badge}
        </span>
      ) : null}
      <span className="min-w-0">
        <span className="block truncate text-sm font-extrabold text-ds-ink">{label}</span>
        {description ? <span className="mt-0.5 line-clamp-2 block text-xs font-medium leading-snug text-ds-ink-muted">{description}</span> : null}
      </span>
    </Link>
  );
}

export function MeterBar({ value, tone = "accent", markers = [], className }: { value: number; tone?: Tone; markers?: Array<{ at: number; label?: string }>; className?: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className={cn("relative h-2 rounded-full bg-ds-muted", className)} role="img" aria-label={`${Math.round(clamped * 100)}%`}>
      <div className={cn("h-full rounded-full", toneClass[tone].solid)} style={{ width: `${Math.max(2, clamped * 100)}%` }} />
      {markers.map((marker) => (
        <span key={marker.at} className="absolute -top-1 h-4 w-0.5 rounded bg-ds-ink" style={{ left: `${Math.min(100, marker.at * 100)}%` }} title={marker.label} />
      ))}
    </div>
  );
}

export function RingGauge({ value, tone = "accent", children, size = 96 }: { value: number; tone?: Tone; children?: ReactNode; size?: number }) {
  const radius = size / 2 - 8;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={9} className="stroke-ds-muted" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={9} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped)} className={cn(tone === "ok" ? "stroke-ds-ok" : tone === "warn" ? "stroke-ds-warn" : tone === "danger" ? "stroke-ds-danger" : tone === "info" ? "stroke-ds-info" : "stroke-ds-accent")} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function WidgetEmpty({ children }: { children: ReactNode }) {
  return <p className="rounded-ds-card border border-dashed border-ds-border px-3 py-4 text-xs font-medium text-ds-ink-faint">{children}</p>;
}

export function DetailsLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 self-start text-xs font-extrabold text-ds-accent-ink hover:underline">
      {children}
      <ArrowUpRight className="h-3.5 w-3.5" />
    </button>
  );
}
