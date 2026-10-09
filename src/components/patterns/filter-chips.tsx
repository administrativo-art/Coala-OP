"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface FilterChip {
  value: string
  label: string
  count?: number
}

export interface FilterChipsProps {
  chips: FilterChip[]
  /** `null` = "Todas". */
  value: string | null
  onChange: (value: string | null) => void
  allLabel?: string
  allCount?: number
  className?: string
}

/** Chips de categoria sobre o painel escuro. Um ativo por vez; "Todas" primeiro. */
export function FilterChips({ chips, value, onChange, allLabel = "Todas", allCount, className }: FilterChipsProps) {
  const items: FilterChip[] = [{ value: "", label: allLabel, count: allCount }, ...chips]
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {items.map((c) => {
        const active = (c.value || null) === value
        return (
          <button
            key={c.value || "__all"}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(c.value || null)}
            className={cn(
              "inline-flex h-[34px] items-center gap-2 whitespace-nowrap rounded-ds-pill border px-[14px] text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker focus-visible:ring-offset-2 focus-visible:ring-offset-ds-dark",
              active
                ? "border-ds-accent bg-ds-accent text-white"
                : "border-white/[.12] text-ds-on-dark-2 hover:bg-white/[.06]"
            )}
          >
            {c.label}
            {c.count != null && <span className="text-[11.5px] font-extrabold opacity-80">{c.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
