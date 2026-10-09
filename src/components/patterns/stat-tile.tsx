import * as React from "react"

import { cn } from "@/lib/utils"

export interface StatTileProps {
  label: string
  value: React.ReactNode
  /** Apoio abaixo do número. */
  hint?: React.ReactNode
  className?: string
}

/** Número de resumo sobre fundo claro: kicker, valor 30/800 e apoio opcional. */
export function StatTile({ label, value, hint, className }: StatTileProps) {
  return (
    <div data-ui="stat-tile" className={cn("rounded-ds-btn-lg border border-ds-border bg-ds-surface px-4 py-3.5", className)}>
      <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">{label}</p>
      <p className="mt-1 text-[30px] font-extrabold leading-none tracking-[-0.03em]">{value}</p>
      {hint ? <p className="mt-1.5 text-xs text-ds-ink-muted">{hint}</p> : null}
    </div>
  )
}
