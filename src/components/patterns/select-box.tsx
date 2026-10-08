"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface SelectBoxProps {
  checked: boolean
  onToggle: () => void
  /** Nome acessível, ex.: "Selecionar Leite integral". */
  label: string
}

/** Caixa de seleção em massa dentro de uma linha clicável (não propaga o clique para a linha). */
export function SelectBox({ checked, onToggle, label }: SelectBoxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      className={cn(
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] p-0 text-[11px] font-extrabold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2",
        checked ? "bg-ds-accent-ink" : "border-[1.5px] border-ds-border-input bg-white"
      )}
    >
      {checked ? "✓" : ""}
    </button>
  )
}
