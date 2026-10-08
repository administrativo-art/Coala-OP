"use client"

import * as React from "react"
import { Search, X } from "lucide-react"

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

export interface ControlSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Chamado ao pressionar Enter; use quando a busca consulta o servidor. */
  onSubmit?: () => void
  className?: string
}

/** Busca do painel escuro (docs/design/campos.md): 48px, raio 14, ícone à esquerda e limpar à direita. */
export function ControlSearch({ value, onChange, placeholder, onSubmit, className }: ControlSearchProps) {
  return (
    <label
      className={cn(
        "flex h-12 min-w-[260px] flex-1 items-center gap-3 rounded-ds-btn-lg border border-white/10 bg-white/[0.07] px-[18px] focus-within:ring-2 focus-within:ring-ds-accent-kicker",
        className
      )}
    >
      <Search aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-ds-on-dark-muted" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit?.()
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 border-none bg-transparent text-[14.5px] text-white outline-none placeholder:text-ds-on-dark-muted"
      />
      {value ? (
        <button type="button" onClick={() => onChange("")} aria-label="Limpar busca" className="text-ds-on-dark-muted hover:text-white">
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : null}
    </label>
  )
}
