'use client';

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, ChevronDown, Eye, EyeOff, Globe2, GripVertical, Lock, MoreHorizontal, Pencil, Plus, Save, Search, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import type { FieldMap, FieldMapEntry, FieldType, FieldVisibility, ProfileBlockConfig } from '@/types/rh';

type EditableFieldMapEntry = FieldMapEntry;
type FieldTuple = [string, EditableFieldMapEntry];

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

const FIELD_GRID_TEMPLATE = '48px minmax(280px, 1.6fr) 150px 170px 150px 170px 120px';
const ORDER_GRID_TEMPLATE = '44px 44px minmax(0, 1fr) 150px 140px';
const SYSTEM_BLOCKS_SECTION = '__system_blocks';

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

function makeId(label: string) {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 56) || `grupo_${Date.now()}`;
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

function formatConditionalValue(value: unknown) {
  if (value === true) return 'Sim';
  if (value === false) return 'Não';
  if (value == null || value === '') return 'preenchido';
  return String(value);
}

function ConditionBadge({
  conditionals,
  fields,
}: {
  conditionals?: FieldMapEntry['conditionals'];
  fields: Record<string, EditableFieldMapEntry>;
}) {
  const rule = conditionals?.find((item) => item.kind === 'show_if');
  if (!rule) return null;
  const controllerLabel = fields[rule.field]?.label ?? rule.field;
  const operator = rule.operator === 'neq' ? 'diferente de' : rule.operator === 'truthy' ? 'preenchido' : '=';
  const valueLabel = rule.operator === 'truthy' ? '' : ` ${formatConditionalValue(rule.value)}`;
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#eef2ff] px-3 py-1 text-xs font-black text-[#4f46e5]">
      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">Aparece se {controllerLabel} {operator}{valueLabel}</span>
    </span>
  );
}

function fieldGroupKey(entry: EditableFieldMapEntry) {
  return entry.group?.id ?? '';
}

function fieldSubgroupKey(entry: EditableFieldMapEntry) {
  return entry.subgroup?.id ?? '';
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
  onDelete,
}: {
  id: string;
  entry: EditableFieldMapEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, gridTemplateColumns: FIELD_GRID_TEMPLATE }}
      className={`grid min-w-[1120px] items-center gap-4 border-b border-[#ececf0] bg-white px-5 py-4 text-sm last:border-b-0 ${isDragging ? 'opacity-60' : ''}`}
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
        <span className={`grid h-9 w-9 place-items-center rounded-lg ${entry.employee_visible ? 'bg-[#eafaf2] text-[#008963]' : 'bg-[#f1f2f5] text-[#a1a1ad]'}`} title={entry.employee_visible ? 'Visível ao colaborador' : 'Oculto para o colaborador'}>
          {entry.employee_visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </span>
        <span className={`grid h-9 w-9 place-items-center rounded-lg ${entry.employee_editable ? 'bg-[#eafaf2] text-[#008963]' : 'bg-white text-[#c2c2cc]'}`} title={entry.employee_editable ? 'Editável pelo colaborador' : 'Não editável pelo colaborador'}>
          <Pencil className="h-4 w-4" />
        </span>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onEdit} className="grid h-9 w-9 place-items-center rounded-lg text-[#8f8f9b] hover:bg-[#f1f2f5] hover:text-[#1d1d26]" aria-label={`Editar ${entry.label}`}>
          <SlidersHorizontal className="h-4 w-4" />
        </button>
        <button type="button" onClick={onDelete} className="grid h-9 w-9 place-items-center rounded-lg text-[#8f8f9b] hover:bg-[#fff0f6] hover:text-[#df2f78]" aria-label={`Remover ${entry.label}`}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function SortableProfileBlockRow({
  id,
  block,
  position,
  onToggleVisible,
  onToggleEditable,
}: {
  id: string;
  block: ProfileBlockConfig;
  position: number;
  onToggleVisible: () => void;
  onToggleEditable: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, gridTemplateColumns: ORDER_GRID_TEMPLATE }}
      className={`grid items-center gap-3 border-b border-[#ececf0] bg-white px-5 py-3 text-sm last:border-b-0 ${isDragging ? 'opacity-60' : ''}`}
    >
      <button type="button" className="text-[#b7b7c1]" {...attributes} {...listeners} aria-label="Arrastar bloco">
        <GripVertical className="h-5 w-5" />
      </button>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#f1f2f5] text-xs font-black text-[#737381]">
        {position}
      </span>
      <div className="min-w-0">
        <p className="truncate text-base font-black text-[#1d1d26]">{block.label}</p>
        <p className="truncate font-mono text-xs font-semibold text-[#9d9da9]">{id}</p>
      </div>
      <span className="inline-flex w-fit items-center gap-2 rounded-lg bg-[#fff0f6] px-2.5 py-1.5 text-xs font-black text-[#df2f78]">
        Sistema
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleVisible}
          className={`inline-flex w-fit items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-black ${block.employee_visible ? 'bg-[#eafaf2] text-[#008963]' : 'bg-[#f1f2f5] text-[#a1a1ad]'}`}
          title={block.employee_visible ? 'Visível ao colaborador' : 'Oculto para o colaborador'}
        >
          {block.employee_visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {block.employee_visible ? 'Visível' : 'Oculto'}
        </button>
        <button
          type="button"
          onClick={onToggleEditable}
          className={`grid h-8 w-8 place-items-center rounded-lg ${block.employee_editable ? 'bg-[#eafaf2] text-[#008963]' : 'bg-white text-[#c2c2cc]'}`}
          title={block.employee_editable ? 'Editável pelo colaborador' : 'Não editável pelo colaborador'}
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function SortableSectionOrderFrame({
  id,
  section,
  count,
  countLabel,
  tag,
  actions,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  section: string;
  count: number;
  countLabel?: string;
  tag?: string;
  actions?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`overflow-hidden rounded-[22px] border border-[#dedfe4] bg-white shadow-[0_2px_10px_rgba(15,23,42,0.06)] ${isDragging ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" className="text-[#c2c2cc]" {...attributes} {...listeners} aria-label={`Arrastar seção ${section}`}>
            <GripVertical className="h-5 w-5" />
          </button>
          <button type="button" onClick={onToggle} className="rounded-lg p-1 text-[#9d9da9] hover:bg-[#f1f2f5]" aria-label={collapsed ? `Expandir ${section}` : `Recolher ${section}`}>
            <ChevronDown className={`h-5 w-5 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          </button>
          {tag ? (
            <span className="rounded-md border border-[#dedfe4] bg-[#f7f7f9] px-2 py-1 text-[10px] font-black uppercase text-[#8f8f9b]">
              {tag}
            </span>
          ) : null}
          <h2 className="truncate text-xl font-black text-[#1d1d26]">{section}</h2>
          <span className="rounded-full bg-[#e6e6ea] px-3 py-1 text-xs font-black text-[#6f6f7c]">
            {count} {countLabel ?? (count === 1 ? 'campo' : 'campos')}
          </span>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
      {!collapsed ? children : null}
    </section>
  );
}

export function FieldConfigPage() {
  const { firebaseUser } = useAuth();
  const [fieldMap, setFieldMap] = useState<FieldMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<Record<string, EditableFieldMapEntry>>({});
  const [profileBlocks, setProfileBlocks] = useState<Record<string, ProfileBlockConfig>>({});
  const [sectionOrder, setSectionOrder] = useState<Record<string, number>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<FieldVisibility | 'all'>('all');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
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
          setSectionOrder(nextFieldMap.section_order ?? {});
          setProfileBlocks(nextFieldMap.profile_blocks ?? {});
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
    const groups = Object.entries(fields).reduce<Record<string, FieldTuple[]>>((acc, item) => {
      const section = item[1].section || 'Sem seção';
      if (!acc[section]) acc[section] = [];
      acc[section].push(item);
      return acc;
    }, {});
    Object.values(groups).forEach((items) => items.sort(([, left], [, right]) => left.order - right.order));
    return Object.fromEntries(Object.entries(groups).sort(([left], [right]) => {
      const leftOrder = sectionOrder[left] ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = sectionOrder[right] ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.localeCompare(right, 'pt-BR');
    }));
  }, [fields, sectionOrder]);

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

  const orderedProfileBlocks = useMemo(
    () => Object.entries(profileBlocks).sort(([, left], [, right]) => left.order - right.order),
    [profileBlocks],
  );
  const orderedSectionContainers = useMemo(() => {
    const containers = orderedProfileBlocks.length > 0
      ? [SYSTEM_BLOCKS_SECTION, ...Object.keys(grouped)]
      : Object.keys(grouped);
    return containers
      .map((section, index) => ({ section, fallbackOrder: (index + 1) * 10 }))
      .sort((left, right) => {
        const leftOrder = sectionOrder[left.section] ?? left.fallbackOrder;
        const rightOrder = sectionOrder[right.section] ?? right.fallbackOrder;
        return leftOrder - rightOrder || left.fallbackOrder - right.fallbackOrder;
      })
      .map(({ section }) => section);
  }, [grouped, orderedProfileBlocks.length, sectionOrder]);

  const editing = editingKey ? fields[editingKey] : null;

  function toggleSection(section: string) {
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));
  }

  function updateField(key: string, patch: Partial<EditableFieldMapEntry>) {
    setFields((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  function addSection() {
    const section = window.prompt('Nome da nova seção');
    if (!section?.trim()) return;
    const label = window.prompt('Nome do primeiro campo desta seção') ?? 'Novo campo';
    addField(section.trim(), label.trim() || 'Novo campo');
    setSectionOrder((current) => current[section.trim()] == null ? { ...current, [section.trim()]: Object.keys(current).length * 10 + 10 } : current);
  }

  function addField(section: string, label = 'Novo campo', patch: Partial<EditableFieldMapEntry> = {}) {
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
        type: 'text',
        visibility: 'public',
        employee_visible: true,
        employee_editable: false,
        required: false,
        lgpd: defaultLgpd(section, 'public'),
        ...patch,
        label,
        section,
        order: patch.order ?? order,
      },
    }));
    setEditingKey(key);
  }

  function addGroup(section: string) {
    const groupLabel = window.prompt('Nome do grupo');
    if (!groupLabel?.trim()) return;
    const fieldLabel = window.prompt('Nome do primeiro campo deste grupo') ?? 'Novo campo';
    const groupId = makeId(`${section}_${groupLabel}`);
    const groupCount = new Set((grouped[section] ?? []).map(([, entry]) => entry.group?.id).filter(Boolean)).size;
    addField(section, fieldLabel.trim() || 'Novo campo', {
      group: {
        id: groupId,
        label: groupLabel.trim(),
        order: (groupCount + 1) * 10,
      },
    });
  }

  function addSubgroup(section: string, group: NonNullable<EditableFieldMapEntry['group']>) {
    const subgroupLabel = window.prompt('Nome do subgrupo');
    if (!subgroupLabel?.trim()) return;
    const fieldLabel = window.prompt('Nome do primeiro campo deste subgrupo') ?? 'Novo campo';
    const subgroupCount = new Set(
      (grouped[section] ?? [])
        .filter(([, entry]) => entry.group?.id === group.id)
        .map(([, entry]) => entry.subgroup?.id)
        .filter(Boolean)
    ).size;
    addField(section, fieldLabel.trim() || 'Novo campo', {
      group,
      subgroup: {
        id: makeId(`${section}_${group.id}_${subgroupLabel}`),
        label: subgroupLabel.trim(),
        group_id: group.id,
        order: (subgroupCount + 1) * 10,
      },
    });
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
    setSectionOrder((current) => {
      const next = { ...current };
      if (next[oldName] != null) {
        next[nextName.trim()] = next[oldName];
        delete next[oldName];
      }
      return next;
    });
  }

  function deleteField(key: string) {
    if (!window.confirm('Remover este campo do perfil?')) return;
    setFields((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (editingKey === key) setEditingKey(null);
  }

  function updateFieldGroup(key: string, label: string) {
    setFields((current) => {
      const entry = current[key];
      if (!entry) return current;
      const previousGroup = entry.group;
      const trimmed = label.trim();
      const nextGroup = trimmed
        ? {
            id: previousGroup?.id ?? makeId(`${entry.section}_${trimmed}`),
            label: trimmed,
            order: previousGroup?.order ?? entry.order,
            ...(previousGroup?.conditionals?.length ? { conditionals: previousGroup.conditionals } : {}),
            ...(previousGroup?.repeatable ? { repeatable: previousGroup.repeatable } : {}),
          }
        : undefined;
      return Object.fromEntries(
        Object.entries(current).map(([itemKey, item]) => {
          const belongsToGroup = Boolean(previousGroup?.id && item.group?.id === previousGroup.id);
          if (!belongsToGroup && itemKey !== key) return [itemKey, item];
          return [itemKey, { ...item, group: nextGroup, subgroup: nextGroup ? item.subgroup : undefined }];
        })
      );
    });
  }

  function updateFieldSubgroup(key: string, label: string) {
    setFields((current) => {
      const entry = current[key];
      if (!entry?.group) return current;
      const previousSubgroup = entry.subgroup;
      const trimmed = label.trim();
      const nextSubgroup = trimmed
        ? {
            id: previousSubgroup?.id ?? makeId(`${entry.section}_${entry.group.id}_${trimmed}`),
            label: trimmed,
            group_id: entry.group.id,
            order: previousSubgroup?.order ?? entry.order,
            ...(previousSubgroup?.conditionals?.length ? { conditionals: previousSubgroup.conditionals } : {}),
          }
        : undefined;
      return Object.fromEntries(
        Object.entries(current).map(([itemKey, item]) => {
          const belongsToSubgroup = Boolean(previousSubgroup?.id && item.subgroup?.id === previousSubgroup.id);
          if (!belongsToSubgroup && itemKey !== key) return [itemKey, item];
          return [itemKey, { ...item, subgroup: nextSubgroup }];
        })
      );
    });
  }

  function updateGroupRepeatable(key: string, enabled: boolean) {
    setFields((current) => {
      const entry = current[key];
      if (!entry?.group) return current;
      const nextGroup = {
        ...entry.group,
        repeatable: enabled
          ? {
              enabled: true,
              add_label: entry.group.repeatable?.add_label ?? `Adicionar ${entry.group.label.toLowerCase()}`,
              item_label: entry.group.repeatable?.item_label ?? entry.group.label,
              ...(entry.group.repeatable?.max_items ? { max_items: entry.group.repeatable.max_items } : {}),
            }
          : undefined,
      };
      return Object.fromEntries(
        Object.entries(current).map(([itemKey, item]) => [
          itemKey,
          item.group?.id === entry.group?.id ? { ...item, group: nextGroup } : item,
        ])
      );
    });
  }

  function updateShowIf(key: string, controllerKey: string, rawValue: string) {
    if (!controllerKey) {
      updateField(key, { conditionals: undefined });
      return;
    }
    const controller = fields[controllerKey];
    const value = controller?.type === 'boolean'
      ? rawValue === 'false' ? false : true
      : rawValue;
    updateField(key, {
      conditionals: [{
        kind: 'show_if',
        field: controllerKey,
        operator: controller?.type === 'boolean' || rawValue ? 'eq' : 'truthy',
        ...(controller?.type === 'boolean' || rawValue ? { value } : {}),
      }],
    });
  }

  function updateProfileBlock(key: string, patch: Partial<ProfileBlockConfig>) {
    setProfileBlocks((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
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

  function handleProfileBlockDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId || activeId === overId) return;
    const oldIndex = orderedProfileBlocks.findIndex(([key]) => key === activeId);
    const newIndex = orderedProfileBlocks.findIndex(([key]) => key === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(orderedProfileBlocks, oldIndex, newIndex);
    setProfileBlocks((current) => {
      const next = { ...current };
      reordered.forEach(([key], index) => {
        next[key] = { ...next[key], order: 1000 + (index + 1) * 10 };
      });
      return next;
    });
  }

  function handleSectionDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id).replace(/^section:/, '');
    const overId = event.over?.id ? String(event.over.id).replace(/^section:/, '') : null;
    if (!overId || activeId === overId) return;
    const oldIndex = orderedSectionContainers.indexOf(activeId);
    const newIndex = orderedSectionContainers.indexOf(overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(orderedSectionContainers, oldIndex, newIndex);
    setSectionOrder((current) => {
      const next = { ...current };
      reordered.forEach((section, index) => {
        next[section] = (index + 1) * 10;
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
        body: JSON.stringify({ version: fieldMap?.version ?? 'coala-rh-v1.3', fields, section_order: sectionOrder, profile_blocks: profileBlocks }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Falha ao salvar campos.');
      setFieldMap((current) => ({
        version: current?.version ?? 'coala-rh-v1.3',
        fields,
        section_order: sectionOrder,
        profile_blocks: profileBlocks,
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
  const showIfRule = editing?.conditionals?.find((rule) => rule.kind === 'show_if');
  const showIfValue = showIfRule?.operator === 'truthy' ? '' : String(showIfRule?.value ?? '');
  const controllerOptions = Object.entries(fields).filter(([key]) => key !== editingKey);
  const normalizedQuery = query.trim().toLowerCase();
  const displayedProfileBlocks = orderedProfileBlocks.filter(([key, block]) => {
    if (!normalizedQuery) return true;
    return (
      key.toLowerCase().includes(normalizedQuery) ||
      block.label.toLowerCase().includes(normalizedQuery) ||
      'blocos do sistema'.includes(normalizedQuery)
    );
  });
  const visibleSectionContainers = orderedSectionContainers.filter((section) => {
    if (section === SYSTEM_BLOCKS_SECTION) return displayedProfileBlocks.length > 0;
    return (displayedGrouped[section] ?? []).length > 0;
  });

  return (
    <div className="space-y-5 bg-[var(--bg)] px-4 py-5 text-[#1d1d26] md:px-5">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-black tracking-tight text-[#181820]">Campos do Perfil</h1>
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
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9d9da9]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-12 w-full rounded-2xl border-0 bg-[#f7f7f9] pl-12 pr-4 text-base font-medium text-[#4f4f5b] outline-none placeholder:text-[#9d9da9]"
              placeholder="Buscar campo por nome ou chave..."
            />
          </div>
          <div className="flex max-w-full gap-2 overflow-x-auto">
            {visibilityTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setVisibilityFilter(tab.value)}
                className={`inline-flex min-w-max items-center gap-2 rounded-xl px-5 py-3 text-sm font-black transition ${
                  visibilityFilter === tab.value
                    ? 'bg-slate-950 text-white'
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
      </div>

      {message ? <p className="rounded-2xl bg-white px-5 py-4 text-sm font-black text-[#6f6f7c] shadow-sm ring-1 ring-[#dedfe4]">{message}</p> : null}

      {visibleSectionContainers.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-[#cfd0d8] bg-white px-5 py-10 text-center text-sm font-black text-[#777784]">
          Nenhum campo encontrado.
        </div>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
        <SortableContext items={visibleSectionContainers.map((section) => `section:${section}`)} strategy={verticalListSortingStrategy}>
          {visibleSectionContainers.map((section) => {
            if (section === SYSTEM_BLOCKS_SECTION) {
              return (
                <SortableSectionOrderFrame
                  key={section}
                  id={`section:${section}`}
                  section="Blocos do sistema"
                  count={displayedProfileBlocks.length}
                  countLabel={displayedProfileBlocks.length === 1 ? 'bloco' : 'blocos'}
                  tag="Sistema"
                  collapsed={collapsedSections[SYSTEM_BLOCKS_SECTION] === true}
                  onToggle={() => toggleSection(SYSTEM_BLOCKS_SECTION)}
                >
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleProfileBlockDragEnd}>
                    <SortableContext items={displayedProfileBlocks.map(([key]) => key)} strategy={verticalListSortingStrategy}>
                      <div className="overflow-x-auto border-t border-[#ececf0]">
                        <div className="grid min-w-[760px] gap-3 bg-[#fbfbfc] px-5 py-3 text-xs font-black uppercase tracking-wide text-[#9d9da9]" style={{ gridTemplateColumns: ORDER_GRID_TEMPLATE }}>
                          <span />
                          <span>Ordem</span>
                          <span>Bloco</span>
                          <span>Tipo</span>
                          <span>Colaborador</span>
                        </div>
                        {displayedProfileBlocks.map(([key, block], index) => (
                          <SortableProfileBlockRow
                            key={key}
                            id={key}
                            block={block}
                            position={index + 1}
                            onToggleVisible={() => updateProfileBlock(key, { employee_visible: !block.employee_visible, employee_editable: !block.employee_visible ? block.employee_editable : false })}
                            onToggleEditable={() => updateProfileBlock(key, { employee_editable: !block.employee_editable, employee_visible: block.employee_visible || !block.employee_editable })}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </SortableSectionOrderFrame>
              );
            }

            const items = displayedGrouped[section] ?? [];
            return (
              <SortableSectionOrderFrame
                key={section}
                id={`section:${section}`}
                section={section}
                count={items.length}
                tag="Seção"
                actions={(
                  <>
                    <button type="button" onClick={() => addGroup(section)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-3 text-sm font-black text-[#6f6f7c] hover:bg-[#f7f7f9]">
                      <Plus className="h-4 w-4" />
                      Grupo
                    </button>
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
                  </>
                )}
                collapsed={collapsedSections[section] === true}
                onToggle={() => toggleSection(section)}
              >
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => handleDragEnd(section, event)}>
                  <SortableContext items={items.map(([key]) => key)} strategy={verticalListSortingStrategy}>
                    <div className="overflow-x-auto border-t border-[#ececf0]">
                      <div className="grid min-w-[1120px] gap-4 bg-[#fbfbfc] px-5 py-3 text-xs font-black uppercase tracking-wide text-[#9d9da9]" style={{ gridTemplateColumns: FIELD_GRID_TEMPLATE }}>
                        <span />
                        <span>Campo</span>
                        <span>Tipo</span>
                        <span>Visibilidade</span>
                        <span>LGPD</span>
                        <span>Colaborador</span>
                        <span className="text-right">Ações</span>
                      </div>
                      {(() => {
                        let previousGroup = '';
                        let previousSubgroup = '';
                        return items.map(([key, entry]) => {
                          const group = entry.group;
                          const subgroup = entry.subgroup;
                          const groupKey = fieldGroupKey(entry);
                          const subgroupKey = fieldSubgroupKey(entry);
                          const showGroup = Boolean(group && groupKey !== previousGroup);
                          const showSubgroup = Boolean(subgroup && `${groupKey}:${subgroupKey}` !== previousSubgroup);
                          previousGroup = groupKey;
                          previousSubgroup = subgroup ? `${groupKey}:${subgroupKey}` : '';
                          return (
                            <Fragment key={key}>
                              {showGroup && group ? (
                                <div className="min-w-[1120px] border-b border-[#f2d7e4] bg-[#fff8fc] px-5 py-3">
                                  <div className="flex flex-wrap items-center justify-between gap-3 pl-12">
                                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                                      <ChevronDown className="h-4 w-4 text-[#bd185c]" />
                                      <span className="rounded-md border border-[#ffd3e5] bg-white px-2 py-1 text-[10px] font-black uppercase text-[#df2f78]">
                                        Grupo
                                      </span>
                                      <span className="text-sm font-black text-[#1d1d26]">{group.label}</span>
                                      <span className="rounded-full bg-[#e6e6ea] px-2.5 py-1 text-[11px] font-black text-[#6f6f7c]">
                                        {items.filter(([, item]) => item.group?.id === group.id).length} campos
                                      </span>
                                      <ConditionBadge conditionals={group.conditionals ?? entry.conditionals} fields={fields} />
                                      {group.repeatable?.enabled ? (
                                        <span className="rounded-full bg-[#eafaf2] px-3 py-1 text-xs font-black text-[#008963]">
                                          Respostas múltiplas
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button type="button" onClick={() => addSubgroup(section, group)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-black text-[#6f6f7c] ring-1 ring-[#f2d7e4] hover:text-[#df2f78]">
                                        <Plus className="h-3.5 w-3.5" />
                                        Subgrupo
                                      </button>
                                      <button type="button" onClick={() => addField(section, 'Novo campo', { group })} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#fff0f6] px-3 text-xs font-black text-[#df2f78] hover:bg-[#fde5f0]">
                                        <Plus className="h-3.5 w-3.5" />
                                        Campo
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                              {showSubgroup && subgroup ? (
                                <div className="min-w-[1120px] border-b border-[#f0e8ef] bg-[#fffbfd] px-5 py-3">
                                  <div className="flex flex-wrap items-center justify-between gap-3 pl-20">
                                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                                      <ChevronDown className="h-4 w-4 text-[#9d9da9]" />
                                      <span className="rounded-md border border-[#dedfe4] bg-white px-2 py-1 text-[10px] font-black uppercase text-[#8f8f9b]">
                                        Subgrupo
                                      </span>
                                      <span className="text-sm font-black text-[#1d1d26]">{subgroup.label}</span>
                                      <span className="rounded-full bg-[#e6e6ea] px-2.5 py-1 text-[11px] font-black text-[#6f6f7c]">
                                        {items.filter(([, item]) => item.subgroup?.id === subgroup.id).length} campos
                                      </span>
                                      <ConditionBadge conditionals={subgroup.conditionals ?? entry.conditionals} fields={fields} />
                                    </div>
                                    <button type="button" onClick={() => addField(section, 'Novo campo', { group, subgroup })} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#fff0f6] px-3 text-xs font-black text-[#df2f78] hover:bg-[#fde5f0]">
                                      <Plus className="h-3.5 w-3.5" />
                                      Campo
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                              <SortableFieldRow id={key} entry={entry} onEdit={() => setEditingKey(key)} onDelete={() => deleteField(key)} />
                            </Fragment>
                          );
                        });
                      })()}
                    </div>
                  </SortableContext>
                </DndContext>
              </SortableSectionOrderFrame>
            );
          })}
        </SortableContext>
      </DndContext>

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
                Grupo
                <input value={editing.group?.label ?? ''} onChange={(event) => updateFieldGroup(editingKey, event.target.value)} placeholder="Ex.: CNH, Dependente" className="w-full rounded-2xl border border-[#dedfe4] px-4 py-3 text-sm font-semibold text-[#1d1d26] outline-none" />
              </label>
              <label className="space-y-2 text-xs font-black uppercase text-[#9d9da9]">
                Subgrupo
                <input value={editing.subgroup?.label ?? ''} onChange={(event) => updateFieldSubgroup(editingKey, event.target.value)} disabled={!editing.group} placeholder="Ex.: Validade da CNH" className="w-full rounded-2xl border border-[#dedfe4] px-4 py-3 text-sm font-semibold text-[#1d1d26] outline-none disabled:bg-[#f7f7f9] disabled:text-[#b7b7c1]" />
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
              <label className="space-y-2 text-xs font-black uppercase text-[#9d9da9]">
                Aparece quando
                <select value={showIfRule?.field ?? ''} onChange={(event) => updateShowIf(editingKey, event.target.value, 'true')} className="w-full rounded-2xl border border-[#dedfe4] px-4 py-3 text-sm font-semibold text-[#1d1d26] outline-none">
                  <option value="">Sempre aparece</option>
                  {controllerOptions.map(([key, entry]) => <option key={key} value={key}>{entry.label}</option>)}
                </select>
              </label>
              <label className="space-y-2 text-xs font-black uppercase text-[#9d9da9]">
                Valor da condição
                {fields[showIfRule?.field ?? '']?.type === 'boolean' ? (
                  <select value={showIfValue || 'true'} disabled={!showIfRule} onChange={(event) => updateShowIf(editingKey, showIfRule?.field ?? '', event.target.value)} className="w-full rounded-2xl border border-[#dedfe4] px-4 py-3 text-sm font-semibold text-[#1d1d26] outline-none disabled:bg-[#f7f7f9] disabled:text-[#b7b7c1]">
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                  </select>
                ) : (
                  <input value={showIfValue} disabled={!showIfRule} onChange={(event) => updateShowIf(editingKey, showIfRule?.field ?? '', event.target.value)} placeholder="Deixe vazio para preenchido" className="w-full rounded-2xl border border-[#dedfe4] px-4 py-3 text-sm font-semibold text-[#1d1d26] outline-none disabled:bg-[#f7f7f9] disabled:text-[#b7b7c1]" />
                )}
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
              <label className="flex items-center gap-2 rounded-2xl bg-[#f7f7f9] p-3 text-xs font-bold text-[#6f6f7c]">
                <input type="checkbox" checked={editing.group?.repeatable?.enabled === true} disabled={!editing.group} onChange={(event) => updateGroupRepeatable(editingKey, event.target.checked)} />
                Grupo com várias respostas
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
