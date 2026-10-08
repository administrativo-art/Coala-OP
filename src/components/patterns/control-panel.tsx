import * as React from "react"

import { cn } from "@/lib/utils"

/** Painel escuro do topo: tudo que filtra a lista fica aqui (docs/design/README.md). */
export function ControlPanel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      data-ui="control-panel"
      className={cn("rounded-ds-panel bg-ds-dark p-6 text-ds-on-dark shadow-ds-panel", className)}
      {...props}
    />
  )
}

export interface IndicatorProps {
  value: React.ReactNode
  label: string
  tone: "warning" | "danger" | "info" | "neutral"
  active?: boolean
  onClick?: () => void
}

/** Indicador que funciona como filtro. Ativo: borda inferior 2px e "filtrando". */
const indicatorToneClasses: Record<IndicatorProps["tone"], { value: string; border: string }> = {
  warning: { value: "text-ds-warn", border: "border-ds-warn" },
  danger: { value: "text-ds-danger", border: "border-ds-danger" },
  info: { value: "text-ds-info", border: "border-ds-info" },
  neutral: { value: "text-ds-on-dark-2", border: "border-ds-on-dark-muted" },
}

export function ControlIndicator({ value, label, tone, active, onClick }: IndicatorProps) {
  const zero = value === 0 || value === "0"
  const toneClasses = indicatorToneClasses[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "border-b-2 border-transparent px-4 py-3 text-left transition-colors hover:bg-white/[.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker focus-visible:ring-offset-2 focus-visible:ring-offset-ds-dark",
        active && ["bg-white/[.05]", toneClasses.border]
      )}
    >
      <div className={cn("text-[34px] font-extrabold leading-none tracking-[-0.04em]", zero ? "text-ds-indicator-zero" : toneClasses.value)}>
        {value}
      </div>
      <div className="mt-1 text-[13px] font-bold text-ds-on-dark-2">{label}</div>
      {active && <div className="mt-0.5 text-[11px] font-bold text-ds-on-dark-muted">filtrando</div>}
    </button>
  )
}
