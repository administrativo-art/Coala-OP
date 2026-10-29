"use client"

import * as React from "react"
import { ArrowDown, ArrowUp } from "lucide-react"

import { cn } from "@/lib/utils"

export type SortDirection = "asc" | "desc"

export interface SortHeaderProps {
  label: string
  /** `true` na coluna que ordena a lista agora. */
  active: boolean
  direction: SortDirection
  onClick: () => void
  className?: string
}

/**
 * Título de coluna que ordena a lista ao clique: o primeiro clique ordena, os seguintes alternam
 * entre crescente e decrescente. Anuncia a ordem com `aria-sort` (docs/design/listas.md).
 */
export function SortHeader({ label, active, direction, onClick, className }: SortHeaderProps) {
  const Arrow = direction === "asc" ? ArrowUp : ArrowDown
  return (
    <span className={className} aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint transition-colors hover:text-ds-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink",
          active && "text-ds-accent-ink",
        )}
      >
        {label}
        {active ? <Arrow aria-hidden="true" className="h-3 w-3" /> : null}
      </button>
    </span>
  )
}
