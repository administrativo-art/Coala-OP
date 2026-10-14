"use client";

import type { ReactNode } from 'react';

import { Field, fieldInputClass } from '@/components/patterns/field';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { MultiSelect } from '@/components/ui/multi-select';
import type { DPTimeApplicability } from '@/types';

type Option = { id: string; name: string };
type PersonOption = { id: string; username: string };

function ScopeHelp() {
  return (
    <span className="inline-flex items-center gap-1.5">
      A regra mais específica prevalece quando houver mais de uma configuração aplicável.
      <InfoTooltip title="Como funciona a abrangência">
        <p>Você pode aplicar a configuração à empresa, a uma organização, a um grupo de unidades ou a uma unidade específica.</p>
        <p>Cargos, funções e pessoas refinam a abrangência, sem alterar seus cadastros.</p>
      </InfoTooltip>
    </span>
  );
}

export function DPTimeApplicabilityFields({
  value,
  onChange,
  units,
  unitOrganizations,
  unitGroups,
  roles,
  functions,
  people,
  idPrefix = 'time',
}: {
  value: DPTimeApplicability;
  onChange: (value: DPTimeApplicability) => void;
  units: Option[];
  unitOrganizations: Option[];
  unitGroups: Option[];
  roles: Option[];
  functions: Option[];
  people: PersonOption[];
  idPrefix?: string;
}) {
  const scopeId = value.scope.kind === 'company' ? '' : value.scope.id;
  const scopeKindId = `${idPrefix}-scope-kind`;
  const scopeValueId = `${idPrefix}-scope-id`;

  return (
    <div className="space-y-4">
      <Field label="Abrangência" htmlFor={scopeKindId} hint={<ScopeHelp />}>
        <select
          id={scopeKindId}
          className={fieldInputClass}
          value={value.scope.kind}
          onChange={(event) => {
            const kind = event.target.value as DPTimeApplicability['scope']['kind'];
            onChange({
              ...value,
              scope: kind === 'company' ? { kind: 'company' } : { kind, id: '' },
            });
          }}
        >
          <option value="company">Toda a empresa</option>
          <option value="unit_organization">Organização</option>
          <option value="unit_group">Grupo de unidades</option>
          <option value="unit">Unidade específica</option>
        </select>
      </Field>

      {value.scope.kind !== 'company' ? (
        <Field
          label={value.scope.kind === 'unit'
            ? 'Unidade'
            : value.scope.kind === 'unit_organization'
              ? 'Organização'
              : 'Grupo de unidades'}
          htmlFor={scopeValueId}
          error={!scopeId ? 'Selecione a abrangência.' : null}
        >
          <select
            id={scopeValueId}
            className={fieldInputClass}
            value={scopeId}
            onChange={(event) => onChange({ ...value, scope: { kind: value.scope.kind, id: event.target.value } })}
          >
            <option value="">Selecione</option>
            {(value.scope.kind === 'unit'
              ? units
              : value.scope.kind === 'unit_organization'
                ? unitOrganizations
                : unitGroups).map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field label="Cargos" requirement="opcional" hint="Use apenas quando a regra não deve valer para todos os cargos da abrangência.">
        <MultiSelect
          options={roles.map((option) => ({ value: option.id, label: option.name }))}
          selected={value.jobRoleIds ?? []}
          onChange={(jobRoleIds) => onChange({ ...value, jobRoleIds: jobRoleIds.length ? jobRoleIds : undefined })}
          placeholder="Todos os cargos"
        />
      </Field>
      <Field label="Funções" requirement="opcional">
        <MultiSelect
          options={functions.map((option) => ({ value: option.id, label: option.name }))}
          selected={value.jobFunctionIds ?? []}
          onChange={(jobFunctionIds) => onChange({ ...value, jobFunctionIds: jobFunctionIds.length ? jobFunctionIds : undefined })}
          placeholder="Todas as funções"
        />
      </Field>
      <Field label="Pessoas" requirement="opcional" hint="Exceção individual. Não altera cargo, função nem unidade da pessoa.">
        <MultiSelect
          options={people.map((option) => ({ value: option.id, label: option.username }))}
          selected={value.collaboratorIds ?? []}
          onChange={(collaboratorIds) => onChange({ ...value, collaboratorIds: collaboratorIds.length ? collaboratorIds : undefined })}
          placeholder="Todas as pessoas"
        />
      </Field>
    </div>
  );
}

export function TimeConfigurationNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-ds-btn-lg border border-ds-border bg-ds-info-bg px-4 py-3 text-[12.5px] font-semibold leading-relaxed text-ds-info">
      {children}
    </div>
  );
}
