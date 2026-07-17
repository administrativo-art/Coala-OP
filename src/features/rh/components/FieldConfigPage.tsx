'use client';

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, ChevronDown, Eye, EyeOff, Globe2, GripVertical, Link2, Lock, MoreHorizontal, Pencil, Plus, Save, Search, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FieldMap, FieldMapEntry, FieldType, FieldVisibility, NormalizedFieldVisibility, ProfileAccessActor, ProfileAccessMatrix, ProfileAccessPermission, ProfileBlockConfig } from '@/types/rh';
import { DEFAULT_PROFILE_ACCESS_MATRIX, normalizeFieldVisibility, normalizeProfileAccessMatrix } from '@/types/rh';

type EditableFieldMapEntry = FieldMapEntry;
type FieldTuple = [string, EditableFieldMapEntry];
type AccessOption = { id: string; label: string; description?: string };

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
  personal: 'Pessoal',
  sensitive: 'Sensível',
  confidential: 'Confidencial',
} as const;

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

const FIELD_GRID_TEMPLATE = '48px 44px minmax(280px, 1.6fr) 150px 170px 150px 190px';
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
  const normalizedVisibility = normalizeFieldVisibility(visibility);
  const consent = lower.includes('diversidade');
  return {
    category: consent || normalizedVisibility === 'confidential'
      ? 'sensitive'
      : normalizedVisibility === 'restricted_total' || normalizedVisibility === 'restricted_partial'
        ? 'confidential'
        : 'personal',
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
  return (
    <label className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-white px-2.5 text-[11.5px] font-extrabold text-[#6f6f7c] ring-1 ring-[#ececf0]">
      Visibilidade
      <select
        value={visibility}
        onChange={(event) => onChange(event.target.value as FieldVisibility)}
        className="h-7 rounded-lg border border-[#dedfe4] bg-white px-1.5 text-[11.5px] font-extrabold text-[#1d1d26] outline-none"
        title="Altera a visibilidade de todos os campos deste card"
      >
        {mixed ? <option value={visibility}>Visibilidade mista</option> : null}
        {VISIBILITIES.map((option) => (
          <option key={option} value={option}>
            {VISIBILITY_LABELS[option]}
          </option>
        ))}
      </select>
    </label>
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
            <p className="text-xs font-black uppercase tracking-wide text-[#df2f78]">Matriz de acesso</p>
            <h2 className="mt-1 text-xl font-black text-[#181820]">Regra padrão por visibilidade</h2>
            <p className="mt-1 max-w-4xl text-sm font-semibold leading-relaxed text-[#6f6f7c]">
              O que cada perfil pode fazer em campos e cards. Vínculos de cargo, função e pessoa ficam na coluna Exceção.
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
        <p className="truncate text-[15px] font-extrabold text-[#1d1d26]">{entry.label}</p>
        <p className="mt-0.5 truncate font-mono text-xs font-medium text-[#a6a6b0]">{id}</p>
      </div>
      <TypeBadge type={entry.type} />
      <VisibilityBadge visibility={entry.visibility} />
      <LgpdBadge category={entry.lgpd?.category ?? 'personal'} />
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
  const [roleOptions, setRoleOptions] = useState<AccessOption[]>([]);
  const [functionOptions, setFunctionOptions] = useState<AccessOption[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
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

  const editing = editingKey ? fields[editingKey] : null;

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
              category: nextLgpd.category,
            },
          },
        ];
      })
    ) as Record<string, EditableFieldMapEntry>);
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
    <div className="personal-field-config-density space-y-3 bg-[var(--bg)] px-3 py-3 text-[#1d1d26] md:px-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-[-.02em] text-[#181820]">Campos do Perfil</h1>
          <p className="mt-1 max-w-[560px] text-xs font-medium leading-5 text-[#6f6f7c]">
            Crie, nomeie e organize as seções e campos exibidos no perfil dos colaboradores.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Dialog>
            <DialogTrigger asChild>
              <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#e2e0da] bg-white px-3 text-xs font-black text-[#494952] hover:bg-[#faf9f6]">
                <ShieldCheck className="h-4 w-4 text-[#df2f78]" />
                Matriz de acesso
              </button>
            </DialogTrigger>
            <DialogContent className="max-h-[82vh] overflow-y-auto rounded-xl p-0 sm:max-w-[min(760px,calc(100vw-1rem))]" overlayClassName="bg-black/45">
              <DialogHeader className="space-y-0 px-4 pb-3 pt-4 text-left">
                <p className="text-[11.5px] font-bold uppercase tracking-[.12em] text-[#df2f78]">Matriz de acesso</p>
                <DialogTitle className="mt-1 text-base font-bold leading-tight tracking-[-.02em] text-[#191c22]">
                  Regra padrão por visibilidade
                </DialogTitle>
                <DialogDescription className="mt-1 max-w-[640px] text-xs leading-5 text-[#6a707a]">
                  O que cada perfil pode fazer em campos e cards. Vínculos de cargo, função e pessoa ficam na coluna Exceção.
                </DialogDescription>
                <div className="!mt-3.5 inline-flex w-fit items-center gap-[7px] rounded-full border border-[#df2f78]/[.16] bg-[#df2f78]/[.07] py-1.5 pl-2.5 pr-3 text-[12.5px] font-semibold text-[#df2f78]">
                  <span className="h-[7px] w-[7px] rounded-full bg-[#df2f78]" />
                  Base do perfil
                </div>
              </DialogHeader>

              <div className="px-4">
                <AccessMatrixPanel
                  matrix={accessMatrix}
                  onChange={setAccessMatrix}
                  roleOptions={roleOptions}
                  functionOptions={functionOptions}
                  userOptions={userOptions}
                  showHeader={false}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-3">
                <PermissionLegend />
                <div className="flex items-center gap-2.5">
                  <DialogClose asChild>
                    <button
                      type="button"
                      className="h-[42px] rounded-[11px] border border-[#e2e4e8] bg-white px-5 text-sm font-semibold text-[#3d434c] hover:bg-[#f6f7f8]"
                    >
                      Cancelar
                    </button>
                  </DialogClose>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="h-[42px] rounded-[11px] bg-[#df2f78] px-[22px] text-sm font-bold text-white shadow-[0_6px_16px_-6px_#df2f78] transition hover:brightness-[1.06] disabled:opacity-60"
                  >
                    {saving ? 'Salvando...' : 'Salvar alterações'}
                  </button>
                </div>
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
              className="h-11 w-full rounded-xl border-0 bg-[#f6f5f2] pl-10 pr-4 text-sm font-medium text-[#4f4f5b] outline-none placeholder:text-[#9d9da9]"
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
                        ? 'bg-white/[.18] text-white'
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

      {message ? <p className="rounded-2xl bg-white px-5 py-4 text-sm font-black text-[#6f6f7c] shadow-sm ring-1 ring-[#dedfe4]">{message}</p> : null}

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
                    <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[#9d9da9] hover:bg-[#f7f7f9]" aria-label={`Mais ações de ${section}`}>
                      <MoreHorizontal className="h-[18px] w-[18px]" />
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
                        <span>LGPD</span>
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
                              <SortableFieldRow id={key} entry={entry} position={index + 1} onEdit={() => setEditingKey(key)} onDelete={() => deleteField(key)} />
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
        <div className="pointer-events-none sticky bottom-[18px] z-20 mt-[22px] flex justify-center">
          <div className="pointer-events-auto flex flex-wrap items-center gap-4 rounded-2xl bg-[#181820] py-[11px] pl-5 pr-3 text-white shadow-[0_18px_40px_-12px_rgba(20,22,28,.55)]">
            <span className="inline-flex items-center gap-2.5 text-[13.5px] font-bold">
              <span className="h-2 w-2 rounded-full bg-[#f7b500] shadow-[0_0_0_4px_rgba(247,181,0,.2)]" />
              Você tem alterações não salvas
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={discard}
                disabled={saving}
                className="h-[38px] rounded-xl bg-white/[.12] px-[15px] text-[13px] font-bold text-[#e7e7ea] transition hover:bg-white/20 disabled:opacity-60"
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
      ) : null}

      {editing && editingKey ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[84vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-3 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-[#1d1d26]">Editar campo</h2>
                <p className="mt-1 font-mono text-sm font-semibold text-[#9d9da9]">{editingKey}</p>
              </div>
              <button type="button" onClick={() => setEditingKey(null)} className="h-8 rounded-lg bg-[#f1f2f5] px-3 text-xs font-black text-[#6f6f7c]">Fechar</button>
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
                <select value={normalizeFieldVisibility(editing.visibility)} onChange={(event) => {
                  const visibility = event.target.value as NormalizedFieldVisibility;
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
