import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type HeroChipProps = {
  value: ReactNode;
  label: string;
  tone?: "neutral" | "info" | "warning" | "danger";
  active?: boolean;
  onClick?: () => void;
};

const chipTone: Record<NonNullable<HeroChipProps["tone"]>, string> = {
  neutral: "text-ds-on-dark-2",
  info: "text-ds-info",
  warning: "text-ds-warn",
  danger: "text-ds-danger",
};

/** Indicador compacto do painel escuro (PageHero/PulseHero); quando recebe `onClick`, funciona como filtro. */
export function HeroChip({ value, label, tone = "neutral", active, onClick }: HeroChipProps) {
  const zero = value === 0 || value === "0";
  const content = (
    <>
      <span className={cn("font-ds-mono text-[15px] font-bold leading-none", zero ? "text-ds-indicator-zero" : chipTone[tone])}>{value}</span>
      <span className="text-[13px] font-bold text-ds-on-dark-2">{label}</span>
    </>
  );
  const base = "inline-flex h-9 items-center gap-2 rounded-full px-3.5 ring-1 ring-inset transition-[background,box-shadow,transform] duration-150 motion-reduce:transition-none";
  if (!onClick) return <span className={cn(base, "bg-white/[0.05] ring-white/10")}>{content}</span>;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        base,
        "hover:-translate-y-px hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker motion-reduce:hover:translate-y-0",
        active ? "bg-white/10 ring-2 ring-ds-accent-kicker" : "bg-white/[0.05] ring-white/10",
      )}
    >
      {content}
    </button>
  );
}
