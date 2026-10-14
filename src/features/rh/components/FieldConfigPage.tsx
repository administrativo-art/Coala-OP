'use client';

import { Fragment, useEffect, useMemo, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, ChevronDown, Eye, EyeOff, Globe2, GripVertical, Link2, Lock, Pencil, Plus, Save, Search, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Field, fieldInputClass } from '@/components/patterns/field';
import { systemFieldsRepresentedByProfileBlocks } from '@/features/hr/lib/collaborator-system-fields';
import type { FieldMap, FieldMapEntry, FieldType, FieldVisibility, NormalizedFieldVisibility, ProfileAccessActor, ProfileAccessMatrix, ProfileAccessPermission, ProfileBlockConfig, ProfileSelfServicePolicy } from '@/types/rh';
import { DEFAULT_PROFILE_ACCESS_MATRIX, normalizeFieldVisibility, normalizeProfileAccessMatrix } from '@/types/rh';

type EditableFieldMapEntry = FieldMapEntry;
type FieldTuple = [string, EditableFieldMapEntry];
type AccessOption = { id: string; label: string; description?: string };
type StructurePanelState =
  | { kind: 'section'; sectionName: string; fieldLabel: string }
  | { kind: 'group'; section: string; groupLabel: string; fieldLabel: string }
  | { kind: 'subgroup'; section: string; group: NonNullable<FieldMapEntry['group']>; subgroupLabel: string; fieldLabel: string }
  | { kind: 'rename_section'; section: string; nextName: string }
  | { kind: 'delete_field'; key: string; label: string };

const FIELD_TYPES: FieldType[] = ['text', 'multiline', 'date', 'number', 'currency', 'boolean', 'single_select', 'multi_select', 'ref:jobRoles'];
const VISIBILITIES: NormalizedFieldVisibility[] = ['public', 'restricted_partial', 'restricted_total', 'confidential'];

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

const VISIBILITY_LABELS: Record<NormalizedFieldVisibility, string> = {
  public: 'Sem restrição',
  restricted_partial: 'Restrito parcial',
  restricted_total: 'Restrito total',
  confidential: 'Confidencial',
};

const LGPD_CATEGORY_LABELS = {
  personal: 'Dado pessoal',
  sensitive: 'Dado pessoal sensível',
} as const;

type LgpdCategory = keyof typeof LGPD_CATEGORY_LABELS;

const LEGAL_BASIS_LABELS = {
  legal_obligation: 'Obrigação legal',
  contract: 'Contrato',
  legitimate_interest: 'Interesse legítimo',
  consent: 'Consentimento',
  life_protection: 'Proteção da vida',
  health_guardianship: 'Tutela da saúde',
} as const;

const RETENTION_LABELS = {
  employment_plus_5y: 'Vínculo + 5 anos',
  termination_plus_90d: 'Desligamento + 90 dias',
  termination_plus_2y: 'Desligamento + 2 anos',
  manual_review: 'Revisão manual',
} as const;

const FIELD_GRID_TEMPLATE = '48px 44px minmax(280px, 1.6fr) 150px 170px 190px';
const ORDER_GRID_TEMPLATE = '44px 44px minmax(0, 1fr) 150px 170px';
const SYSTEM_BLOCKS_SECTION = '__system_blocks';

const PROFILE_ACCESS_ACTORS: Array<{ key: ProfileAccessActor; label: string; helper: string }> = [
  { key: 'authenticated', label: 'Autenticado', helper: 'Usuário com acesso base ao módulo.' },
  { key: 'owner', label: 'Titular', helper: 'Colaborador vendo o próprio perfil.' },
  { key: 'manager', label: 'Gestor', helper: 'Gestor/RH operacional com escopo de equipe.' },
  { key: 'admin', label: 'Administrador', helper: 'Administrador ou RH elevado.' },
  { key: 'explicit', label: 'Exceção', helper: 'Cargo, função ou pessoa liberada nesta visibilidade.' },
];

const PROFILE_ACCESS_PERMISSIONS: Array<{ value: ProfileAccessPermission; label: string }> = [
  { value: 'hidden', label: 'Oculto' },
  { value: 'view', label: 'Ver' },
  { value: 'edit', label: 'Editar' },
];

const SELF_SERVICE_POLICIES: Array<{ value: ProfileSelfServicePolicy; label: string; helper: string }> = [
  { value: 'inherit', label: 'Herdar da matriz', helper: 'Usa a permissão do Titular configurada para esta visibilidade.' },
  { value: 'blocked', label: 'Somente leitura', helper: 'O colaborador visualiza o campo, mas não pode solicitar nem aplicar alterações.' },
  { value: 'direct', label: 'Alteração direta', helper: 'O próprio colaborador altera o valor e a mudança entra no histórico.' },
  { value: 'approval', label: 'Sujeita à aprovação', helper: 'A proposta fica pendente e só altera o perfil após aprovação do RH.' },
];

const ACCESS_MATRIX_GRID = '210px repeat(5, minmax(0, 1fr))';

const VISIBILITY_DOTS: Record<NormalizedFieldVisibility, { dot: string; halo: string }> = {
  public: { dot: '#22a565', halo: 'rgba(34,165,101,.14)' },
  restricted_partial: { dot: '#e0a112', halo: 'rgba(224,161,18,.14)' },
  restricted_total: { dot: '#e5732a', halo: 'rgba(229,115,42,.14)' },
  confidential: { dot: '#dc3b4b', halo: 'rgba(220,59,75,.14)' },
};

const VISIBILITY_TONES: Record<NormalizedFieldVisibility, { bg: string; fg: string; dot: string }> = {
  public: { bg: '#eafaf2', fg: '#008963', dot: '#22a565' },
  restricted_partial: { bg: '#eef7ff', fg: '#2563eb', dot: '#2f6fed' },
  restricted_total: { bg: '#fff5db', fg: '#d17400', dot: '#e59015' },
  confidential: { bg: '#ffe9ef', fg: '#d9275f', dot: '#dc3b4b' },
};

const VISIBILITY_HELP: Record<NormalizedFieldVisibility, { title: string; description: string }> = {
  public: {
    title: 'Sem restrição',
    description: 'Na regra padrão, usuários autenticados e o próprio titular podem visualizar; gestores e administradores podem editar.',
  },
  restricted_partial: {
    title: 'Restrito parcial',
    description: 'Na regra padrão, o titular pode visualizar, gestores e administradores podem editar e os demais usuários não veem o campo.',
  },
  restricted_total: {
    title: 'Restrito total',
    description: 'Na regra padrão, o campo fica oculto para o titular e usuários comuns; apenas gestores e administradores podem editá-lo.',
  },
  confidential: {
    title: 'Confidencial',
    description: 'Na regra padrão, somente administradores acessam o campo. Outras pessoas dependem de uma exceção explícita nas Regras de acesso.',
  },
};

const VISIBILITY_ICONS: Record<NormalizedFieldVisibility, typeof Eye> = {
  public: Globe2,
  restricted_partial: Eye,
  restricted_total: Lock,
  confidential: EyeOff,
};

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

function normalizeLgpdCategory(category: unknown): LgpdCategory {
  return category === 'sensitive' ? 'sensitive' : 'personal';
}

function cloneFieldEntry(entry: EditableFieldMapEntry): EditableFieldMapEntry {
  return structuredClone(entry);
}

function defaultLgpd(section: string, _visibility: FieldVisibility): NonNullable<FieldMapEntry['lgpd']> {
  const lower = section.toLowerCase();
  const consent = lower.includes('diversidade');
  const sensitive = /sa[uú]de|aso|biometri|racial|etni|religi|sindic|sexual|gen[eé]tic|diversidade/.test(lower);
  return {
    category: sensitive ? 'sensitive' : 'personal',
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

function getSectionVisibilitySummary(items: FieldTuple[]) {
  const visibility = normalizeFieldVisibility(items[0]?.[1]?.visibility ?? 'confidential');
  return {
    visibility,
    mixed: items.some(([, entry]) => normalizeFieldVisibility(entry.visibility) !== visibility),
  };
}

function cleanAccessIds(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function readAccessOptions(payload: unknown, key: 'roles' | 'functions'): AccessOption[] {
  if (!payload || typeof payload !== 'object') return [];
  const list = (payload as Record<string, unknown>)[key];
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      const label = typeof record.name === 'string' ? record.name.trim() : id;
      return id ? { id, label } : null;
    })
    .filter((item): item is AccessOption => Boolean(item))
    .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
}

function uniqueUserOptions(users: Array<{ id?: string; username?: string; email?: string; jobRoleName?: string }>): AccessOption[] {
  const byId = new Map<string, AccessOption>();
  users.forEach((user) => {
    const id = user.id?.trim();
    if (!id || byId.has(id)) return;
    byId.set(id, {
      id,
      label: user.username?.trim() || user.email?.trim() || id,
      description: user.jobRoleName,
    });
  });
  return Array.from(byId.values()).sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
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
  const normalizedVisibility = normalizeFieldVisibility(visibility);
  const Icon = normalizedVisibility === 'public' ? Globe2 : normalizedVisibility === 'restricted_partial' ? Eye : normalizedVisibility === 'restricted_total' ? Lock : EyeOff;
  const tone =
    normalizedVisibility === 'public' ? 'bg-[#eafaf2] text-[#008963]' :
    normalizedVisibility === 'restricted_partial' ? 'bg-[#eef7ff] text-[#2563eb]' :
    normalizedVisibility === 'restricted_total' ? 'bg-[#fff5db] text-[#d17400]' :
    'bg-[#ffe9ef] text-[#d9275f]';
  return (
    <span className={`inline-flex w-fit items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-black ${tone}`}>
      <Icon className="h-3.5 w-3.5" />
      {VISIBILITY_LABELS[normalizedVisibility]}
    </span>
  );
}

function SectionVisibilitySelect({
  visibility,
  mixed,
  onChange,
}: {
  visibility: NormalizedFieldVisibility;
  mixed?: boolean;
  onChange: (visibility: FieldVisibility) => void;
}) {
  const [open, setOpen] = useState(false);
  const CurrentIcon = VISIBILITY_ICONS[visibility];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Alterar visibilidade da seção"
          className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] bg-white px-2.5 text-[11.5px] font-extrabold text-[#6f6f7c] ring-1 ring-[#ececf0] hover:bg-[#fbfbfc]"
        >
          <span>Visibilidade</span>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#dedfe4] bg-white px-2 text-[11.5px] font-extrabold text-[#1d1d26]">
            <CurrentIcon className="h-3.5 w-3.5" style={{ color: VISIBILITY_TONES[visibility].fg }} />
            {mixed ? 'Visibilidade mista' : VISIBILITY_LABELS[visibility]}
            <ChevronDown className="h-3.5 w-3.5 text-[#777784]" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[390px] max-w-[calc(100vw-24px)] rounded-xl border-[#dedfe4] p-2 shadow-xl">
        <div className="mb-1 px-2 py-1.5">
          <p className="text-xs font-black text-[#1d1d26]">Visibilidade da seção</p>
          <p className="mt-0.5 text-[11px] font-medium leading-4 text-[#777784]">A escolha é aplicada a todos os campos desta seção. As Regras de acesso podem personalizar o comportamento padrão.</p>
        </div>
        <div className="space-y-1">
          {VISIBILITIES.map((option) => {
            const Icon = VISIBILITY_ICONS[option];
            const selected = !mixed && option === visibility;
            return (
              <div key={option} className={`flex items-center gap-1 rounded-lg ${selected ? 'bg-[#fff0f6]' : 'hover:bg-[#f7f7f9]'}`}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2.5 text-left"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: VISIBILITY_TONES[option].bg, color: VISIBILITY_TONES[option].fg }}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-extrabold text-[#1d1d26]">{VISIBILITY_LABELS[option]}</span>
                  {selected ? <Check className="h-4 w-4 shrink-0 text-[#df2f78]" /> : null}
                </button>
                <span className="pr-2">
                  <InfoTooltip title={VISIBILITY_HELP[option].title}>
                    <p>{VISIBILITY_HELP[option].description}</p>
                  </InfoTooltip>
                </span>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const PERMISSION_ICONS: Record<ProfileAccessPermission, typeof Eye> = {
  hidden: EyeOff,
  view: Eye,
  edit: Pencil,
};

const PERMISSION_ACTIVE_STYLES: Record<ProfileAccessPermission, string> = {
  hidden: 'bg-[#e2e5e9] text-[#5b616b]',
  view: 'bg-[#334155] text-white shadow-[0_2px_5px_-2px_rgba(20,22,28,.4)]',
  edit: 'bg-[#df2f78] text-white shadow-[0_2px_5px_-2px_rgba(20,22,28,.4)]',
};

function PermissionToggle({
  value,
  onChange,
  label,
}: {
  value: ProfileAccessPermission;
  onChange: (permission: ProfileAccessPermission) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-[11px] bg-[#f1f2f4] p-[3px]">
      {PROFILE_ACCESS_PERMISSIONS.map((permission) => {
        const active = value === permission.value;
        const Icon = PERMISSION_ICONS[permission.value];
        return (
          <button
            key={permission.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(permission.value)}
            title={`${label}: ${permission.label}`}
            className={`grid h-[27px] w-[30px] place-items-center rounded-lg transition ${
              active ? PERMISSION_ACTIVE_STYLES[permission.value] : 'text-[#aab0b9] hover:text-[#6a707a]'
            }`}
          >
            <Icon className="h-[15px] w-[15px]" />
            <span className="sr-only">{permission.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function PermissionLegend() {
  return (
    <div className="flex items-center gap-4 text-[12.5px] font-medium text-[#6a707a]">
      {PROFILE_ACCESS_PERMISSIONS.map((permission) => {
        const Icon = PERMISSION_ICONS[permission.value];
        return (
          <span key={permission.value} className="inline-flex items-center gap-1.5">
            <span className={`grid h-[22px] w-[22px] place-items-center rounded-[7px] ${PERMISSION_ACTIVE_STYLES[permission.value]}`}>
              <Icon className="h-[13px] w-[13px]" />
            </span>
            {permission.label}
          </span>
        );
      })}
    </div>
  );
}

function AccessOptionPicker({
  label,
  helper,
  options,
  selectedIds,
  onChange,
  emptyLabel,
}: {
  label: string;
  helper: string;
  options: AccessOption[];
  selectedIds?: string[];
  onChange: (nextIds: string[]) => void;
  emptyLabel: string;
}) {
  const selected = cleanAccessIds(selectedIds ?? []);
  const optionById = new Map(options.map((option) => [option.id, option]));
  const availableOptions = options.filter((option) => !selected.includes(option.id));

  function add(id: string) {
    if (!id) return;
    onChange(cleanAccessIds([...selected, id]));
  }

  function remove(id: string) {
    onChange(selected.filter((item) => item !== id));
  }

  return (
    <div className="rounded-2xl border border-[#e7e7ec] bg-white p-3">
      <p className="text-xs font-black uppercase tracking-wide text-[#9d9da9]">{label}</p>
      <Select value="" onValueChange={add} disabled={availableOptions.length === 0}>
        <SelectTrigger
          aria-label={`Adicionar ${label.toLowerCase()}`}
          className="mt-2 h-11 w-full rounded-xl border-[#dedfe4] bg-white px-3 text-sm font-semibold text-[#1d1d26] disabled:bg-[#f7f7f9] disabled:text-[#9d9da9]"
        >
          <SelectValue placeholder={availableOptions.length === 0 ? emptyLabel : `Adicionar ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {availableOptions.map((option) => (
            <SelectItem key={option.id} value={option.id} className="text-sm font-semibold">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-2 text-[11px] font-semibold leading-relaxed text-[#8f8f9b]">{helper}</p>
      {selected.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {selected.map((id) => {
            const option = optionById.get(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => remove(id)}
                className="rounded-full border border-[#dbeafe] bg-[#eff6ff] px-3 py-1.5 text-left text-xs font-black text-[#2563eb] hover:border-[#bfdbfe]"
                title="Remover acesso explícito"
              >
                {option?.label ?? id}
                <span className="ml-2 text-[#7aa2f7]">×</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AccessMatrixPanel({
  matrix,
  onChange,
  roleOptions,
  functionOptions,
  userOptions,
  showHeader = true,
}: {
  matrix: ProfileAccessMatrix;
  onChange: (matrix: ProfileAccessMatrix) => void;
  roleOptions: AccessOption[];
  functionOptions: AccessOption[];
  userOptions: AccessOption[];
  showHeader?: boolean;
}) {
  const normalizedMatrix = normalizeProfileAccessMatrix(matrix);

  function permissionFor(visibility: NormalizedFieldVisibility, actor: ProfileAccessActor) {
    return normalizedMatrix.visibility[visibility]?.[actor] ?? DEFAULT_PROFILE_ACCESS_MATRIX.visibility[visibility]?.[actor] ?? 'hidden';
  }

  function bindingsFor(visibility: NormalizedFieldVisibility) {
    return normalizedMatrix.visibility[visibility]?.bindings ?? {};
  }

  function bindingCount(visibility: NormalizedFieldVisibility) {
    const bindings = bindingsFor(visibility);
    return (
      cleanAccessIds(bindings.roleIds ?? []).length +
      cleanAccessIds(bindings.functionIds ?? []).length +
      cleanAccessIds(bindings.userIds ?? []).length
    );
  }

  function updatePermission(visibility: NormalizedFieldVisibility, actor: ProfileAccessActor, permission: ProfileAccessPermission) {
    const next = normalizeProfileAccessMatrix(normalizedMatrix);
    next.visibility = {
      ...next.visibility,
      [visibility]: {
        ...(next.visibility[visibility] ?? {}),
        [actor]: permission,
      },
    };
    onChange(next);
  }

  function updateBinding(visibility: NormalizedFieldVisibility, target: 'roleIds' | 'functionIds' | 'userIds', values: string[]) {
    const nextValues = cleanAccessIds(values);
    const next = normalizeProfileAccessMatrix(normalizedMatrix);
    const rule = { ...(next.visibility[visibility] ?? {}) };
    const nextBindings = {
      ...(rule.bindings ?? {}),
      [target]: nextValues.length ? nextValues : undefined,
    };
    const hasBindings =
      cleanAccessIds(nextBindings.roleIds ?? []).length > 0 ||
      cleanAccessIds(nextBindings.functionIds ?? []).length > 0 ||
      cleanAccessIds(nextBindings.userIds ?? []).length > 0;

    if (hasBindings) {
      rule.bindings = {
        ...(cleanAccessIds(nextBindings.roleIds ?? []).length ? { roleIds: cleanAccessIds(nextBindings.roleIds ?? []) } : {}),
        ...(cleanAccessIds(nextBindings.functionIds ?? []).length ? { functionIds: cleanAccessIds(nextBindings.functionIds ?? []) } : {}),
        ...(cleanAccessIds(nextBindings.userIds ?? []).length ? { userIds: cleanAccessIds(nextBindings.userIds ?? []) } : {}),
      };
    } else {
      delete rule.bindings;
    }

    next.visibility = {
      ...next.visibility,
      [visibility]: rule,
    };
    onChange(next);
  }

  return (
    <section className={showHeader ? "rounded-[22px] border border-[#dedfe4] bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.06)]" : "bg-white"}>
      {showHeader ? (
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-[#df2f78]">Regras gerais de acesso</p>
            <h2 className="mt-1 text-xl font-black text-[#181820]">Permissão padrão por visibilidade</h2>
            <p className="mt-1 max-w-4xl text-sm font-semibold leading-relaxed text-[#6f6f7c]">
              Define quem oculta, visualiza ou edita cada nível. A política do próprio colaborador é configurada em cada campo e pode exigir aprovação.
            </p>
          </div>
          <span className="rounded-full bg-[#fff0f6] px-3 py-1 text-xs font-black text-[#df2f78]">
            Base do perfil
          </span>
        </div>
      ) : null}
      <div className={showHeader ? 'mt-5' : ''}>
        <div className="overflow-x-auto rounded-[14px] border border-[#edeef1]">
          <div className="min-w-[860px]">
            <div
              className="grid border-b border-[#edeef1] bg-[#fafbfc]"
              style={{ gridTemplateColumns: ACCESS_MATRIX_GRID }}
            >
              <span className="px-[18px] py-[13px] text-[10.5px] font-bold uppercase tracking-[.09em] text-[#8a909a]">
                Visibilidade
              </span>
              {PROFILE_ACCESS_ACTORS.map((actor) => (
                <span
                  key={`head:${actor.key}`}
                  title={actor.helper}
                  className="cursor-help px-2 py-[13px] text-center text-[10.5px] font-bold uppercase tracking-[.07em] text-[#8a909a]"
                >
                  {actor.label}
                </span>
              ))}
            </div>

            {VISIBILITIES.map((visibility) => (
              <div
                key={visibility}
                className="grid items-start border-b border-[#f1f2f4] transition last:border-b-0 hover:bg-[#fcfcfd]"
                style={{ gridTemplateColumns: ACCESS_MATRIX_GRID }}
              >
                <div className="flex min-w-0 items-center gap-2.5 px-[18px] py-[17px]">
                  <span
                    className="h-[9px] w-[9px] flex-none rounded-full"
                    style={{
                      background: VISIBILITY_DOTS[visibility].dot,
                      boxShadow: `0 0 0 3px ${VISIBILITY_DOTS[visibility].halo}`,
                    }}
                  />
                  <span className="truncate text-sm font-semibold text-[#22262d]">{VISIBILITY_LABELS[visibility]}</span>
                </div>

                {PROFILE_ACCESS_ACTORS.map((actor) => (
                  <div key={`${visibility}:${actor.key}`} className="flex flex-col items-center gap-1.5 px-2 py-[17px]">
                    <PermissionToggle
                      value={permissionFor(visibility, actor.key)}
                      onChange={(permission) => updatePermission(visibility, actor.key, permission)}
                      label={`${VISIBILITY_LABELS[visibility]} · ${actor.label}`}
                    />
                    {actor.key === 'explicit' ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] font-semibold transition ${
                              bindingCount(visibility) > 0
                                ? 'text-[#df2f78] hover:text-[#c92368]'
                                : 'text-[#8a909a] hover:text-[#5b616b]'
                            }`}
                          >
                            <Link2 className="h-[13px] w-[13px]" />
                            {bindingCount(visibility) > 0 ? `${bindingCount(visibility)} vínculo${bindingCount(visibility) === 1 ? '' : 's'}` : 'Vincular'}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="max-h-[360px] w-[300px] overflow-y-auto rounded-lg p-3">
                          <p className="text-xs font-black text-[#1d1d26]">Vínculos da exceção</p>
                          <p className="mt-1 text-[10px] font-semibold leading-4 text-[#8f8f9b]">
                            Pessoas destes cargos, funções ou usuários recebem a permissão de Exceção em{' '}
                            {VISIBILITY_LABELS[visibility]}.
                          </p>
                          <div className="mt-2 space-y-2">
                            <AccessOptionPicker
                              label="Cargos"
                              helper="Inclui todas as pessoas vinculadas a estes cargos."
                              options={roleOptions}
                              selectedIds={bindingsFor(visibility).roleIds}
                              onChange={(values) => updateBinding(visibility, 'roleIds', values)}
                              emptyLabel="Nenhum cargo disponível"
                            />
                            <AccessOptionPicker
                              label="Funções"
                              helper="Inclui pessoas com estas funções operacionais."
                              options={functionOptions}
                              selectedIds={bindingsFor(visibility).functionIds}
                              onChange={(values) => updateBinding(visibility, 'functionIds', values)}
                              emptyLabel="Nenhuma função disponível"
                            />
                            <AccessOptionPicker
                              label="Pessoas"
                              helper="Inclui usuários específicos quando cargo ou função não resolverem."
                              options={userOptions}
                              selectedIds={bindingsFor(visibility).userIds}
                              onChange={(values) => updateBinding(visibility, 'userIds', values)}
                              emptyLabel="Nenhuma pessoa disponível"
                            />
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SensitiveDataBadge() {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-[#f2e9ff] px-2 py-1 text-[10.5px] font-black text-[#7c3aed]">
      <ShieldCheck className="h-3.5 w-3.5" />
      Dado sensível
    </span>
  );
}

function FieldEditorSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-ds-btn-lg border border-ds-border bg-ds-surface">
      <div className="border-b border-ds-divider bg-ds-warm px-4 py-3.5">
        <h3 className="text-sm font-black text-ds-ink">{title}</h3>
        <p className="mt-0.5 text-xs font-medium leading-5 text-ds-ink-muted">{description}</p>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function StyledSelect({ children, className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select {...props} className={`${fieldInputClass} appearance-none pr-12 ${className}`}>
        {children}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg border border-ds-border bg-ds-surface text-ds-ink-muted shadow-xs">
        <ChevronDown className="h-4 w-4" strokeWidth={2.25} />
      </span>
    </span>
  );
}

function FieldEditorToggle({
  checked,
  disabled,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex min-h-[72px] items-start gap-3 rounded-ds-md border p-3.5 transition ${disabled ? 'cursor-not-allowed border-ds-border bg-ds-muted opacity-60' : checked ? 'border-ds-modal bg-ds-modal-soft' : 'cursor-pointer border-ds-border bg-ds-input hover:border-ds-border-input'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-(--ds-modal)"
      />
      <span>
        <span className="block text-xs font-black text-ds-ink">{label}</span>
        <span className="mt-1 block text-[11px] font-medium leading-4 text-ds-ink-muted">{description}</span>
      </span>
    </label>
  );
}

function SortableFieldRow({
  id,
  entry,
  position,
  onEdit,
  onDelete,
}: {
  id: string;
  entry: EditableFieldMapEntry;
  position: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, gridTemplateColumns: FIELD_GRID_TEMPLATE }}
      className={`grid min-w-[1080px] items-center gap-4 border-b border-[#ececf0] bg-white px-5 py-4 text-sm last:border-b-0 ${isDragging ? 'opacity-60' : ''}`}
    >
      <button type="button" className="text-[#b7b7c1]" {...attributes} {...listeners} aria-label="Arrastar campo">
        <GripVertical className="h-5 w-5" />
      </button>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#f1f2f5] text-xs font-black text-[#737381]" title={`Ordem visual ${position}`}>
        {position}
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[15px] font-extrabold text-[#1d1d26]">{entry.label}</p>
          {normalizeLgpdCategory(entry.lgpd?.category) === 'sensitive' ? <SensitiveDataBadge /> : null}
        </div>
        <p className="mt-0.5 truncate font-mono text-xs font-medium text-[#a6a6b0]">{id}</p>
      </div>
      <TypeBadge type={entry.type} />
      <VisibilityBadge visibility={entry.visibility} />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black text-[#6f6f7c] hover:bg-[#f1f2f5] hover:text-[#1d1d26]"
          aria-label={`Configurar ${entry.label}`}
          title="Configurar campo"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Configurar
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
        <p className="truncate text-[15px] font-extrabold text-[#1d1d26]">{block.label}</p>
        <p className="mt-0.5 truncate font-mono text-xs font-medium text-[#a6a6b0]">{id}</p>
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
  position,
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
  position: number;
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
      className={`overflow-hidden rounded-[22px] border border-[#e2e0da] bg-white shadow-[0_2px_10px_rgba(15,23,42,0.06)] ${isDragging ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <button type="button" className="shrink-0 text-[#c2c2cc]" {...attributes} {...listeners} aria-label={`Arrastar seção ${section}`}>
            <GripVertical className="h-[18px] w-[18px]" />
          </button>
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-[#f1f2f5] text-xs font-extrabold text-[#737381]" title={`Ordem geral ${position}`}>
            {position}
          </span>
          <button type="button" onClick={onToggle} className="shrink-0 rounded-lg p-1 text-[#9d9da9] hover:bg-[#f1f2f5]" aria-label={collapsed ? `Expandir ${section}` : `Recolher ${section}`}>
            <ChevronDown className={`h-[18px] w-[18px] transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          </button>
          {tag ? (
            <span className="shrink-0 rounded-md border border-[#e2e0da] bg-[#f7f7f9] px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[.06em] text-[#8f8f9b]">
              {tag}
            </span>
          ) : null}
          <h2 className="truncate text-[17px] font-black text-[#1d1d26]">{section}</h2>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-[#e6e6ea] px-2.5 py-0.5 text-[11.5px] font-extrabold text-[#6f6f7c]">
            {count} {countLabel ?? (count === 1 ? 'campo' : 'campos')}
          </span>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
      {!collapsed ? children : null}
    </section>
  );
}

export function FieldConfigPage() {
  const { firebaseUser, activeUsers } = useAuth();
  const [fieldMap, setFieldMap] = useState<FieldMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<Record<string, EditableFieldMapEntry>>({});
  const [profileBlocks, setProfileBlocks] = useState<Record<string, ProfileBlockConfig>>({});
  const [sectionOrder, setSectionOrder] = useState<Record<string, number>>({});
  const [accessMatrix, setAccessMatrix] = useState<ProfileAccessMatrix>(DEFAULT_PROFILE_ACCESS_MATRIX);
  const [accessDialogOpen, setAccessDialogOpen] = useState(false);
  const [accessMatrixDraft, setAccessMatrixDraft] = useState<ProfileAccessMatrix>(DEFAULT_PROFILE_ACCESS_MATRIX);
  const [roleOptions, setRoleOptions] = useState<AccessOption[]>([]);
  const [functionOptions, setFunctionOptions] = useState<AccessOption[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<EditableFieldMapEntry | null>(null);
  const [structurePanel, setStructurePanel] = useState<StructurePanelState | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<NormalizedFieldVisibility | 'all'>('all');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const userOptions = useMemo(() => uniqueUserOptions(activeUsers), [activeUsers]);

  const dirty = useMemo(() => {
    if (!fieldMap) return false;
    return (
      JSON.stringify(fields) !== JSON.stringify(fieldMap.fields) ||
      JSON.stringify(sectionOrder) !== JSON.stringify(fieldMap.section_order ?? {}) ||
      JSON.stringify(profileBlocks) !== JSON.stringify(fieldMap.profile_blocks ?? {}) ||
      JSON.stringify(accessMatrix) !== JSON.stringify(normalizeProfileAccessMatrix(fieldMap.access_matrix))
    );
  }, [fieldMap, fields, sectionOrder, profileBlocks, accessMatrix]);

  function discard() {
    if (!fieldMap) return;
    setFields(fieldMap.fields);
    setSectionOrder(fieldMap.section_order ?? {});
    setProfileBlocks(fieldMap.profile_blocks ?? {});
    setAccessMatrix(normalizeProfileAccessMatrix(fieldMap.access_matrix));
    setMessage(null);
  }

  function openAccessDialog() {
    setAccessMatrixDraft(normalizeProfileAccessMatrix(accessMatrix));
    setAccessDialogOpen(true);
  }

  function closeAccessDialog() {
    setAccessDialogOpen(false);
    setAccessMatrixDraft(normalizeProfileAccessMatrix(accessMatrix));
  }

  function applyAccessDialog() {
    setAccessMatrix(normalizeProfileAccessMatrix(accessMatrixDraft));
    setAccessDialogOpen(false);
  }

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
        async function fetchAccessOptions(path: string, key: 'roles' | 'functions') {
          try {
            const response = await fetch(path, {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            });
            const payload = await response.json().catch(() => ({}));
            return response.ok ? readAccessOptions(payload, key) : [];
          } catch {
            return [];
          }
        }
        const response = await fetch('/api/rh/field-map', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const [payload, roles, functions] = await Promise.all([
          response.json().catch(() => ({})),
          fetchAccessOptions('/api/hr/roles', 'roles'),
          fetchAccessOptions('/api/hr/functions', 'functions'),
        ]);
        if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Falha ao carregar campos.');
        if (!cancelled) {
          const nextFieldMap = payload.fieldMap as FieldMap;
          setFieldMap(nextFieldMap);
          setFields(nextFieldMap.fields);
          setSectionOrder(nextFieldMap.section_order ?? {});
          setProfileBlocks(nextFieldMap.profile_blocks ?? {});
          setAccessMatrix(normalizeProfileAccessMatrix(nextFieldMap.access_matrix));
          setRoleOptions(roles);
          setFunctionOptions(functions);
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

  const fieldsRepresentedBySystemBlocks = useMemo(
    () => systemFieldsRepresentedByProfileBlocks(Object.keys(profileBlocks)),
    [profileBlocks],
  );

  const grouped = useMemo(() => {
    const groups = Object.entries(fields).reduce<Record<string, FieldTuple[]>>((acc, item) => {
      if (fieldsRepresentedBySystemBlocks.has(item[0])) return acc;
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
  }, [fields, fieldsRepresentedBySystemBlocks, sectionOrder]);

  const displayedGrouped = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const entries = Object.entries(grouped)
      .map(([section, items]) => {
        const nextItems = items.filter(([key, entry]) => {
          const matchesVisibility = visibilityFilter === 'all' || normalizeFieldVisibility(entry.visibility) === visibilityFilter;
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

  const editing = editingKey ? editingDraft : null;

  function toggleSection(section: string) {
    setCollapsedSections((current) => ({ ...current, [section]: current[section] === false }));
  }

  function updateField(key: string, patch: Partial<EditableFieldMapEntry>) {
    setFields((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  function updateSectionFieldsVisibility(section: string, visibility: FieldVisibility) {
    setFields((current) => Object.fromEntries(
      Object.entries(current).map(([key, entry]) => {
        if (entry.section !== section) return [key, entry];
        const nextLgpd = defaultLgpd(entry.section, visibility);
        return [
          key,
          {
            ...entry,
            visibility,
            lgpd: {
              ...nextLgpd,
              ...(entry.lgpd ?? {}),
              category: normalizeLgpdCategory(entry.lgpd?.category),
            },
          },
        ];
      })
    ) as Record<string, EditableFieldMapEntry>);
  }

  function addSection() {
    setStructurePanel({ kind: 'section', sectionName: '', fieldLabel: '' });
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
    const entry: EditableFieldMapEntry = {
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
    };
    setFields((current) => ({
      ...current,
      [key]: entry,
    }));
    setEditingKey(key);
    setEditingDraft(cloneFieldEntry(entry));
  }

  function addGroup(section: string) {
    setStructurePanel({ kind: 'group', section, groupLabel: '', fieldLabel: '' });
  }

  function addSubgroup(section: string, group: NonNullable<EditableFieldMapEntry['group']>) {
    setStructurePanel({ kind: 'subgroup', section, group, subgroupLabel: '', fieldLabel: '' });
  }

  function renameSection(oldName: string) {
    setStructurePanel({ kind: 'rename_section', section: oldName, nextName: oldName });
  }

  function applySectionRename(oldName: string, nextName: string) {
    if (!nextName.trim() || nextName.trim() === oldName) return;
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
    setStructurePanel({ kind: 'delete_field', key, label: fields[key]?.label ?? key });
  }

  function applyFieldDeletion(key: string) {
    setFields((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (editingKey === key) {
      setEditingKey(null);
      setEditingDraft(null);
    }
  }

  function openFieldEditor(key: string) {
    const entry = fields[key];
    if (!entry) return;
    setEditingKey(key);
    setEditingDraft(cloneFieldEntry(entry));
  }

  function closeFieldEditor() {
    setEditingKey(null);
    setEditingDraft(null);
  }

  function patchEditingDraft(patch: Partial<EditableFieldMapEntry>) {
    setEditingDraft((current) => current ? { ...current, ...patch } : current);
  }

  function updateEditingGroup(label: string) {
    setEditingDraft((current) => {
      if (!current) return current;
      const previousGroup = current.group;
      const trimmed = label.trim();
      const group = trimmed
        ? {
            id: previousGroup?.id ?? makeId(`${current.section}_${trimmed}`),
            label: trimmed,
            order: previousGroup?.order ?? current.order,
            ...(previousGroup?.conditionals?.length ? { conditionals: previousGroup.conditionals } : {}),
            ...(previousGroup?.repeatable ? { repeatable: previousGroup.repeatable } : {}),
          }
        : undefined;
      return { ...current, group, subgroup: group ? current.subgroup : undefined };
    });
  }

  function updateEditingSubgroup(label: string) {
    setEditingDraft((current) => {
      if (!current?.group) return current;
      const previousSubgroup = current.subgroup;
      const trimmed = label.trim();
      const subgroup = trimmed
        ? {
            id: previousSubgroup?.id ?? makeId(`${current.section}_${current.group.id}_${trimmed}`),
            label: trimmed,
            group_id: current.group.id,
            order: previousSubgroup?.order ?? current.order,
            ...(previousSubgroup?.conditionals?.length ? { conditionals: previousSubgroup.conditionals } : {}),
          }
        : undefined;
      return { ...current, subgroup };
    });
  }

  function updateEditingGroupRepeatable(enabled: boolean) {
    setEditingDraft((current) => {
      if (!current?.group) return current;
      return {
        ...current,
        group: {
          ...current.group,
          repeatable: enabled
            ? {
                enabled: true,
                add_label: current.group.repeatable?.add_label ?? `Adicionar ${current.group.label.toLowerCase()}`,
                item_label: current.group.repeatable?.item_label ?? current.group.label,
                ...(current.group.repeatable?.max_items ? { max_items: current.group.repeatable.max_items } : {}),
              }
            : undefined,
        },
      };
    });
  }

  function updateEditingShowIf(controllerKey: string, rawValue: string) {
    if (!controllerKey) {
      patchEditingDraft({ conditionals: undefined });
      return;
    }
    const controller = fields[controllerKey];
    const value = controller?.type === 'boolean'
      ? rawValue === 'false' ? false : true
      : rawValue;
    patchEditingDraft({
      conditionals: [{
        kind: 'show_if',
        field: controllerKey,
        operator: controller?.type === 'boolean' || rawValue ? 'eq' : 'truthy',
        ...(controller?.type === 'boolean' || rawValue ? { value } : {}),
      }],
    });
  }

  function applyFieldEditor() {
    if (!editingKey || !editingDraft) return;
    const draft = {
      ...editingDraft,
      label: editingDraft.label.trim(),
      section: editingDraft.section.trim(),
    };
    if (!draft.label || !draft.section) return;
    setFields((current) => {
      const previous = current[editingKey];
      if (!previous) return current;
      const next = { ...current };
      Object.entries(current).forEach(([key, entry]) => {
        let updated = entry;
        if (previous.group?.id && entry.group?.id === previous.group.id) {
          updated = {
            ...updated,
            group: draft.group,
            subgroup: draft.group ? updated.subgroup : undefined,
          };
        }
        if (previous.subgroup?.id && entry.subgroup?.id === previous.subgroup.id) {
          updated = { ...updated, subgroup: draft.subgroup };
        }
        next[key] = updated;
      });
      next[editingKey] = cloneFieldEntry(draft);
      return next;
    });
    closeFieldEditor();
  }

  function submitStructurePanel() {
    if (!structurePanel) return;
    if (structurePanel.kind === 'section') {
      const section = structurePanel.sectionName.trim();
      if (!section) return;
      addField(section, structurePanel.fieldLabel.trim() || 'Novo campo');
      setSectionOrder((current) => current[section] == null ? { ...current, [section]: Object.keys(current).length * 10 + 10 } : current);
    } else if (structurePanel.kind === 'group') {
      const groupLabel = structurePanel.groupLabel.trim();
      if (!groupLabel) return;
      const groupCount = new Set((grouped[structurePanel.section] ?? []).map(([, entry]) => entry.group?.id).filter(Boolean)).size;
      addField(structurePanel.section, structurePanel.fieldLabel.trim() || 'Novo campo', {
        group: {
          id: makeId(`${structurePanel.section}_${groupLabel}`),
          label: groupLabel,
          order: (groupCount + 1) * 10,
        },
      });
    } else if (structurePanel.kind === 'subgroup') {
      const subgroupLabel = structurePanel.subgroupLabel.trim();
      if (!subgroupLabel) return;
      const subgroupCount = new Set(
        (grouped[structurePanel.section] ?? [])
          .filter(([, entry]) => entry.group?.id === structurePanel.group.id)
          .map(([, entry]) => entry.subgroup?.id)
          .filter(Boolean)
      ).size;
      addField(structurePanel.section, structurePanel.fieldLabel.trim() || 'Novo campo', {
        group: structurePanel.group,
        subgroup: {
          id: makeId(`${structurePanel.section}_${structurePanel.group.id}_${subgroupLabel}`),
          label: subgroupLabel,
          group_id: structurePanel.group.id,
          order: (subgroupCount + 1) * 10,
        },
      });
    } else if (structurePanel.kind === 'rename_section') {
      applySectionRename(structurePanel.section, structurePanel.nextName);
    } else {
      applyFieldDeletion(structurePanel.key);
    }
    setStructurePanel(null);
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
        body: JSON.stringify({ version: fieldMap?.version ?? 'coala-rh-v1.3', fields, section_order: sectionOrder, profile_blocks: profileBlocks, access_matrix: accessMatrix }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Falha ao salvar campos.');
      setFieldMap((current) => ({
        version: current?.version ?? 'coala-rh-v1.3',
        fields,
        section_order: sectionOrder,
        profile_blocks: profileBlocks,
        access_matrix: accessMatrix,
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

  const visibilityTabs: Array<{ value: NormalizedFieldVisibility | 'all'; label: string; count: number }> = [
    { value: 'all', label: 'Todos', count: Object.keys(fields).length },
    ...VISIBILITIES.map((visibility) => ({
      value: visibility,
      label: VISIBILITY_LABELS[visibility],
      count: Object.values(fields).filter((entry) => normalizeFieldVisibility(entry.visibility) === visibility).length,
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
    <div className="personal-field-config-density space-y-3 bg-(--bg) px-3 py-3 text-[#1d1d26] md:px-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-[-.02em] text-[#181820]">Campos do Perfil</h1>
          <p className="mt-1 max-w-[560px] text-xs font-medium leading-5 text-[#6f6f7c]">
            Crie, nomeie e organize as seções e campos exibidos no perfil dos colaboradores.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Dialog open={accessDialogOpen} onOpenChange={(open) => open ? openAccessDialog() : closeAccessDialog()}>
            <DialogTrigger asChild>
              <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#e2e0da] bg-white px-3 text-xs font-black text-[#494952] hover:bg-[#faf9f6]">
                <ShieldCheck className="h-4 w-4 text-[#df2f78]" />
                Regras de acesso
              </button>
            </DialogTrigger>
            <DialogContent flush className="max-h-[92vh] overflow-hidden border-ds-border bg-ds-surface p-0 sm:max-w-[min(1120px,calc(100vw-2rem))]" overlayClassName="bg-black/55 backdrop-blur-[2px]">
              <div className="flex max-h-[92vh] min-h-0 flex-col">
              <DialogHeader className="shrink-0 space-y-0 border-b border-ds-divider bg-ds-surface px-5 pb-4 pt-5 pr-14 text-left sm:px-6 sm:pb-5 sm:pt-6">
                <p className="text-[10.5px] font-black uppercase tracking-[.12em] text-ds-accent-kicker">Regras gerais de acesso</p>
                <DialogTitle className="mt-1.5 text-xl font-black leading-tight tracking-[-.02em] text-ds-ink">
                  Permissão padrão por visibilidade
                </DialogTitle>
                <DialogDescription className="mt-1.5 max-w-[760px] text-xs font-medium leading-5 text-ds-ink-muted">
                  Esta matriz define a base para cada visibilidade. Edição direta ou sujeita à aprovação pelo titular é configurada em cada campo.
                </DialogDescription>
                <div className="mt-3.5! inline-flex w-fit items-center gap-[7px] rounded-full border border-ds-accent bg-ds-accent-soft py-1.5 pl-2.5 pr-3 text-[12.5px] font-bold text-ds-accent-ink">
                  <span className="h-[7px] w-[7px] rounded-full bg-ds-accent" />
                  Base do perfil
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-auto bg-ds-page p-4 sm:p-5">
                <AccessMatrixPanel
                  matrix={accessMatrixDraft}
                  onChange={setAccessMatrixDraft}
                  roleOptions={roleOptions}
                  functionOptions={functionOptions}
                  userOptions={userOptions}
                  showHeader={false}
                />
              </div>

              <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-between gap-3 border-t border-ds-divider bg-ds-surface px-5 py-4 sm:justify-between sm:space-x-0 sm:px-6">
                <PermissionLegend />
                <div className="ml-auto flex items-center gap-2.5">
                  <button type="button" onClick={closeAccessDialog} className="h-10 rounded-ds-md border border-ds-border bg-ds-input px-5 text-sm font-bold text-ds-ink-2 transition hover:bg-ds-muted">Cancelar</button>
                  <button
                    type="button"
                    onClick={applyAccessDialog}
                    className="h-10 rounded-ds-md bg-ds-modal px-5 text-sm font-black text-white shadow-sm transition hover:brightness-95"
                  >
                    Aplicar regras
                  </button>
                </div>
              </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
          <button type="button" onClick={addSection} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#e2e0da] bg-white px-3 text-xs font-black text-[#494952] hover:bg-[#faf9f6]">
            <Plus className="h-4 w-4" />
            Nova seção
          </button>
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#df2f78] px-3 text-xs font-black text-white shadow-[0_8px_18px_-8px_#df2f78] hover:bg-[#cc2069] disabled:opacity-60">
            {saving ? <Save className="h-4 w-4 animate-pulse" /> : <Check className="h-4 w-4" />}
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </div>

      <div className="rounded-[18px] border border-[#e6e4de] bg-white p-3 shadow-[0_2px_10px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-center gap-3.5">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-[#9d9da9]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-11 w-full rounded-xl border-0 bg-[#f6f5f2] pl-10 pr-4 text-sm font-medium text-[#4f4f5b] outline-hidden placeholder:text-[#9d9da9]"
              placeholder="Buscar campo por nome ou chave..."
            />
          </div>
          <div className="flex max-w-full flex-wrap gap-1.5">
            {visibilityTabs.map((tab) => {
              const active = visibilityFilter === tab.value;
              const tone = tab.value === 'all' ? null : VISIBILITY_TONES[tab.value];
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setVisibilityFilter(tab.value)}
                  style={
                    active && tone
                      ? { background: tone.bg, color: tone.fg, borderColor: `${tone.fg}33` }
                      : undefined
                  }
                  className={`inline-flex h-10 min-w-max items-center gap-2 rounded-xl border border-transparent px-3.5 text-[13px] font-black transition ${
                    active && !tone
                      ? 'bg-[#181820] text-white'
                      : active
                        ? ''
                        : 'text-[#6f6f7c] hover:bg-[#f7f7f9]'
                  }`}
                >
                  {tone ? (
                    <span className="h-2 w-2 rounded-full" style={{ background: tone.dot }} />
                  ) : null}
                  {tab.label}
                  <span
                    style={active && tone ? { background: '#ffffffaa', color: tone.fg } : undefined}
                    className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-black ${
                      active && !tone
                        ? 'bg-white/18 text-white'
                        : active
                          ? ''
                          : 'bg-[#eceae4] text-[#8a8a94]'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {message ? <p className="rounded-2xl bg-white px-5 py-4 text-sm font-black text-[#6f6f7c] shadow-xs ring-1 ring-[#dedfe4]">{message}</p> : null}

      {visibleSectionContainers.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-[#cfd0d8] bg-white px-5 py-10 text-center text-sm font-black text-[#777784]">
          Nenhum campo encontrado.
        </div>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
        <SortableContext items={visibleSectionContainers.map((section) => `section:${section}`)} strategy={verticalListSortingStrategy}>
          {visibleSectionContainers.map((section, containerIndex) => {
            if (section === SYSTEM_BLOCKS_SECTION) {
              return (
                <SortableSectionOrderFrame
                  key={section}
                  id={`section:${section}`}
                  section="Blocos do sistema"
                  position={containerIndex + 1}
                  count={displayedProfileBlocks.length}
                  countLabel={displayedProfileBlocks.length === 1 ? 'bloco' : 'blocos'}
                  tag="Sistema"
                  collapsed={collapsedSections[SYSTEM_BLOCKS_SECTION] !== false}
                  onToggle={() => toggleSection(SYSTEM_BLOCKS_SECTION)}
                >
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleProfileBlockDragEnd}>
                    <SortableContext items={displayedProfileBlocks.map(([key]) => key)} strategy={verticalListSortingStrategy}>
                      <div className="overflow-x-auto border-t border-[#ececf0]">
                        <div className="grid min-w-[760px] gap-3 bg-[#fbfbfc] px-5 py-3 text-[10.5px] font-extrabold uppercase tracking-[.07em] text-[#9d9da9]" style={{ gridTemplateColumns: ORDER_GRID_TEMPLATE }}>
                          <span />
                          <span>Ordem</span>
                          <span>Bloco</span>
                          <span>Tipo</span>
                          <span>Gestão do colaborador</span>
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
            const sectionVisibility = getSectionVisibilitySummary(grouped[section] ?? items);
            return (
              <SortableSectionOrderFrame
                key={section}
                id={`section:${section}`}
                section={section}
                position={containerIndex + 1}
                count={items.length}
                tag="Seção"
                actions={(
                  <>
                    <SectionVisibilitySelect
                      visibility={sectionVisibility.visibility}
                      mixed={sectionVisibility.mixed}
                      onChange={(visibility) => updateSectionFieldsVisibility(section, visibility)}
                    />
                    <button type="button" onClick={() => addGroup(section)} className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-white px-2.5 text-[12.5px] font-extrabold text-[#6f6f7c] hover:bg-[#f7f7f9]">
                      <Plus className="h-[15px] w-[15px]" />
                      Grupo
                    </button>
                    <button type="button" onClick={() => renameSection(section)} className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-white px-2.5 text-[12.5px] font-extrabold text-[#6f6f7c] hover:bg-[#f7f7f9]">
                      <Pencil className="h-[15px] w-[15px]" />
                      Renomear
                    </button>
                    <button type="button" onClick={() => addField(section)} className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] bg-[#fff0f6] px-3.5 text-[12.5px] font-extrabold text-[#df2f78] hover:bg-[#fde5f0]">
                      <Plus className="h-[15px] w-[15px]" />
                      Adicionar campo
                    </button>
                  </>
                )}
                collapsed={collapsedSections[section] !== false}
                onToggle={() => toggleSection(section)}
              >
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => handleDragEnd(section, event)}>
                  <SortableContext items={items.map(([key]) => key)} strategy={verticalListSortingStrategy}>
                    <div className="overflow-x-auto border-t border-[#ececf0]">
                      <div className="grid min-w-[1080px] gap-4 bg-[#fbfbfc] px-5 py-3 text-[10.5px] font-extrabold uppercase tracking-[.07em] text-[#9d9da9]" style={{ gridTemplateColumns: FIELD_GRID_TEMPLATE }}>
                        <span />
                        <span>Ordem</span>
                        <span>Campo</span>
                        <span>Tipo</span>
                        <span>Visibilidade</span>
                        <span className="text-right">Ações</span>
                      </div>
                      {(() => {
                        let previousGroup = '';
                        let previousSubgroup = '';
                        return items.map(([key, entry], index) => {
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
                                <div className="min-w-[1080px] border-b border-[#f2d7e4] bg-[#fff8fc] px-5 py-3">
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
                                <div className="min-w-[1080px] border-b border-[#f0e8ef] bg-[#fffbfd] px-5 py-3">
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
                              <SortableFieldRow id={key} entry={entry} position={index + 1} onEdit={() => openFieldEditor(key)} onDelete={() => deleteField(key)} />
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

      {dirty ? (
        <>
        <div aria-hidden className="h-20" />
        <div className="pointer-events-none fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 flex justify-center sm:inset-x-6 sm:bottom-[calc(20px+env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-3 rounded-2xl bg-[#181820] py-[11px] pl-5 pr-3 text-white shadow-[0_18px_40px_-12px_rgba(20,22,28,.55)] sm:gap-4">
            <span className="inline-flex items-center gap-2.5 text-[13.5px] font-bold">
              <span className="h-2 w-2 rounded-full bg-[#f7b500] shadow-[0_0_0_4px_rgba(247,181,0,.2)]" />
              Você tem alterações não salvas
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={discard}
                disabled={saving}
                className="h-[38px] rounded-xl bg-white/12 px-[15px] text-[13px] font-bold text-[#e7e7ea] transition hover:bg-white/20 disabled:opacity-60"
              >
                Descartar
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex h-[38px] items-center gap-[7px] rounded-xl bg-[#df2f78] px-[18px] text-[13px] font-black text-white transition hover:bg-[#ea3d85] disabled:opacity-60"
              >
                {saving ? <Save className="h-[15px] w-[15px] animate-pulse" /> : <Check className="h-[15px] w-[15px]" />}
                {saving ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>
          </div>
        </div>
        </>
      ) : null}

      <Dialog open={structurePanel !== null} onOpenChange={(open) => { if (!open) setStructurePanel(null); }}>
        <DialogContent flush className="overflow-hidden border-ds-border bg-ds-surface p-0 sm:max-w-[560px]" overlayClassName="bg-black/55 backdrop-blur-[2px]">
          {structurePanel ? (
            <form onSubmit={(event) => { event.preventDefault(); submitStructurePanel(); }}>
              <DialogHeader className="border-b border-ds-divider bg-ds-surface px-5 py-5 pr-14 text-left sm:px-6">
                <p className="text-[10.5px] font-black uppercase tracking-[.12em] text-ds-accent-kicker">Estrutura do perfil</p>
                <DialogTitle className="mt-1.5 text-xl font-black tracking-[-.02em] text-ds-ink">
                  {structurePanel.kind === 'section' ? 'Nova seção' : structurePanel.kind === 'group' ? 'Novo grupo' : structurePanel.kind === 'subgroup' ? 'Novo subgrupo' : structurePanel.kind === 'rename_section' ? 'Renomear seção' : 'Remover campo'}
                </DialogTitle>
                <DialogDescription className="mt-1.5 text-xs font-medium leading-5 text-ds-ink-muted">
                  {structurePanel.kind === 'delete_field'
                    ? 'O campo sai do perfil quando as alterações forem salvas.'
                    : structurePanel.kind === 'section'
                      ? 'A seção organiza um conjunto de campos relacionados no perfil.'
                      : structurePanel.kind === 'group'
                        ? 'O grupo organiza campos relacionados dentro da seção selecionada.'
                        : structurePanel.kind === 'subgroup'
                          ? 'O subgrupo cria uma divisão adicional dentro do grupo selecionado.'
                          : 'O novo nome será aplicado a todos os campos desta seção.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 bg-ds-page px-5 py-5 sm:px-6">
                {structurePanel.kind === 'section' ? (
                  <>
                    <Field label="Nome da seção" htmlFor="profile-structure-section-name">
                      <input id="profile-structure-section-name" autoFocus required value={structurePanel.sectionName} onChange={(event) => setStructurePanel((current) => current?.kind === 'section' ? { ...current, sectionName: event.target.value } : current)} className={fieldInputClass} placeholder="Ex.: Dados contratuais" />
                    </Field>
                    <Field label="Primeiro campo" requirement="opcional" htmlFor="profile-structure-section-field" hint="Se ficar vazio, o sistema cria um campo provisório para a seção.">
                      <input id="profile-structure-section-field" value={structurePanel.fieldLabel} onChange={(event) => setStructurePanel((current) => current?.kind === 'section' ? { ...current, fieldLabel: event.target.value } : current)} className={fieldInputClass} placeholder="Novo campo" />
                    </Field>
                  </>
                ) : structurePanel.kind === 'group' ? (
                  <>
                    <p className="rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2 text-xs font-bold text-ds-ink-muted">Seção: <span className="text-ds-ink">{structurePanel.section}</span></p>
                    <Field label="Nome do grupo" htmlFor="profile-structure-group-name">
                      <input id="profile-structure-group-name" autoFocus required value={structurePanel.groupLabel} onChange={(event) => setStructurePanel((current) => current?.kind === 'group' ? { ...current, groupLabel: event.target.value } : current)} className={fieldInputClass} placeholder="Ex.: Documentos" />
                    </Field>
                    <Field label="Primeiro campo" requirement="opcional" htmlFor="profile-structure-group-field">
                      <input id="profile-structure-group-field" value={structurePanel.fieldLabel} onChange={(event) => setStructurePanel((current) => current?.kind === 'group' ? { ...current, fieldLabel: event.target.value } : current)} className={fieldInputClass} placeholder="Novo campo" />
                    </Field>
                  </>
                ) : structurePanel.kind === 'subgroup' ? (
                  <>
                    <p className="rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2 text-xs font-bold text-ds-ink-muted">{structurePanel.section} <span className="px-1 text-ds-ink-faint">/</span> <span className="text-ds-ink">{structurePanel.group.label}</span></p>
                    <Field label="Nome do subgrupo" htmlFor="profile-structure-subgroup-name">
                      <input id="profile-structure-subgroup-name" autoFocus required value={structurePanel.subgroupLabel} onChange={(event) => setStructurePanel((current) => current?.kind === 'subgroup' ? { ...current, subgroupLabel: event.target.value } : current)} className={fieldInputClass} placeholder="Ex.: Validade" />
                    </Field>
                    <Field label="Primeiro campo" requirement="opcional" htmlFor="profile-structure-subgroup-field">
                      <input id="profile-structure-subgroup-field" value={structurePanel.fieldLabel} onChange={(event) => setStructurePanel((current) => current?.kind === 'subgroup' ? { ...current, fieldLabel: event.target.value } : current)} className={fieldInputClass} placeholder="Novo campo" />
                    </Field>
                  </>
                ) : structurePanel.kind === 'rename_section' ? (
                  <Field label="Nome da seção" htmlFor="profile-structure-rename">
                    <input id="profile-structure-rename" autoFocus required value={structurePanel.nextName} onChange={(event) => setStructurePanel((current) => current?.kind === 'rename_section' ? { ...current, nextName: event.target.value } : current)} className={fieldInputClass} />
                  </Field>
                ) : (
                  <div className="rounded-ds-btn-lg border border-ds-danger bg-ds-danger-bg px-4 py-3.5">
                    <p className="text-sm font-black text-ds-danger">{structurePanel.label}</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-ds-danger">Valores já existentes não serão apagados automaticamente, mas o campo deixará de aparecer no perfil.</p>
                  </div>
                )}
              </div>
              <DialogFooter className="flex-row justify-end gap-2 border-t border-ds-divider bg-ds-surface px-5 py-4 sm:space-x-0 sm:px-6">
                <button type="button" onClick={() => setStructurePanel(null)} className="h-10 rounded-ds-md border border-ds-border bg-ds-input px-4 text-sm font-bold text-ds-ink-2 transition hover:bg-ds-muted">Cancelar</button>
                <button type="submit" className={`h-10 rounded-ds-md px-5 text-sm font-black text-white transition ${structurePanel.kind === 'delete_field' ? 'bg-ds-danger hover:brightness-95' : 'bg-ds-modal hover:brightness-95'}`}>
                  {structurePanel.kind === 'delete_field' ? 'Remover campo' : structurePanel.kind === 'rename_section' ? 'Salvar nome' : 'Criar'}
                </button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing && editingKey)} onOpenChange={(open) => { if (!open) closeFieldEditor(); }}>
        {editing && editingKey ? (
          <DialogContent
            flush
            hideClose
            overlayClassName="bg-black/55 backdrop-blur-[2px]"
            className="max-h-[92vh] overflow-hidden border-ds-border bg-ds-surface p-0 shadow-2xl sm:max-w-[900px]"
          >
            <form onSubmit={(event) => { event.preventDefault(); applyFieldEditor(); }} className="flex max-h-[92vh] min-h-0 flex-col">
              <DialogHeader className="shrink-0 border-b border-ds-divider bg-ds-surface px-5 py-4 pr-5 sm:px-6 sm:py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[10.5px] font-black uppercase tracking-[.12em] text-ds-accent-kicker">Configuração do perfil</p>
                    <DialogTitle className="mt-1.5 text-xl font-black tracking-[-.02em] text-ds-ink">Editar campo</DialogTitle>
                    <DialogDescription className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ds-ink-muted">
                      <span>Defina como o campo aparece, quem pode acessá-lo e como ele é tratado.</span>
                      <span className="rounded-md bg-ds-muted px-2 py-1 font-mono text-[11px] font-bold text-ds-ink-2">{editingKey}</span>
                    </DialogDescription>
                  </div>
                  <button type="button" onClick={closeFieldEditor} className="h-9 shrink-0 rounded-ds-md border border-ds-border bg-ds-input px-3 text-xs font-black text-ds-ink-muted transition hover:bg-ds-muted hover:text-ds-ink">
                    Fechar
                  </button>
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-ds-page p-4 sm:p-5">
                <FieldEditorSection title="Identificação e organização" description="Nome e posição do campo dentro da estrutura do perfil.">
                  <Field label="Nome do campo" htmlFor="profile-field-name" error={!editing.label.trim() ? 'Informe o nome do campo.' : null}>
                    <input id="profile-field-name" autoFocus value={editing.label} onChange={(event) => patchEditingDraft({ label: event.target.value })} className={fieldInputClass} />
                  </Field>
                  <Field label="Seção" htmlFor="profile-field-section" error={!editing.section.trim() ? 'Informe a seção.' : null}>
                    <input id="profile-field-section" value={editing.section} onChange={(event) => patchEditingDraft({ section: event.target.value })} className={fieldInputClass} />
                  </Field>
                  <Field label="Grupo" requirement="opcional" htmlFor="profile-field-group" hint="Agrupa campos relacionados dentro da seção.">
                    <input id="profile-field-group" value={editing.group?.label ?? ''} onChange={(event) => updateEditingGroup(event.target.value)} placeholder="Ex.: CNH ou Dependentes" className={fieldInputClass} />
                  </Field>
                  <Field label="Subgrupo" requirement="opcional" htmlFor="profile-field-subgroup" hint={editing.group ? 'Use quando o grupo precisar de uma divisão adicional.' : 'Defina um grupo antes de criar o subgrupo.'}>
                    <input id="profile-field-subgroup" value={editing.subgroup?.label ?? ''} onChange={(event) => updateEditingSubgroup(event.target.value)} disabled={!editing.group} placeholder="Ex.: Validade da CNH" className={`${fieldInputClass} disabled:cursor-not-allowed disabled:bg-ds-muted disabled:text-ds-ink-faint`} />
                  </Field>
                </FieldEditorSection>

                <FieldEditorSection title="Formato e preenchimento" description="Tipo de resposta, obrigatoriedade e comportamento de grupos repetíveis.">
                  <Field label="Tipo de campo" htmlFor="profile-field-type">
                    <StyledSelect
                      id="profile-field-type"
                      value={editing.type}
                      onChange={(event) => {
                        const type = event.target.value as FieldType;
                        patchEditingDraft({
                          type,
                          ...(!['single_select', 'multi_select'].includes(type) ? { options: undefined } : {}),
                        });
                      }}
                    >
                      {editing.type === 'autonumber' ? <option value="autonumber">{TYPE_LABELS.autonumber}</option> : null}
                      {FIELD_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
                    </StyledSelect>
                  </Field>
                  {['single_select', 'multi_select'].includes(editing.type) ? (
                    <Field label="Opções de resposta" htmlFor="profile-field-options" hint="Separe cada opção por vírgula.">
                      <input id="profile-field-options" value={editing.options?.join(', ') ?? ''} onChange={(event) => patchEditingDraft({ options: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} placeholder="Ex.: Sim, Não, Não se aplica" className={fieldInputClass} />
                    </Field>
                  ) : <div className="hidden md:block" />}
                  <FieldEditorToggle
                    checked={editing.required === true}
                    label="Campo obrigatório"
                    description="O perfil só será considerado completo quando este campo estiver preenchido."
                    onChange={(required) => patchEditingDraft({ required })}
                  />
                  <FieldEditorToggle
                    checked={editing.group?.repeatable?.enabled === true}
                    disabled={!editing.group}
                    label="Grupo com várias respostas"
                    description={editing.group ? 'Permite cadastrar vários itens, como dependentes ou documentos.' : 'Disponível quando o campo pertence a um grupo.'}
                    onChange={updateEditingGroupRepeatable}
                  />
                </FieldEditorSection>

                <FieldEditorSection title="Acesso e alteração" description="Controle quem pode ver o campo e como o titular propõe mudanças.">
                  <Field label="Visibilidade" htmlFor="profile-field-visibility" hint="As permissões efetivas seguem as Regras gerais de acesso.">
                    <StyledSelect
                      id="profile-field-visibility"
                      value={normalizeFieldVisibility(editing.visibility)}
                      onChange={(event) => {
                        const visibility = event.target.value as NormalizedFieldVisibility;
                        patchEditingDraft({
                          visibility,
                          lgpd: {
                            ...defaultLgpd(editing.section, visibility),
                            ...editing.lgpd,
                            category: normalizeLgpdCategory(editing.lgpd?.category),
                          },
                        });
                      }}
                    >
                      {VISIBILITIES.map((visibility) => <option key={visibility} value={visibility}>{VISIBILITY_LABELS[visibility]}</option>)}
                    </StyledSelect>
                  </Field>
                  <Field
                    label="Alteração pelo titular"
                    htmlFor="profile-field-self-service"
                    hint={SELF_SERVICE_POLICIES.find((policy) => policy.value === (editing.self_service_policy ?? 'inherit'))?.helper}
                  >
                    <StyledSelect id="profile-field-self-service" value={editing.self_service_policy ?? 'inherit'} onChange={(event) => patchEditingDraft({ self_service_policy: event.target.value as ProfileSelfServicePolicy })}>
                      {SELF_SERVICE_POLICIES.map((policy) => <option key={policy.value} value={policy.value}>{policy.label}</option>)}
                    </StyledSelect>
                  </Field>
                </FieldEditorSection>

                <FieldEditorSection title="Privacidade e retenção" description="Classificação do dado e regras de tratamento. Isso não substitui a visibilidade.">
                  <Field
                    label="Natureza do dado"
                    htmlFor="profile-field-lgpd-category"
                    hint={(
                      <span className="inline-flex items-center gap-1.5">
                        A natureza jurídica é independente de quem pode visualizar o campo.
                        <InfoTooltip title="Natureza do dado pela LGPD">
                          <p>Dado pessoal identifica ou pode identificar uma pessoa. Dado pessoal sensível inclui informações como saúde, biometria, origem racial ou étnica, religião, filiação sindical, vida sexual e dados genéticos.</p>
                        </InfoTooltip>
                      </span>
                    )}
                  >
                    <StyledSelect id="profile-field-lgpd-category" value={normalizeLgpdCategory(editing.lgpd?.category)} onChange={(event) => patchEditingDraft({ lgpd: { ...defaultLgpd(editing.section, editing.visibility), ...editing.lgpd, category: event.target.value as LgpdCategory } })}>
                      {Object.entries(LGPD_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </StyledSelect>
                  </Field>
                  <Field label="Base legal" htmlFor="profile-field-legal-basis" hint="Fundamento usado para tratar este dado.">
                    <StyledSelect id="profile-field-legal-basis" value={editing.lgpd?.legal_basis ?? 'legal_obligation'} onChange={(event) => patchEditingDraft({ lgpd: { ...defaultLgpd(editing.section, editing.visibility), ...editing.lgpd, legal_basis: event.target.value as NonNullable<FieldMapEntry['lgpd']>['legal_basis'] } })}>
                      {Object.entries(LEGAL_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </StyledSelect>
                  </Field>
                  <Field label="Retenção" htmlFor="profile-field-retention" hint="Prazo padrão antes da revisão ou eliminação do dado.">
                    <StyledSelect id="profile-field-retention" value={editing.lgpd?.retention ?? 'employment_plus_5y'} onChange={(event) => patchEditingDraft({ lgpd: { ...defaultLgpd(editing.section, editing.visibility), ...editing.lgpd, retention: event.target.value as NonNullable<FieldMapEntry['lgpd']>['retention'] } })}>
                      {Object.entries(RETENTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </StyledSelect>
                  </Field>
                  <FieldEditorToggle
                    checked={editing.lgpd?.requires_consent === true}
                    label="Exige registro de consentimento"
                    description="Use somente quando o consentimento for a base aplicável; obrigação legal e contrato normalmente não dependem dele."
                    onChange={(requiresConsent) => patchEditingDraft({ lgpd: { ...defaultLgpd(editing.section, editing.visibility), ...editing.lgpd, requires_consent: requiresConsent } })}
                  />
                </FieldEditorSection>

                <FieldEditorSection title="Exibição condicional" description="Mostre este campo apenas quando outro campo atender à condição configurada.">
                  <Field label="Aparece quando" htmlFor="profile-field-condition-controller" hint="Escolha “Sempre aparece” para remover a condição.">
                    <StyledSelect id="profile-field-condition-controller" value={showIfRule?.field ?? ''} onChange={(event) => updateEditingShowIf(event.target.value, 'true')}>
                      <option value="">Sempre aparece</option>
                      {controllerOptions.map(([key, entry]) => <option key={key} value={key}>{entry.label}</option>)}
                    </StyledSelect>
                  </Field>
                  <Field label="Valor da condição" htmlFor="profile-field-condition-value" hint={!showIfRule ? 'Selecione primeiro o campo que controla a exibição.' : undefined}>
                    {fields[showIfRule?.field ?? '']?.type === 'boolean' ? (
                      <StyledSelect id="profile-field-condition-value" value={showIfValue || 'true'} disabled={!showIfRule} onChange={(event) => updateEditingShowIf(showIfRule?.field ?? '', event.target.value)} className="disabled:cursor-not-allowed disabled:bg-ds-muted disabled:text-ds-ink-faint">
                        <option value="true">Sim</option>
                        <option value="false">Não</option>
                      </StyledSelect>
                    ) : (
                      <input id="profile-field-condition-value" value={showIfValue} disabled={!showIfRule} onChange={(event) => updateEditingShowIf(showIfRule?.field ?? '', event.target.value)} placeholder="Vazio significa: quando estiver preenchido" className={`${fieldInputClass} disabled:cursor-not-allowed disabled:bg-ds-muted disabled:text-ds-ink-faint`} />
                    )}
                  </Field>
                </FieldEditorSection>
              </div>

              <DialogFooter className="shrink-0 flex-row items-center justify-between gap-3 border-t border-ds-divider bg-ds-surface px-5 py-4 sm:justify-between sm:space-x-0 sm:px-6">
                <p className="hidden text-xs font-medium text-ds-ink-muted sm:block">A alteração será adicionada ao rascunho da página.</p>
                <div className="ml-auto flex items-center gap-2">
                  <button type="button" onClick={closeFieldEditor} className="h-10 rounded-ds-md border border-ds-border bg-ds-input px-4 text-sm font-bold text-ds-ink-2 transition hover:bg-ds-muted">Cancelar</button>
                  <button type="submit" disabled={!editing.label.trim() || !editing.section.trim()} className="h-10 rounded-ds-md bg-ds-modal px-5 text-sm font-black text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50">Aplicar ao campo</button>
                </div>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
