"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface BulkBarAction {
  label: string
  onClick: () => void
  isDanger?: boolean
}

export interface BulkBarProps {
  count: number
  /** Ex.: "3 selecionados". */
  summary: React.ReactNode
  actions: BulkBarAction[]
  onClear: () => void
}

/** Barra fixa no rodapé da tela com a contagem e as ações em massa (docs/design/listas.md). */
export function BulkBar({ count, summary, actions, onClear }: BulkBarProps) {
  if (count <= 0) return null
  return (
    <div
      role="region"
      aria-label="Ações em massa"
      data-ui="bulk-bar"
      className="fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-24px)] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-ds-card bg-ds-dark py-2 pl-[18px] pr-2 text-white shadow-ds-modal"
    >
      <span className="mr-2 whitespace-nowrap text-[13px] font-bold">{summary}</span>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.onClick}
          className={cn(
            "h-9 whitespace-nowrap rounded-ds-md px-3.5 text-[12.5px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker",
            action.isDanger ? "bg-ds-danger hover:brightness-90" : "bg-white/10 hover:bg-white/20"
          )}
        >
          {action.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="h-9 rounded-ds-md px-2.5 text-[12.5px] font-semibold text-ds-on-dark-sub hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker"
      >
        Limpar
      </button>
    </div>
  )
}
