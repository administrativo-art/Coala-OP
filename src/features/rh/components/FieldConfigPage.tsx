'use client';

import { useEffect, useMemo, useState } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Save, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import type { FieldMap, FieldMapEntry, FieldType, FieldVisibility } from '@/types/rh';

type EditableFieldMapEntry = FieldMapEntry;

const FIELD_TYPES: FieldType[] = ['text', 'multiline', 'date', 'number', 'currency', 'boolean', 'single_select', 'multi_select', 'ref:jobRoles'];
const VISIBILITIES: FieldVisibility[] = ['public', 'sensitive', 'internal'];

const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Texto',
  multiline: 'Texto longo',
  date: 'Data',
  number: 'Numero',
  currency: 'Moeda',
  boolean: 'Sim/Nao',
  single_select: 'Selecao unica',
  multi_select: 'Selecao multipla',
  autonumber: 'Auto-numero',
  'ref:jobRoles': 'Cargo',
};

const VISIBILITY_LABELS: Record<FieldVisibility, string> = {
  public: 'Operacional',
  sensitive: 'Restrito',
  internal: 'Confidencial',
};

const LGPD_CATEGORY_LABELS = {
  personal: 'Pessoal',
  sensitive: 'Sensivel',
  confidential: 'Confidencial',
} as const;

const LEGAL_BASIS_LABELS = {
  legal_obligation: 'Obrigacao legal',
  contract: 'Contrato',
  legitimate_interest: 'Interesse legitimo',
  consent: 'Consentimento',
} as const;

const RETENTION_LABELS = {
  employment_plus_5y: 'Vinculo + 5 anos',
  termination_plus_90d: 'Desligamento + 90 dias',
  termination_plus_2y: 'Desligamento + 2 anos',
  manual_review: 'Revisao manual',
} as const;

function makeKey(label: string) {
  const slug = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `employee.${slug || `campo_${Date.now()}`}`;
}

function defaultLgpd(section: string, visibility: FieldVisibility): NonNullable<FieldMapEntry['lgpd']> {
  const lower = section.toLowerCase();
  const consent = lower.includes('diversidade');
  return {
    category: consent || visibility === 'internal' ? 'sensitive' : visibility === 'sensitive' ? 'confidential' : 'personal',
    legal_basis: consent ? 'consent' : 'legal_obligation',
    retention: lower.includes('banc') ? 'termination_plus_90d' : lower.includes('aso') || consent ? 'termination_plus_2y' : 'employment_plus_5y',
    requires_consent: consent,
  };
}

function SortableFieldRow({
  id,
  entry,
  onEdit,
}: {
  id: string;
  entry: EditableFieldMapEntry;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm md:grid-cols-[28px_1fr_120px_120px_140px_84px] md:items-center ${isDragging ? 'opacity-60' : ''}`}
    >
      <button type="button" className="text-slate-400" {...attributes} {...listeners} aria-label="Arrastar campo">
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-900">{entry.label}</p>
        <p className="truncate font-mono text-[10px] text-slate-400">{id}</p>
      </div>
      <span className="text-xs font-semibold text-slate-500">{TYPE_LABELS[entry.type] ?? entry.type}</span>
      <span className="text-xs font-semibold text-slate-500">{VISIBILITY_LABELS[entry.visibility]}</span>
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600">
        <ShieldCheck className="h-3 w-3 text-pink-500" />
        {LGPD_CATEGORY_LABELS[entry.lgpd?.category ?? 'personal']}
      </span>
      <button type="button" onClick={onEdit} className="rounded-lg bg-white px-3 py-1.5 text-xs font-black text-pink-600 shadow-sm ring-1 ring-pink-100 hover:bg-pink-50">
        Editar
      </button>
    </div>
  );
}

export function FieldConfigPage() {
  const { firebaseUser } = useAuth();
  const [fieldMap, setFieldMap] = useState<FieldMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<Record<string, EditableFieldMapEntry>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!firebaseUser) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setMessage(null);
      try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch('/api/rh/field-map', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Falha ao carregar campos.');
        if (!cancelled) {
          const nextFieldMap = payload.fieldMap as FieldMap;
          setFieldMap(nextFieldMap);
          setFields(nextFieldMap.fields);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : 'Falha ao carregar campos.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  const grouped = useMemo(() => {
    const groups = Object.entries(fields).reduce<Record<string, Array<[string, EditableFieldMapEntry]>>>((acc, item) => {
      const section = item[1].section || 'Sem secao';
      if (!acc[section]) acc[section] = [];
      acc[section].push(item);
      return acc;
    }, {});
    Object.values(groups).forEach((items) => items.sort(([, left], [, right]) => left.order - right.order));
    return Object.fromEntries(Object.entries(groups).sort(([left], [right]) => left.localeCompare(right, 'pt-BR')));
  }, [fields]);

  const editing = editingKey ? fields[editingKey] : null;

  function updateField(key: string, patch: Partial<EditableFieldMapEntry>) {
    setFields((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  function addSection() {
    const section = window.prompt('Nome da nova secao');
    if (!section?.trim()) return;
    const label = window.prompt('Nome do primeiro campo desta secao') ?? 'Novo campo';
    addField(section.trim(), label.trim() || 'Novo campo');
  }

  function addField(section: string, label = 'Novo campo') {
    const baseKey = makeKey(label);
    let key = baseKey;
    let suffix = 2;
    while (fields[key]) {
      key = `${baseKey}_${suffix}`;
      suffix += 1;
    }
    const order = (grouped[section]?.length ?? 0) * 10 + 10;
    setFields((current) => ({
      ...current,
      [key]: {
        bizneo_id: 'coala_internal',
        label,
        section,
        type: 'text',
        visibility: 'public',
        employee_visible: true,
        employee_editable: false,
        required: false,
        order,
        lgpd: defaultLgpd(section, 'public'),
      },
    }));
    setEditingKey(key);
  }

  function renameSection(oldName: string) {
    const nextName = window.prompt('Novo nome da secao', oldName);
    if (!nextName?.trim() || nextName.trim() === oldName) return;
    setFields((current) => Object.fromEntries(
      Object.entries(current).map(([key, entry]) => [
        key,
        entry.section === oldName ? { ...entry, section: nextName.trim() } : entry,
      ])
    ));
  }

  function handleDragEnd(section: string, event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId || activeId === overId) return;
    const items = grouped[section] ?? [];
    const oldIndex = items.findIndex(([key]) => key === activeId);
    const newIndex = items.findIndex(([key]) => key === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(items, oldIndex, newIndex);
    setFields((current) => {
      const next = { ...current };
      reordered.forEach(([key], index) => {
        next[key] = { ...next[key], order: (index + 1) * 10 };
      });
      return next;
    });
  }

  async function save() {
    if (!firebaseUser) return;
    setSaving(true);
    setMessage(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch('/api/rh/field-map', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ version: fieldMap?.version ?? 'coala-rh-v1.3', fields }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Falha ao salvar campos.');
      setFieldMap((current) => ({
        version: current?.version ?? 'coala-rh-v1.3',
        fields,
      }));
      setMessage('Campos salvos.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar campos.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-slate-100" />;
  if (!fieldMap) {
    return (
      <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
        {message ?? 'Nao foi possivel carregar o catalogo de campos.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <div>
          <p className="text-sm font-black text-slate-950">Editor visual de campos</p>
          <p className="text-xs font-medium text-slate-500">Crie secoes, adicione campos e arraste para organizar a ordem no perfil.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={addSection} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">
            <Plus className="h-4 w-4" />
            Secao
          </button>
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-pink-500 px-3 py-2 text-xs font-black text-white disabled:opacity-60">
            <Save className="h-4 w-4" />
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      {message ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{message}</p> : null}

      {Object.entries(grouped).map(([section, items]) => (
        <section key={section} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-slate-950">{section}</h2>
              <p className="text-xs font-medium text-slate-500">{items.length} campos</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => renameSection(section)} className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-black text-slate-600">Renomear</button>
              <button type="button" onClick={() => addField(section)} className="rounded-lg bg-pink-50 px-3 py-2 text-xs font-black text-pink-600">Adicionar campo</button>
            </div>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => handleDragEnd(section, event)}>
            <SortableContext items={items.map(([key]) => key)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {items.map(([key, entry]) => (
                  <SortableFieldRow key={key} id={key} entry={entry} onEdit={() => setEditingKey(key)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>
      ))}

      {editing && editingKey ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-slate-950">Editar campo</h2>
                <p className="font-mono text-[10px] text-slate-400">{editingKey}</p>
              </div>
              <button type="button" onClick={() => setEditingKey(null)} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">Fechar</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-xs font-bold text-slate-500">
                Nome
                <input value={editing.label} onChange={(event) => updateField(editingKey, { label: event.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm text-slate-900" />
              </label>
              <label className="space-y-1 text-xs font-bold text-slate-500">
                Secao
                <input value={editing.section} onChange={(event) => updateField(editingKey, { section: event.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm text-slate-900" />
              </label>
              <label className="space-y-1 text-xs font-bold text-slate-500">
                Tipo
                <select value={editing.type} onChange={(event) => updateField(editingKey, { type: event.target.value as FieldType })} className="w-full rounded-lg border px-3 py-2 text-sm text-slate-900">
                  {FIELD_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs font-bold text-slate-500">
                Visibilidade
                <select value={editing.visibility} onChange={(event) => {
                  const visibility = event.target.value as FieldVisibility;
                  updateField(editingKey, { visibility, lgpd: defaultLgpd(editing.section, visibility) });
                }} className="w-full rounded-lg border px-3 py-2 text-sm text-slate-900">
                  {VISIBILITIES.map((visibility) => <option key={visibility} value={visibility}>{VISIBILITY_LABELS[visibility]}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs font-bold text-slate-500">
                Categoria LGPD
                <select value={editing.lgpd?.category ?? 'personal'} onChange={(event) => updateField(editingKey, { lgpd: { ...defaultLgpd(editing.section, editing.visibility), ...editing.lgpd, category: event.target.value as any } })} className="w-full rounded-lg border px-3 py-2 text-sm text-slate-900">
                  {Object.entries(LGPD_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs font-bold text-slate-500">
                Base legal
                <select value={editing.lgpd?.legal_basis ?? 'legal_obligation'} onChange={(event) => updateField(editingKey, { lgpd: { ...defaultLgpd(editing.section, editing.visibility), ...editing.lgpd, legal_basis: event.target.value as any } })} className="w-full rounded-lg border px-3 py-2 text-sm text-slate-900">
                  {Object.entries(LEGAL_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs font-bold text-slate-500">
                Retencao
                <select value={editing.lgpd?.retention ?? 'employment_plus_5y'} onChange={(event) => updateField(editingKey, { lgpd: { ...defaultLgpd(editing.section, editing.visibility), ...editing.lgpd, retention: event.target.value as any } })} className="w-full rounded-lg border px-3 py-2 text-sm text-slate-900">
                  {Object.entries(RETENTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs font-bold text-slate-500">
                Opcoes
                <input value={editing.options?.join(', ') ?? ''} onChange={(event) => updateField(editingKey, { options: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} placeholder="Separadas por virgula" className="w-full rounded-lg border px-3 py-2 text-sm text-slate-900" />
              </label>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <label className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs font-bold text-slate-600">
                <input type="checkbox" checked={editing.required === true} onChange={(event) => updateField(editingKey, { required: event.target.checked })} />
                Obrigatorio
              </label>
              <label className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs font-bold text-slate-600">
                <input type="checkbox" checked={editing.employee_visible === true} onChange={(event) => updateField(editingKey, { employee_visible: event.target.checked, employee_editable: event.target.checked ? editing.employee_editable : false })} />
                Visivel ao colaborador
              </label>
              <label className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs font-bold text-slate-600">
                <input type="checkbox" checked={editing.employee_editable === true} disabled={!editing.employee_visible} onChange={(event) => updateField(editingKey, { employee_editable: event.target.checked })} />
                Editavel pelo colaborador
              </label>
              <label className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs font-bold text-slate-600">
                <input type="checkbox" checked={editing.lgpd?.requires_consent === true} onChange={(event) => updateField(editingKey, { lgpd: { ...defaultLgpd(editing.section, editing.visibility), ...editing.lgpd, requires_consent: event.target.checked } })} />
                Exige consentimento
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
