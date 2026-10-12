"use client"

import * as React from "react"

import { Field, fieldInputClass } from "@/components/patterns/field"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

/** Valor reservado para "sem escolha" nos selects, que não aceitam string vazia. */
export const PANEL_NONE = "__none__"

/** Opção de lista com rótulo; usada nos selects dos painéis. */
export interface PanelOption {
  id: string
  name: string
}

export function PanelSelectField({
  id,
  label,
  value,
  onChange,
  options,
  noneLabel,
  hint,
  error,
  requirement,
}: {
  id: string
  label: string
  value: string | null | undefined
  onChange: (value: string) => void
  options: PanelOption[]
  /** Quando omitido, o campo não oferece "sem escolha". */
  noneLabel?: string
  hint?: React.ReactNode
  error?: string | null
  requirement?: string
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} requirement={requirement}>
      <Select value={value || (noneLabel ? PANEL_NONE : "")} onValueChange={(next) => onChange(next === PANEL_NONE ? "" : next)}>
        <SelectTrigger id={id} className={fieldInputClass} aria-invalid={!!error}>
          <SelectValue placeholder={noneLabel ?? "Selecione"} />
        </SelectTrigger>
        <SelectContent>
          {noneLabel ? <SelectItem value={PANEL_NONE}>{noneLabel}</SelectItem> : null}
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

export function PanelSwitchRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string
  label: string
  description?: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-ds-btn-lg border border-ds-border bg-white px-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-bold">{label}</label>
        {description ? <p className="mt-0.5 text-xs text-ds-ink-muted">{description}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

/** Falha de gravação ou de leitura, em texto junto do formulário (docs/design/feedback.md). */
export function PanelErrorNote({ message }: { message: string | null | undefined }) {
  return message ? (
    <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{message}</p>
  ) : null
}

export function PanelFormFooter({
  submitting,
  creating,
  noun,
  onCancel,
}: {
  submitting: boolean
  creating: boolean
  noun: string
  onCancel: () => void
}) {
  return (
    <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
      <Button type="button" variant="ds-secondary" size="md" disabled={submitting} onClick={onCancel}>Cancelar</Button>
      <Button type="submit" variant="primary-modal" size="md" loading={submitting}>{creating ? `Criar ${noun}` : `Salvar ${noun}`}</Button>
    </div>
  )
}

export function errorMessageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
