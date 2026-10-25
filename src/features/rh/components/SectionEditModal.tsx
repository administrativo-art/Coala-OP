'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FieldMapEntry, EmployeeFieldValue, RhRole, BizneoEmployeeId } from '@/types/rh';
import { callOnFieldUpdate } from '../lib/rh-client';
import { formatFieldOptionLabel } from '../lib/field-option-labels';
import { getFieldMask } from '../lib/field-masks';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, fieldInputClass } from '@/components/patterns/field';
import { cn } from '@/lib/utils';

type FieldInput = {
  key:   string;
  entry: FieldMapEntry;
  fv?:   EmployeeFieldValue;
};

type Props = {
  employeeId: BizneoEmployeeId;
  editKey:    string;
  /** Campos editados juntos (cartão combinado); sem isso, só `editKey`. */
  editKeys?:  readonly string[];
  /** Título do grupo no cabeçalho, quando há mais de um campo. */
  groupLabel?: string;
  /** Campos preenchidos a partir dos editados, no formato bruto do modal. */
  deriveOnSave?: (values: Record<string, string>) => Record<string, string>;
  fields:     FieldInput[];
  role:       RhRole;
  onClose:    () => void;
  onSaved:    (key: string, value: unknown, completion: number) => void;
};

function parseValue(entry: FieldMapEntry, raw: string): unknown {
  if (entry.type === 'boolean')  return raw === 'true';
  if (entry.type === 'number')   return Number(raw);
  if (entry.type === 'currency') return Math.round(parseFloat(raw) * 100);
  if (entry.type === 'multi_select') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return raw || null;
}

function FieldInput({ id, fieldKey, entry, value, onChange }: {
  id:       string;
  fieldKey: string;
  entry:    FieldMapEntry;
  value:    string;
  onChange: (v: string) => void;
}) {

  if (entry.type === 'boolean') {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Selecionar…" />
        </SelectTrigger>
        <SelectContent className="z-70">
          <SelectItem value="true">Sim</SelectItem>
          <SelectItem value="false">Não</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (entry.type === 'single_select' && entry.options?.length) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Selecionar…" />
        </SelectTrigger>
        <SelectContent className="z-70">
          {entry.options.map((option) => (
            <SelectItem key={option} value={option}>
              {formatFieldOptionLabel(fieldKey, option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (entry.type === 'multi_select' && entry.options?.length) {
    const selected = value ? value.split(',').map((s) => s.trim()) : [];
    const toggle = (opt: string) => {
      const next = selected.includes(opt)
        ? selected.filter((s) => s !== opt)
        : [...selected, opt];
      onChange(next.join(', '));
    };
    return (
      <div id={id} role="group" className="flex flex-wrap gap-2">
        {entry.options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={selected.includes(o)}
            onClick={() => toggle(o)}
            className={cn(
              'h-8 rounded-full border px-3 text-xs font-bold transition-colors focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ds-modal-soft',
              selected.includes(o)
                ? 'border-ds-modal bg-ds-modal-soft text-ds-modal-ink'
                : 'border-ds-border-input bg-ds-input text-ds-ink-muted hover:border-ds-modal hover:text-ds-ink',
            )}
          >
            {formatFieldOptionLabel(fieldKey, o)}
          </button>
        ))}
      </div>
    );
  }

  if (entry.type === 'date') {
    return <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} className={fieldInputClass} />;
  }

  if (entry.type === 'currency') {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-ds-ink-faint">R$</span>
        <input id={id} type="number" step="0.01" min="0" value={value} onChange={(e) => onChange(e.target.value)} className={cn(fieldInputClass, 'pl-9')} />
      </div>
    );
  }

  if (entry.type === 'number') {
    return <input id={id} type="number" value={value} onChange={(e) => onChange(e.target.value)} className={fieldInputClass} />;
  }

  if (entry.type === 'multiline') {
    return <textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={cn(fieldInputClass, 'h-auto resize-y py-2.5')} />;
  }

  const mask = getFieldMask(fieldKey);
  if (mask) {
    return (
      <input
        id={id}
        type="text"
        inputMode={mask.inputMode}
        autoComplete="off"
        placeholder={mask.placeholder}
        value={mask.format(value)}
        onChange={(e) => onChange(mask.normalize(e.target.value))}
        className={fieldInputClass}
      />
    );
  }

  return <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} className={fieldInputClass} />;
}

function currentRawValue(fv: EmployeeFieldValue | undefined, entry: FieldMapEntry): string {
  if (!fv) return '';
  if (entry.type === 'boolean')      return fv.value_boolean != null ? String(fv.value_boolean) : '';
  if (entry.type === 'currency')     return fv.value_number != null ? String(fv.value_number / 100) : '';
  if (entry.type === 'number')       return fv.value_number != null ? String(fv.value_number) : '';
  if (entry.type === 'multi_select') return Array.isArray(fv.value_json) ? (fv.value_json as string[]).join(', ') : '';
  return fv.value_text ?? '';
}

export function SectionEditModal({ employeeId, editKey, editKeys, groupLabel, deriveOnSave, fields, role, onClose, onSaved }: Props) {
  const keys = editKeys?.length ? editKeys : [editKey];
  const editable = keys
    .map((key) => fields.find((f) => f.key === key))
    .filter((f): f is FieldInput => Boolean(f));
  const field = editable[0];
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const editableSignature = editable.map((f) => f.key).join('|');

  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const f of editable) {
      const current = currentRawValue(f.fv, f.entry);
      initial[f.key] = getFieldMask(f.key)?.normalize(current) ?? current;
    }
    setValues(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editableSignature]);

  const handleSave = useCallback(async () => {
    if (editable.length === 0) return;
    for (const f of editable) {
      const formatError = getFieldMask(f.key)?.validate(values[f.key] ?? '') ?? null;
      if (formatError) {
        setError(formatError);
        return;
      }
    }
    const derived = deriveOnSave?.(values) ?? {};
    const updates = [
      ...editable.map((f) => ({ f, raw: values[f.key] ?? '' })),
      ...Object.entries(derived)
        .map(([key, raw]) => ({ f: fields.find((candidate) => candidate.key === key), raw }))
        .filter((item): item is { f: FieldInput; raw: string } => Boolean(item.f)),
    ].filter(({ f, raw }) => raw !== currentRawValue(f.fv, f.entry) || editable.length === 1);
    if (updates.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let pending = false;
      let lastKey = editKey;
      let lastValue: unknown = null;
      let completion = 0;
      for (const { f, raw } of updates) {
        const value = parseValue(f.entry, raw);
        const result = await callOnFieldUpdate({ employee_id: employeeId, field_key: f.key, value });
        pending = pending || Boolean(result.pending_approval);
        lastKey = f.key;
        lastValue = value;
        completion = result.profile_completion;
      }
      if (pending) {
        setConfirmation('Solicitação enviada. O valor atual será mantido até a aprovação do RH.');
        return;
      }
      onSaved(lastKey, lastValue, completion);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar campo.');
    } finally {
      setSaving(false);
    }
  }, [editable, values, deriveOnSave, fields, employeeId, editKey, onSaved, onClose]);

  if (!field) return null;

  const isRequest = editable.some((f) => f.entry.self_service_policy === 'approval') && role === 'employee';
  const isGroup = editable.length > 1;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        flush
        hideClose
        className="overflow-hidden rounded-ds-card border-ds-border bg-ds-surface p-0 font-ds shadow-2xl sm:max-w-[440px]"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmation) onClose();
            else void handleSave();
          }}
          className="flex max-h-[85vh] min-h-0 flex-col"
        >
          <DialogHeader className="shrink-0 space-y-0 border-b border-ds-divider px-5 py-4 text-left">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-ds-accent-kicker">
                  {field.entry.section || 'Ficha do colaborador'}
                </p>
                <DialogTitle className="mt-1 text-lg font-extrabold tracking-tight text-ds-ink">
                  {isRequest ? 'Solicitar alteração' : isGroup ? `Editar ${groupLabel ?? 'campos'}` : 'Editar campo'}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs text-ds-ink-muted">
                  {isRequest
                    ? 'O valor atual continua valendo até o RH aprovar.'
                    : 'A alteração vale para a ficha assim que for salva.'}
                </DialogDescription>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar"
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-ds-md text-ds-ink-muted transition-colors hover:bg-ds-page hover:text-ds-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
              >
                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-ds-input/40 px-5 py-4">
            {editable.map((f, index) => {
              const inputId = `section-edit-${f.key}`;
              return (
                <Field
                  key={f.key}
                  label={f.entry.label}
                  htmlFor={inputId}
                  requirement={f.entry.required ? 'obrigatório' : undefined}
                  hint={f.entry.help_text}
                  error={index === editable.length - 1 ? error : null}
                >
                  <FieldInput
                    id={inputId}
                    fieldKey={f.key}
                    entry={f.entry}
                    value={values[f.key] ?? ''}
                    onChange={(next) => setValues((current) => ({ ...current, [f.key]: next }))}
                  />
                </Field>
              );
            })}
            {confirmation ? (
              <p role="status" className="rounded-ds-md bg-ds-ok-bg px-3 py-2 text-xs font-semibold leading-5 text-ds-ok">{confirmation}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-ds-divider px-5 py-3">
            {confirmation ? null : (
              <Button type="button" variant="ds-ghost" size="md" onClick={onClose}>
                Cancelar
              </Button>
            )}
            <Button type="submit" variant="primary-modal" size="md" loading={saving} disabled={saving}>
              {confirmation ? 'Fechar' : isRequest ? 'Enviar para aprovação' : 'Salvar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
