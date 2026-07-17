'use client';

import { useState, useCallback, useEffect } from 'react';
import type { FieldMapEntry, EmployeeFieldValue, RhRole, BizneoEmployeeId } from '@/types/rh';
import { callOnFieldUpdate } from '../lib/rh-client';

type FieldInput = {
  key:   string;
  entry: FieldMapEntry;
  fv?:   EmployeeFieldValue;
};

type Props = {
  employeeId: BizneoEmployeeId;
  editKey:    string;
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

function FieldInput({ entry, value, onChange }: {
  entry:    FieldMapEntry;
  value:    string;
  onChange: (v: string) => void;
}) {
  const base = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white';

  if (entry.type === 'boolean') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">Selecionar…</option>
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </select>
    );
  }

  if (entry.type === 'single_select' && entry.options?.length) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">Selecionar…</option>
        {entry.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
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
      <div className="flex flex-wrap gap-2">
        {entry.options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              selected.includes(o)
                ? 'bg-violet-600 text-white border-violet-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }

  if (entry.type === 'date') {
    return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={base} />;
  }

  if (entry.type === 'currency') {
    return (
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
        <input type="number" step="0.01" min="0" value={value} onChange={(e) => onChange(e.target.value)} className={`${base} pl-8`} />
      </div>
    );
  }

  if (entry.type === 'number') {
    return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className={base} />;
  }

  if (entry.type === 'multiline') {
    return <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={`${base} resize-none`} />;
  }

  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={base} />;
}

function currentRawValue(fv: EmployeeFieldValue | undefined, entry: FieldMapEntry): string {
  if (!fv) return '';
  if (entry.type === 'boolean')      return fv.value_boolean != null ? String(fv.value_boolean) : '';
  if (entry.type === 'currency')     return fv.value_number != null ? String(fv.value_number / 100) : '';
  if (entry.type === 'number')       return fv.value_number != null ? String(fv.value_number) : '';
  if (entry.type === 'multi_select') return Array.isArray(fv.value_json) ? (fv.value_json as string[]).join(', ') : '';
  return fv.value_text ?? '';
}

export function SectionEditModal({ employeeId, editKey, fields, role, onClose, onSaved }: Props) {
  const field = fields.find((f) => f.key === editKey);
  const [rawValue, setRawValue] = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (field) setRawValue(currentRawValue(field.fv, field.entry));
  }, [field]);

  const handleSave = useCallback(async () => {
    if (!field) return;
    setSaving(true);
    setError(null);
    try {
      const value = parseValue(field.entry, rawValue);
      const result = await callOnFieldUpdate({ employee_id: employeeId, field_key: editKey, value });
      onSaved(editKey, value, result.profile_completion);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar campo.');
    } finally {
      setSaving(false);
    }
  }, [field, rawValue, employeeId, editKey, onSaved, onClose]);

  if (!field) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-sm rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5">
          <h2 className="text-sm font-semibold text-gray-900">Editar campo</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="max-h-[65vh] space-y-2 overflow-auto px-3 py-2.5">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              {field.entry.label}
              {field.entry.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <FieldInput entry={field.entry} value={rawValue} onChange={setRawValue} />
            {field.entry.help_text && (
              <p className="text-[11px] text-gray-400 mt-1">{field.entry.help_text}</p>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-3 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg px-3 text-xs text-gray-600 transition-colors hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-8 rounded-lg bg-violet-600 px-3 text-xs font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
