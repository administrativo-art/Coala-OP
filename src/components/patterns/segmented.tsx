"use client"

import * as React from "react"

import { nextSegmentedIndex } from "@/components/patterns/segmented-navigation"
import { cn } from "@/lib/utils"

export interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
}

export interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  "aria-label"?: string
  className?: string
}

/** 2–3 opções exclusivas com troca imediata (docs/design/selecao-e-filtros.md). */
export function Segmented<T extends string>({ value, onChange, options, className, ...rest }: SegmentedProps<T>) {
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  const selectAt = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    optionRefs.current[index]?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = nextSegmentedIndex(event.key, index, options.length)
    if (nextIndex == null) return
    event.preventDefault()
    selectAt(nextIndex)
  }

  return (
    <div
      role="radiogroup"
      aria-label={rest["aria-label"]}
      className={cn("inline-flex rounded-ds-md bg-ds-seg p-[3px]", className)}
    >
      {options.map((o, index) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            ref={(node) => { optionRefs.current[index] = node }}
            onClick={() => onChange(o.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "h-8 whitespace-nowrap rounded-ds-sm px-[14px] text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2",
              active ? "bg-white text-ds-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-ds-ink-muted hover:text-ds-ink"
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
