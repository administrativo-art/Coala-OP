import * as React from "react"

import { cn } from "@/lib/utils"

/** Caixa de campo do guia (docs/design/campos.md): 40px, raio 11, foco índigo de modal. */
export const fieldInputClass =
  "h-10 w-full rounded-ds-md border border-ds-border-input bg-ds-input px-3 text-[13px] text-ds-ink placeholder:text-ds-ink-faint focus-visible:border-ds-modal focus-visible:bg-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ds-modal-soft focus-visible:ring-offset-0 aria-[invalid=true]:border-[1.5px] aria-[invalid=true]:border-ds-danger"

export interface FieldProps {
  label: string
  /** Id do controle; liga rótulo, dica e erro. */
  htmlFor?: string
  /** Escreve a obrigatoriedade no rótulo quando ela muda por contexto. */
  requirement?: string
  hint?: React.ReactNode
  error?: string | null
  className?: string
  children: React.ReactNode
}

/** Rótulo acima (12/700), controle, dica e erro junto do campo. */
export function Field({ label, htmlFor, requirement, hint, error, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-bold text-ds-ink-2">
        {label}
        {requirement ? <span className="font-semibold text-ds-ink-faint"> ({requirement})</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ds-ink-muted">{hint}</p>
      ) : null}
    </div>
  )
}
