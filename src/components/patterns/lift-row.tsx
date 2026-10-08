"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface LiftRowProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean
  /** Use em tabelas: scale menor (1.006). */
  table?: boolean
  /** `false` quando a linha contém seus próprios botões/links interativos. */
  interactive?: boolean
}

/**
 * Linha clicável que "sai da lista" no hover (docs/design/listas.md).
 * O contêiner pai não pode ter `overflow: hidden`.
 */
export const LiftRow = React.forwardRef<HTMLDivElement, LiftRowProps>(
  ({ className, selected, table, interactive = true, onKeyDown, onClick, ...props }, ref) => (
    <div
      ref={ref}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      data-ui="lift-row"
      data-selected={selected || undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (interactive && !e.defaultPrevented && e.currentTarget === e.target && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          e.currentTarget.click()
        }
      }}
      className={cn(
        "relative border-b border-ds-divider px-[18px] py-[13px] outline-none",
        interactive && "cursor-pointer",
        "transition-[transform,box-shadow,border-radius,background] duration-[180ms] ease-ds-lift",
        "hover:z-[3] hover:rounded-[14px] hover:bg-ds-surface hover:shadow-ds-lift",
        table
          ? "hover:-translate-y-[3px] hover:scale-[1.006]"
          : "hover:-translate-y-[3px] hover:scale-[1.012]",
        "focus-visible:z-[3] focus-visible:rounded-[14px] focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2",
        "motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100",
        "data-[selected]:bg-ds-accent-row data-[selected]:shadow-[inset_3px_0_0_var(--ds-accent-ink)]",
        className
      )}
      {...props}
    />
  )
)
LiftRow.displayName = "LiftRow"
