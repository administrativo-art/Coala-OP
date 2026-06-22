'use client';

import { useEffect, useMemo, useState } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, ChevronDown, Eye, EyeOff, Globe2, GripVertical, Lock, MoreHorizontal, Pencil, Plus, Save, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import type { FieldMap, FieldMapEntry, FieldType, FieldVisibility } from '@/types/rh';

type EditableFieldMapEntry = FieldMapEntry;

const FIELD_TYPES: FieldType[] = ['text', 'multiline', 'date', 'number', 'currency', 'boolean', 'single_select', 'multi_select', 'ref:jobRoles'];
const VISIBILITIES: FieldVisibility[] = ['public', 'sensitive', 'internal'];

const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Texto',
  multiline: 'Texto longo',
  date: 'Data',
  number: 'Número',
  currency: 'Moeda',
  boolean: 'Sim/Não',
  single_select: 'Seleção única',
  multi_select: 'Seleção múltipla',
  autonumber: 'Autonúmero',
  'ref:jobRoles': 'Cargo',
};

const VISIBILITY_LABELS: Record<FieldVisibility, string> = {
  public: 'Operacional',
  sensitive: 'Restrito',
  internal: 'Confidencial',
};

const LGPD_CATEGORY_LABELS = {
  personal: 'Pessoal',
  sensitive: 'Sensível',
  confidential: 'Confidencial',
} as const;

const LEGAL_BASIS_LABELS = {
  legal_obligation: 'Obrigação legal',
  contract: 'Contrato',
  legitimate_interest: 'Interesse legítimo',
  consent: 'Consentimento',
} as const;

const RETENTION_LABELS = {
  employment_plus_5y: 'Vínculo + 5 anos',
  termination_plus_90d: 'Desligamento + 90 dias',
  termination_plus_2y: 'Desligamento + 2 anos',
  manual_review: 'Revisão manual',
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

function TypeBadge({ type }: { type: FieldType }) {
  const tone =
    type === 'boolean' ? 'bg-[#edf0ff] text-[#4f46e5]' :
    type === 'currency' ? 'bg-[#e7fbf7] text-[#008f83]' :
    type === 'date' ? 'bg-[#eef7ff] text-[#0b76b7]' :
    'bg-[#f1f2f5] text-[#555563]';
  return (
    <span className={`inline-flex w-fit items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-black ${tone}`}>
      <SlidersHorizontal className="h-3.5 w-3.5" />
      {TYPE_LABELS[type] ?? type}
    </span>
  );
}

function VisibilityBadge({ visibility }: { visibility: FieldVisibility }) {
  const Icon = visibility === 'public' ? Globe2 : visibility === 'sensitive' ? Lock : EyeOff;
  const tone =
    visibility === 'public' ? 'bg-[#eafaf2] text-[#008963]' :
    visibility === 'sensitive' ? 'bg-[#fff5db] text-[#d17400]' :
    'bg-[#ffe9ef] text-[#d9275f]';
  return (
    <span className={`inline-flex w-fit items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-black ${tone}`}>
      <Icon className="h-3.5 w-3.5" />
      {VISIBILITY_LABELS[visibility]}
    </span>
  );
}

function LgpdBadge({ category }: { category: keyof typeof LGPD_CATEGORY_LABELS }) {
  const tone =
    category === 'sensitive' ? 'bg-[#f2e9ff] text-[#7c3aed]' :
    category === 'confidential' ? 'bg-[#ffe9ef] text-[#d9275f]' :
    'bg-[#fff0f6] text-[#df2f78]';
  return (
    <span className={`inline-flex w-fit items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-black ${tone}`}>
      <ShieldCheck className="h-3.5 w-3.5" />
      {LGPD_CATEGORY_LABELS[category]}
    </span>
  );
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
      className={`grid min-w-[920px] grid-cols-[48px_minmax(260px,1.7fr)_150px_170px_150px_140px] items-center gap-4 border-b border-[#ececf0] bg-white px-5 py-4 text-sm last:border-b-0 ${isDragging ? 'opacity-60' : ''}`}
    >
      <button type="button" className="text-[#b7b7c1]" {...attributes} {...listeners} aria-label="Arrastar campo">
        <GripVertical className="h-5 w-5" />
      </button>
      <div className="min-w-0">
        <p className="truncate text-base font-black text-[#1d1d26]">{entry.label}</p>
        <p className="truncate font-mono text-xs font-semibold text-[#9d9da9]">{id}</p>
      </div>
      <TypeBadge type={entry.type} />
      <VisibilityBadge visibility={entry.visibility} />
      <LgpdBadge category={entry.lgpd?.category ?? 'personal'} />
      <div className="flex items-center gap-2">
        <span className={`grid h-9 w-9 place-items-center rounded-lg ${entry.employee_visible ? 'bg-[#eafaf2] text-[#008963]' : 'bg-[#f1f2f5] text-[#a1a1ad]'}`}>
          {entry.employee_visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </span>
        <button type="button" onClick={onEdit} className="grid h-9 w-9 place-items-center rounded-lg bg-[#eafaf2] text-[#008963] hover:bg-[#dff7eb]" aria-label={`Editar ${entry.label}`}>
          <Pencil className="h-4 w-4" />
        </button>
      </div>
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
  const [query, setQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<FieldVisibility | 'all'>('all');
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
      const section = item[1].section || 'Sem seção';
      if (!acc[section]) acc[section] = [];
      acc[section].push(item);
      return acc;
    }, {});
    Object.values(groups).forEach((items) => items.sort(([, left], [, right]) => left.order - right.order));
    return Object.fromEntries(Object.entries(groups).sort(([left], [right]) => left.localeCompare(right, 'pt-BR')));
  }, [fields]);

  const displayedGrouped = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const entries = Object.entries(grouped)
      .map(([section, items]) => {
        const nextItems = items.filter(([key, entry]) => {
          const matchesVisibility = visibilityFilter === 'all' || entry.visibility === visibilityFilter;
          const matchesQuery =
            !normalizedQuery ||
            section.toLowerCase().includes(normalizedQuery) ||
            key.toLowerCase().includes(normalizedQuery) ||
            entry.label.toLowerCase().includes(normalizedQuery);
          return matchesVisibility && matchesQuery;
        });
        return [section, nextItems] as const;
      })
      .filter(([, items]) => items.length > 0);
    return Object.fromEntries(entries);
  }, [grouped, query, visibilityFilter]);

  const editing = editingKey ? fields[editingKey] : null;

  function updateField(key: string, patch: Partial<EditableFieldMapEntry>) {
    setFields((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  function addSection() {
    const section = window.prompt('Nome da nova seção');
    if (!section?.trim()) return;
    const label = window.prompt('Nome do primeiro campo desta seção') ?? 'Novo campo';
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
    const nextName = window.prompt('Novo nome da seção', oldName);
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
        {message ?? 'Não foi possível carregar o catálogo de campos.'}
      </div>
    );
  }

  const visibilityTabs: Array<{ value: FieldVisibility | 'all'; label: string; count: number }> = [
    { value: 'all', label: 'Todos', count: Object.keys(fields).length },
    ...VISIBILITIES.map((visibility) => ({
      value: visibility,
      label: VISIBILITY_LABELS[visibility],
      count: Object.values(fields).filter((entry) => entry.visibility === visibility).length,
    })),
  ];

  return (
    <div className="space-y-5 bg-[#f1f1f3] px-4 py-5 text-[#1d1d26] md:px-5">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <p className="text-base font-medium text-[#8f8f9b]">Departamento pessoal</p>
          <h1 className="mt-4 text-2xl font-black tracking-tight text-[#181820]">Campos do perfil</h1>
          <p className="mt-2 max-w-3xl text-base font-medium leading-relaxed text-[#6f6f7c]">
            Crie, nomeie e organize as seções e campos exibidos no perfil dos colaboradores.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={addSection} className="inline-flex h-12 items-center gap-3 rounded-2xl border border-[#dedfe4] bg-white px-5 text-sm font-black text-[#4f4f5b] shadow-sm hover:bg-[#fbfbfc]">
            <Plus className="h-5 w-5" />
            Nova seção
          </button>
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-12 items-center gap-3 rounded-2xl bg-[#df2f78] px-5 text-sm font-black text-white shadow-sm hover:bg-[#c92368] disabled:opacity-60">
            {saving ? <Save className="h-5 w-5 animate-pulse" /> : <Check className="h-5 w-5" />}
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </div>

      <div className="rounded-[22px] border border-[#dedfe4] bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9d9da9]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-12 w-full rounded-2xl border-0 bg-[#f7f7f9] pl-12 pr-4 text-base font-medium text-[#4f4f5b] outline-none placeholder:text-[#9d9da9]"
            placeholder="Buscar campo por nome ou chave..."
          />
        </div>
        <div className="mt-4 flex max-w-full gap-3 overflow-x-auto">
          {visibilityTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setVisibilityFilter(tab.value)}
              className={`inline-flex min-w-max items-center gap-2 rounded-xl px-5 py-3 text-sm font-black transition ${
                visibilityFilter === tab.value
                  ? 'bg-[#181820] text-white'
                  : 'bg-transparent text-[#737381] hover:bg-[#f7f7f9]'
              }`}
            >
              {tab.label}
              <span className={`rounded-full px-2.5 py-0.5 text-xs ${visibilityFilter === tab.value ? 'bg-white/15 text-white' : 'bg-[#e6e6ea] text-[#737381]'}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {message ? <p className="rounded-2xl bg-white px-5 py-4 text-sm font-black text-[#6f6f7c] shadow-sm ring-1 ring-[#dedfe4]">{message}</p> : null}

      {Object.keys(displayedGrouped).length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-[#cfd0d8] bg-white px-5 py-10 text-center text-sm font-black text-[#777784]">
          Nenhum campo encontrado.
        </div>
      ) : null}

      {Object.entries(displayedGrouped).map(([section, items]) => (
        <section key={section} className="overflow-hidden rounded-[22px] border border-[#dedfe4] bg-white shadow-[0_2px_10px_rgba(15,23,42,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" className="text-[#c2c2cc]" aria-label={`Arrastar seção ${section}`}>
                <GripVertical className="h-6 w-6" />
              </button>
              <ChevronDown className="h-6 w-6 text-[#9d9da9]" />
              <h2 className="truncate text-xl font-black text-[#1d1d26]">{section}</h2>
              <span className="rounded-full bg-[#e6e6ea] px-3 py-1 text-xs font-black text-[#6f6f7c]">
                {items.length} {items.length === 1 ? 'campo' : 'campos'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => renameSection(section)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-3 text-sm font-black text-[#6f6f7c] hover:bg-[#f7f7f9]">
                <Pencil className="h-4 w-4" />
                Renomear
              </button>
              <button type="button" onClick={() => addField(section)} className="inline-flex h-10 min-w-44 items-center justify-center gap-2 rounded-xl bg-[#fff0f6] px-4 text-sm font-black text-[#df2f78] hover:bg-[#fde5f0]">
                <Plus className="h-4 w-4" />
                Adicionar campo
              </button>
              <button type="button" className="grid h-10 w-10 place-items-center rounded-xl text-[#9d9da9] hover:bg-[#f7f7f9]" aria-label={`Mais ações de ${section}`}>
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </div>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => handleDragEnd(section, event)}>
            <SortableContext items={items.map(([key]) => key)} strategy={verticalListSortingStrategy}>
              <div className="overflow-x-auto border-t border-[#ececf0]">
                <div className="grid min-w-[920px] grid-cols-[48px_minmax(260px,1.7fr)_150px_170px_150px_140px] gap-4 bg-[#fbfbfc] px-5 py-3 text-xs font-black uppercase tracking-wide text-[#9d9da9]">
                  <span />
                  <span>Campo</span>
                  <span>Tipo</span>
                  <span>Visibilidade</span>
                  <span>LGPD</span>
                  <span>Colaborador</span>
                </div>
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
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[22px] bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black text-[#1d1d26]">Editar campo</h2>
                <p className="mt-1 font-mono text-sm font-semibold text-[#9d9da9]">{editingKey}</p>
              </div>
              <button type="button" onClick={() => setEditingKey(null)} className="rounded-2xl bg-[#f1f2f5] px-4 py-3 text-sm font-black text-[#6f6f7c]">Fechar</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-2 text-xs font-black uppercase text-[#9d9da9]">
                Nome
                <input value={editing.label} onChange={(event) => updateField(editingKey, { label: event.target.value })} className="w-full rounded-2xl border border-[#dedfe4] px-4 py-3 text-sm font-semibold text-[#1d1d26] outline-none" />
              </label>
              <label className="space-y-2 text-xs font-black uppercase text-[#9d9da9]">
                Seção
                <input value={editing.section} onChange={(event) => updateField(editingKey, { section: event.target.value })} className="w-full rounded-2xl border border-[#dedfe4] px-4 py-3 text-sm font-semibold text-[#1d1d26] outline-none" />
              </label>
              <label className="space-y-2 text-xs font-black uppercase text-[#9d9da9]">
                Tipo
                <select value={editing.type} onChange={(event) => updateField(editingKey, { type: event.target.value as FieldType })} className="w-full rounded-2xl border border-[#dedfe4] px-4 py-3 text-sm font-semibold text-[#1d1d26] outline-none">
                  {FIELD_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
                </select>
              </label>
              <label className="space-y-2 text-xs font-black uppercase text-[#9d9da9]">
                Visibilidade
                <select value={editing.visibility} onChange={(event) => {
                  const visibility = event.target.value as FieldVisibility;
                  updateField(editingKey, { visibility, lgpd: defaultLgpd(editing.section, visibility) });
                }} className="w-full rounded-2xl border border-[#dedfe4] px-4 py-3 text-sm font-semibold text-[#1d1d26] outline-none">
                  {VISIBILITIES.map((visibility) => <option key={visibility} value={visibility}>{VISIBILITY_LABELS[visibility]}</option>)}
                </select>
              </label>
              <label className="space-y-2 text-xs font-black uppercase text-[#9d9da9]">
                Categoria LGPD
                <select value={editing.lgpd?.category ?? 'personal'} onChange={(event) => updateField(editingKey, { lgpd: { ...defaultLgpd(editing.section, editing.visibility), ...editing.lgpd, category: event.target.value as any } })} className="w-full rounded-2xl border border-[#dedfe4] px-4 py-3 text-sm font-semibold text-[#1d1d26] outline-none">
                  {Object.entries(LGPD_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="space-y-2 text-xs font-black uppercase text-[#9d9da9]">
                Base legal
                <select value={editing.lgpd?.legal_basis ?? 'legal_obligation'} onChange={(event) => updateField(editingKey, { lgpd: { ...defaultLgpd(editing.section, editing.visibility), ...editing.lgpd, legal_basis: event.target.value as any } })} className="w-full rounded-2xl border border-[#dedfe4] px-4 py-3 text-sm font-semibold text-[#1d1d26] outline-none">
                  {Object.entries(LEGAL_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="space-y-2 text-xs font-black uppercase text-[#9d9da9]">
                Retenção
                <select value={editing.lgpd?.retention ?? 'employment_plus_5y'} onChange={(event) => updateField(editingKey, { lgpd: { ...defaultLgpd(editing.section, editing.visibility), ...editing.lgpd, retention: event.target.value as any } })} className="w-full rounded-2xl border border-[#dedfe4] px-4 py-3 text-sm font-semibold text-[#1d1d26] outline-none">
                  {Object.entries(RETENTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="space-y-2 text-xs font-black uppercase text-[#9d9da9]">
                Opções
                <input value={editing.options?.join(', ') ?? ''} onChange={(event) => updateField(editingKey, { options: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} placeholder="Separadas por vírgula" className="w-full rounded-2xl border border-[#dedfe4] px-4 py-3 text-sm font-semibold text-[#1d1d26] outline-none" />
              </label>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <label className="flex items-center gap-2 rounded-2xl bg-[#f7f7f9] p-3 text-xs font-bold text-[#6f6f7c]">
                <input type="checkbox" checked={editing.required === true} onChange={(event) => updateField(editingKey, { required: event.target.checked })} />
                Obrigatório
              </label>
              <label className="flex items-center gap-2 rounded-2xl bg-[#f7f7f9] p-3 text-xs font-bold text-[#6f6f7c]">
                <input type="checkbox" checked={editing.employee_visible === true} onChange={(event) => updateField(editingKey, { employee_visible: event.target.checked, employee_editable: event.target.checked ? editing.employee_editable : false })} />
                Visível ao colaborador
              </label>
              <label className="flex items-center gap-2 rounded-2xl bg-[#f7f7f9] p-3 text-xs font-bold text-[#6f6f7c]">
                <input type="checkbox" checked={editing.employee_editable === true} disabled={!editing.employee_visible} onChange={(event) => updateField(editingKey, { employee_editable: event.target.checked })} />
                Editável pelo colaborador
              </label>
              <label className="flex items-center gap-2 rounded-2xl bg-[#f7f7f9] p-3 text-xs font-bold text-[#6f6f7c]">
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
