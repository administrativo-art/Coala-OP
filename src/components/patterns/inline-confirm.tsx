"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface InlineConfirmProps {
  /** Ex.: "Excluir o lote SJ-2409-118? Esta ação não pode ser desfeita." */
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
  /** Elemento que recupera o foco quando a confirmação sai da árvore. */
  returnFocusRef?: React.RefObject<HTMLElement | null>
  className?: string
}

/** Confirmação destrutiva no próprio lugar (docs/design/feedback.md). Nunca `confirm()`. */
export function InlineConfirm({
  message,
  confirmLabel = "Excluir",
  cancelLabel = "Cancelar",
  loading,
  onConfirm,
  onCancel,
  returnFocusRef,
  className,
}: InlineConfirmProps) {
  const messageId = React.useId()
  const cancelRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    const returnFocusElement = returnFocusRef?.current
    cancelRef.current?.focus()
    return () => returnFocusElement?.focus()
  }, [returnFocusRef])

  return (
    <div
      role="group"
      aria-labelledby={messageId}
      data-ui="inline-confirm"
      className={cn(
        "flex items-center justify-between gap-3 rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-[14px] py-3",
        className
      )}
    >
      <p id={messageId} aria-live="polite" className="text-[12.5px] font-semibold text-ds-confirm-ink">{message}</p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          ref={cancelRef}
          onClick={onCancel}
          disabled={loading}
          className="h-8 rounded-ds-sm border border-ds-confirm-border bg-white px-3 text-xs font-bold text-ds-confirm-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2"
        >
          {cancelLabel}
        </button>
        <Button type="button" variant="danger" size="xs" loading={loading} loadingLabel="Excluindo…" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}
