"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

export interface SidePanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Identificador em rosa (kicker). */
  kicker?: React.ReactNode
  title: React.ReactNode
  /** Linha de especificação sob o nome. */
  subtitle?: React.ReactNode
  /** Números principais no topo escuro. */
  highlights?: React.ReactNode
  children: React.ReactNode
  /** Cabeçalho baixo (sem subtítulo visível), para painéis com muito conteúdo que não deve rolar. */
  compact?: boolean
  className?: string
}

/**
 * Painel lateral de 460px (docs/design/painel-lateral.md). Fecha por ×, véu ou Esc;
 * o Radix prende o foco e o devolve ao gatilho ao fechar.
 */
export function SidePanel({ open, onOpenChange, kicker, title, subtitle, highlights, children, compact, className }: SidePanelProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--ds-scrim)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-ui="side-panel"
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-full flex-col bg-ds-warm font-ds shadow-ds-side outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-200",
            className
          )}
        >
          <header className={cn("relative bg-ds-dark px-6 text-ds-on-dark", compact ? "py-3.5" : "py-[22px]")}>
            {kicker && (
              <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">{kicker}</p>
            )}
            <DialogPrimitive.Title className={cn("pr-8 font-extrabold", compact ? "mt-0.5 text-lg" : "mt-1 text-xl")}>{title}</DialogPrimitive.Title>
            {subtitle ? (
              <DialogPrimitive.Description className={compact ? "sr-only" : "mt-0.5 text-[12.5px] text-ds-on-dark-sub"}>{subtitle}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">Detalhes do item</DialogPrimitive.Description>
            )}
            {highlights && <div className="mt-4 flex gap-6 text-[26px] font-extrabold">{highlights}</div>}
            <DialogPrimitive.Close
              aria-label="Fechar"
              className="absolute right-4 top-4 rounded-ds-sm p-1.5 text-ds-on-dark-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </DialogPrimitive.Close>
          </header>
          <div className={cn("flex flex-1 flex-col overflow-y-auto px-6", compact ? "gap-3.5 py-4" : "gap-5 py-5")}>{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** Par kicker + valor da grade de dados (2 colunas). */
export function PanelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">{label}</p>
      <div className="mt-0.5 text-[13px] font-semibold text-ds-ink">{children}</div>
    </div>
  )
}

/** Seção do corpo do painel: cartão com título em kicker e o conteúdo do assunto (docs/design/painel-lateral.md). */
export function PanelSection({
  title,
  aside,
  children,
}: {
  title: string
  /** Contagem ou apoio à direita do título. */
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section data-ui="panel-section" className="rounded-ds-btn-lg border border-ds-border bg-ds-surface">
      <header className="flex items-baseline justify-between gap-3 border-b border-ds-divider px-4 py-2.5">
        <h3 className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">{title}</h3>
        {aside ? <span className="text-[11.5px] text-ds-ink-faint">{aside}</span> : null}
      </header>
      <div className="space-y-3.5 px-4 py-3.5">{children}</div>
    </section>
  )
}
