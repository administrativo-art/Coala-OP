"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Check, X } from "lucide-react"

import { InlineConfirm } from "@/components/patterns/inline-confirm"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface WizardStep {
  id: string
  label: string
  description?: string
  summary?: React.ReactNode
  hidden?: boolean
  valid?: boolean
}

export interface WizardModalProps {
  open: boolean
  onOpenChange?: (open: boolean) => void
  /** Compatibilidade com o scaffold inicial. Prefira `onOpenChange`. */
  onClose?: () => void
  mode?: "new" | "edit"
  readOnly?: boolean
  stepper?: "sidebar" | "top"
  saveMode?: "final" | "per-step"
  sidebarWidth?: 340 | 360 | 380
  height?: "auto" | 780 | 800 | 820
  steps: WizardStep[]
  stepIndex: number
  highestStep?: number
  onStepChange: (index: number) => void
  /** Valida a etapa atual; o erro deve ser apresentado junto do campo. */
  onValidateStep?: (index: number) => boolean
  submitLabel: string
  onSubmit: () => void
  onSaveStep?: (index: number) => void
  onEdit?: (index: number) => void
  editLabel?: string
  submitting?: boolean
  dirty?: boolean
  sidebar: React.ReactNode
  title: string
  description?: string
  headerActions?: React.ReactNode
  footerNote?: React.ReactNode
  children: React.ReactNode
}

type PendingAction = { type: "close" } | { type: "step"; index: number } | null

const sidebarGridClasses: Record<NonNullable<WizardModalProps["sidebarWidth"]>, string> = {
  340: "md:grid-cols-[340px_minmax(0,1fr)]",
  360: "md:grid-cols-[360px_minmax(0,1fr)]",
  380: "md:grid-cols-[380px_minmax(0,1fr)]",
}

const modalHeightClasses: Record<NonNullable<WizardModalProps["height"]>, string> = {
  auto: "max-h-[calc(100vh-48px)]",
  780: "h-[min(780px,calc(100vh-48px))]",
  800: "h-[min(800px,calc(100vh-48px))]",
  820: "h-[min(820px,calc(100vh-48px))]",
}

/** Casca compartilhada e demonstrável dos modais em etapas descritos em docs/design/modais.md. */
export function WizardModal({
  open,
  onOpenChange,
  onClose,
  mode = "edit",
  readOnly = false,
  stepper = "sidebar",
  saveMode = "final",
  sidebarWidth = 360,
  height = 800,
  steps,
  stepIndex,
  highestStep = stepIndex,
  onStepChange,
  onValidateStep,
  submitLabel,
  onSubmit,
  onSaveStep,
  onEdit,
  editLabel = "Editar",
  submitting,
  dirty,
  sidebar,
  title,
  description,
  headerActions,
  footerNote,
  children,
}: WizardModalProps) {
  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null)
  const closeButtonRef = React.useRef<HTMLButtonElement>(null)
  const pendingReturnFocusRef = React.useRef<HTMLElement | null>(null)
  const visibleSteps = React.useMemo(() => steps.filter((candidate) => !candidate.hidden), [steps])
  const currentStep = visibleSteps[stepIndex]
  const last = stepIndex === visibleSteps.length - 1

  const closeNow = () => {
    setPendingAction(null)
    if (onOpenChange) onOpenChange(false)
    else onClose?.()
  }

  const requestClose = () => {
    if (dirty && !readOnly) {
      if (document.activeElement instanceof HTMLElement) pendingReturnFocusRef.current = document.activeElement
      setPendingAction({ type: "close" })
    }
    else closeNow()
  }

  const changeStepNow = (index: number) => {
    setPendingAction(null)
    onStepChange(index)
  }

  const requestStepChange = (index: number) => {
    if (index === stepIndex) return
    if (dirty && saveMode === "per-step" && !readOnly) {
      if (document.activeElement instanceof HTMLElement) pendingReturnFocusRef.current = document.activeElement
      setPendingAction({ type: "step", index })
      return
    }
    changeStepNow(index)
  }

  const advance = () => {
    if (onValidateStep && !onValidateStep(stepIndex)) return
    if (last) onSubmit()
    else changeStepNow(stepIndex + 1)
  }

  const saveCurrentStep = () => {
    if (onValidateStep && !onValidateStep(stepIndex)) return
    onSaveStep?.(stepIndex)
  }

  const confirmPendingAction = () => {
    if (pendingAction?.type === "step") changeStepNow(pendingAction.index)
    else closeNow()
  }

  const renderStepButton = (step: WizardStep, index: number, placement: "top" | "sidebar") => {
    const current = index === stepIndex
    const complete = index < stepIndex && mode === "new"
    const blocked = !readOnly && mode === "new" && index > highestStep

    return (
      <li key={step.id} className={cn(placement === "top" && "min-w-0 flex-1")}>
        <button
          type="button"
          disabled={blocked}
          aria-current={current ? "step" : undefined}
          onClick={() => requestStepChange(index)}
          className={cn(
            "w-full rounded-ds-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker focus-visible:ring-offset-2",
            placement === "sidebar" && "flex items-start gap-3 px-3 py-2.5 focus-visible:ring-offset-ds-dark",
            placement === "sidebar" && current && "bg-white/[.08]",
            placement === "sidebar" && blocked && "cursor-not-allowed opacity-45",
            placement === "top" && "block"
          )}
        >
          {placement === "top" ? (
            <>
              <span className={cn("block h-1 rounded-ds-pill", current || complete ? "bg-ds-modal" : "bg-ds-border")} />
              <span className={cn("mt-2 block truncate text-xs", current ? "font-bold text-ds-modal" : "font-semibold text-ds-ink-muted")}>
                {complete ? "✓" : String(index + 1).padStart(2, "0")} {step.label}
              </span>
            </>
          ) : (
            <>
              <span className={cn(
                "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-ds-pill border text-[11px] font-extrabold",
                current ? "border-ds-modal bg-ds-modal text-white" : "border-white/[.14] text-ds-on-dark-2"
              )}>
                {complete ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0">
                <span className={cn("block truncate text-[13.5px] font-bold", current ? "text-ds-on-dark" : "text-ds-on-dark-2")}>{step.label}</span>
                {step.summary && <span className="block truncate text-[11.5px] text-ds-on-dark-muted">{step.summary}</span>}
              </span>
            </>
          )}
        </button>
      </li>
    )
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) requestClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--ds-scrim)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-ui="wizard-modal"
          className={cn(
            "fixed left-1/2 top-1/2 z-50 grid w-[min(1080px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 grid-cols-1 overflow-hidden rounded-ds-modal bg-ds-input font-ds shadow-ds-modal outline-none",
            sidebarGridClasses[sidebarWidth],
            modalHeightClasses[height]
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{description ?? "Formulário em etapas"}</DialogPrimitive.Description>

          <aside className="hidden min-h-0 flex-col gap-6 overflow-y-auto bg-ds-dark px-7 py-[30px] text-ds-on-dark md:flex">
            {sidebar}
            {stepper === "sidebar" && !readOnly && (
              <nav aria-label="Etapas do cadastro">
                <div className="mb-2 flex items-center justify-between gap-2 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">
                  <span>Etapa {stepIndex + 1} de {visibleSteps.length}</span>
                  {mode === "edit" && saveMode === "per-step" && <span>salva por etapa</span>}
                </div>
                <ol className="space-y-1">{visibleSteps.map((candidate, index) => renderStepButton(candidate, index, "sidebar"))}</ol>
              </nav>
            )}
            {footerNote && <div className="mt-auto text-[11.5px] text-ds-on-dark-muted">{footerNote}</div>}
          </aside>

          <div className="flex min-h-0 flex-col">
            {stepper === "top" && !readOnly ? (
              <header className="flex items-start gap-4 border-b border-ds-border-footer px-7 pb-[18px] pt-6">
                <nav aria-label="Etapas do cadastro" className="min-w-0 flex-1">
                  <ol className="flex gap-2">{visibleSteps.map((candidate, index) => renderStepButton(candidate, index, "top"))}</ol>
                </nav>
                <button
                  ref={closeButtonRef}
                  type="button"
                  aria-label="Fechar"
                  onClick={requestClose}
                  className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-ds-pill bg-ds-muted text-ds-ink-muted hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </header>
            ) : (
              <header className="border-b border-ds-border-footer px-7 pb-[18px] pt-[22px]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-[21px] font-extrabold tracking-[-0.02em] text-ds-ink">{currentStep?.label ?? title}</h3>
                    {(currentStep?.description || description) && <p className="mt-0.5 text-[13px] text-ds-ink-muted">{currentStep?.description ?? description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {headerActions}
                    <button
                      ref={closeButtonRef}
                      type="button"
                      aria-label="Fechar"
                      onClick={requestClose}
                      className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-ds-pill bg-ds-muted text-ds-ink-muted hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2"
                    >
                      <X aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {stepper === "sidebar" && !readOnly && (
                  <nav aria-label="Etapas do cadastro" className="mt-4 md:hidden">
                    <ol className="flex gap-2">{visibleSteps.map((candidate, index) => renderStepButton(candidate, index, "top"))}</ol>
                  </nav>
                )}
              </header>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-7 py-[22px]">{children}</div>

            <footer className="border-t border-ds-border-footer bg-ds-input px-7 py-4">
              {pendingAction ? (
                <InlineConfirm
                  message={pendingAction.type === "close" ? "Descartar as alterações não salvas?" : "Trocar de etapa e descartar as alterações não salvas?"}
                  confirmLabel="Descartar"
                  cancelLabel="Continuar editando"
                  onCancel={() => setPendingAction(null)}
                  onConfirm={confirmPendingAction}
                  returnFocusRef={pendingReturnFocusRef}
                />
              ) : readOnly ? (
                <div className="flex justify-end">
                  <Button type="button" variant="ds-secondary" size="lg" onClick={() => onEdit?.(stepIndex)}>{editLabel}</Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    {stepIndex === 0 && saveMode === "final" ? (
                      <Button type="button" variant="ds-ghost" size="lg" onClick={requestClose}>Cancelar</Button>
                    ) : (
                      <Button type="button" variant="ds-secondary" size="lg" disabled={stepIndex === 0} onClick={() => requestStepChange(stepIndex - 1)}>← Voltar</Button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {saveMode === "per-step" && mode === "edit" ? (
                      <>
                        <span className="hidden text-xs text-ds-ink-muted sm:inline">As alterações desta etapa são salvas separadamente.</span>
                        {!last && <Button type="button" variant="ds-ghost" size="lg" onClick={() => requestStepChange(stepIndex + 1)}>Próxima etapa →</Button>}
                        <Button type="button" variant="primary-modal" size="lg" loading={submitting} onClick={saveCurrentStep}>Salvar etapa</Button>
                      </>
                    ) : (
                      <Button type="button" variant="primary-modal" size="lg" loading={submitting} onClick={advance}>
                        {last ? submitLabel : "Avançar →"}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </footer>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
