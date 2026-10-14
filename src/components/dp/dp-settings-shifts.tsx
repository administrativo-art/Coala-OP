"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Chevron, EmptyResults, ListHead, ListRow, ListShell, ListSkeleton } from '@/components/cadastros/cadastros-ui';
import { useDP } from '@/components/dp-context';
import { ControlPanel, ControlSearch } from '@/components/patterns/control-panel';
import { Field, fieldInputClass } from '@/components/patterns/field';
import { FilterChips } from '@/components/patterns/filter-chips';
import { InlineConfirm } from '@/components/patterns/inline-confirm';
import { PanelField, PanelSection, SidePanel } from '@/components/patterns/side-panel';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { StatusPill } from '@/components/ui/status-pill';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { useDPTimeConfigs } from '@/hooks/use-dp-time-config';
import { formatShiftMinutes, shiftDurationSummary, shiftJourneyComparisons } from '@/lib/dp-shift-duration';
import { resolveBizneoShiftIdentity } from '@/lib/dp-shift-bizneo';
import { getShiftDefinitionUnitIds, getShiftDefinitionUnitNames } from '@/lib/dp-shift-definitions';
import { isShiftDefinitionCompatibleWithJourney } from '@/lib/dp-time-config-rules';
import { filterTimeConfigsByListStatus, timeConfigListCounts, type DPTimeConfigListStatus } from '@/lib/dp-time-config-status';
import { activeOperationalUnits } from '@/lib/dp-units';
import { cn } from '@/lib/utils';
import type { DPJourney, DPShiftDefinition } from '@/types';

const DOW_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ROW_TEMPLATE = 'minmax(220px,1.2fr) minmax(225px,1fr) minmax(225px,1fr) minmax(170px,.9fr) minmax(170px,1fr) 16px';

function resolveShiftExpectation(definition: DPShiftDefinition, journeys: DPJourney[]) {
  const candidates = journeys
    .filter((journey) => journey.status === 'published')
    .filter((journey) => isShiftDefinitionCompatibleWithJourney({
      journeyId: journey.id,
      journeyAllowedShiftDefinitionIds: journey.allowedShiftDefinitionIds,
      shiftDefinitionId: definition.id,
      shiftJourneyIds: definition.journeyIds,
    }))
    .flatMap((journey) => shiftJourneyComparisons(definition, journey).map((comparison) => ({ journey, comparison })));
  const unique = new Map(candidates.map((candidate) => [
    `${candidate.comparison.expectedStartTime}:${candidate.comparison.expectedEndTime}:${candidate.comparison.expectedWorkMinutes}:${candidate.comparison.expectedBreakMinutes}`,
    candidate,
  ]));
  if (unique.size === 1) return { status: 'resolved' as const, ...unique.values().next().value! };
  if (unique.size > 1) return { status: 'variable' as const, count: unique.size };
  return { status: 'unresolved' as const };
}

function getDisplayCode(def: DPShiftDefinition) {
  const raw = String(def.code ?? '').trim();
  if (!raw) return '—';
  return /^\d+$/.test(raw) ? `#${raw}` : raw;
}

function breakDescription(def: DPShiftDefinition) {
  const type = def.breakType ?? (def.breakStart && def.breakEnd ? 'fixed' : 'none');
  if (type === 'fixed' && def.breakStart && def.breakEnd) return `Único pré-definido · ${def.breakStart}–${def.breakEnd}`;
  if (type === 'flexible') return `Livre · ${def.breakDurationMinutes ?? 0} min`;
  if (type === 'staggered') {
    const window = def.breakWindowStart && def.breakWindowEnd ? ` · janela ${def.breakWindowStart}–${def.breakWindowEnd}` : '';
    return `Intercalado · ${def.breakDurationMinutes ?? 0} min${window}`;
  }
  return 'Sem intervalo';
}

const shiftDefSchema = z.object({
  code: z.string().min(1, 'Informe o código.').max(10, 'Use até 10 caracteres.'),
  name: z.string().min(1, 'Informe o nome.'),
  startTime: z.string().min(1, 'Informe o horário de início.'),
  endTime: z.string().min(1, 'Informe o horário de fim.'),
  breakStart: z.string().optional(),
  breakEnd: z.string().optional(),
  breakType: z.enum(['none', 'fixed', 'flexible', 'staggered']),
  breakDurationMinutes: z.string().optional(),
  breakWindowStart: z.string().optional(),
  breakWindowEnd: z.string().optional(),
  unitIds: z.array(z.string()).optional(),
  daysOfWeek: z.array(z.number()).min(1, 'Selecione ao menos um dia.'),
  bizneoTemplateId: z.string().optional(),
  journeyIds: z.array(z.string()).optional(),
  description: z.string().max(1000, 'Use até 1.000 caracteres.').optional(),
  configurationNotes: z.string().max(2000, 'Use até 2.000 caracteres.').optional(),
  overnight: z.boolean(),
  expectedPunches: z.string().refine((value) => {
    if (!value) return true;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 2 && parsed <= 12;
  }, 'Informe um número inteiro entre 2 e 12.').optional(),
}).superRefine((value, context) => {
  if (value.breakType === 'fixed' && (!value.breakStart || !value.breakEnd)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakStart'], message: 'Informe início e fim do intervalo.' });
  }
  if (value.breakType === 'flexible' || value.breakType === 'staggered') {
    const duration = Number(value.breakDurationMinutes);
    if (!Number.isInteger(duration) || duration < 1 || duration > 480) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakDurationMinutes'], message: 'Informe uma duração entre 1 e 480 minutos.' });
    }
  }
  if (value.breakType === 'staggered' && (!value.breakWindowStart || !value.breakWindowEnd)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['breakWindowStart'], message: 'Informe a janela do intervalo intercalado.' });
  }
});

type ShiftDefForm = z.infer<typeof shiftDefSchema>;

function formValuesFor(def?: DPShiftDefinition | null): ShiftDefForm {
  const breakType = def?.breakType ?? (def?.breakStart && def.breakEnd ? 'fixed' : 'none');
  const bizneoIdentity = resolveBizneoShiftIdentity(def ?? undefined);
  return {
    code: def?.code ?? '',
    name: def?.name ?? '',
    startTime: def?.startTime ?? '',
    endTime: def?.endTime ?? '',
    breakStart: def?.breakStart ?? '',
    breakEnd: def?.breakEnd ?? '',
    breakType,
    breakDurationMinutes: def?.breakDurationMinutes == null ? '' : String(def.breakDurationMinutes),
    breakWindowStart: def?.breakWindowStart ?? '',
    breakWindowEnd: def?.breakWindowEnd ?? '',
    unitIds: getShiftDefinitionUnitIds(def),
    daysOfWeek: def?.daysOfWeek ?? [1, 2, 3, 4, 5],
    bizneoTemplateId: bizneoIdentity.id,
    journeyIds: def?.journeyIds ?? [],
    description: def?.description ?? '',
    configurationNotes: def?.configurationNotes ?? '',
    overnight: def?.overnight ?? false,
    expectedPunches: def?.expectedPunches == null ? '' : String(def.expectedPunches),
  };
}

type PanelState = { mode: 'view'; def: DPShiftDefinition } | { mode: 'edit'; def: DPShiftDefinition } | { mode: 'create' };

export function DPSettingsShifts() {
  const { permissions, isDefaultAdmin } = useAuth();
  const canManageTime = isDefaultAdmin || permissions.dp?.settings?.manageTime === true;
  const { items: journeys } = useDPTimeConfigs('journeys', canManageTime);
  const {
    addShiftDefinition,
    updateShiftDefinition,
    deleteShiftDefinition,
    shiftDefinitions,
    shiftDefsLoading,
    units,
    shiftDefsError,
  } = useDP();

  const [panel, setPanel] = useState<PanelState | null>(null);
  const [search, setSearch] = useState('');
  const [listStatus, setListStatus] = useState<DPTimeConfigListStatus>('active');
  const [unitFilter, setUnitFilter] = useState('all');
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const archiveTriggerRef = useRef<HTMLButtonElement>(null);

  const form = useForm<ShiftDefForm>({ resolver: zodResolver(shiftDefSchema), defaultValues: formValuesFor(null) });
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  const editing = panel?.mode === 'edit' || panel?.mode === 'create';
  const def = panel && panel.mode !== 'create' ? panel.def : null;
  const selectedBreakType = watch('breakType');

  useEffect(() => {
    setConfirmingArchive(false);
    setConfirmingDelete(false);
    setSaveError(null);
    if (panel?.mode === 'edit') reset(formValuesFor(panel.def));
    if (panel?.mode === 'create') reset(formValuesFor(null));
    // O formulário reinicia só quando o painel muda de turno ou de modo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  const resolveUnitLabels = (item: DPShiftDefinition) => {
    const linkedUnitIds = getShiftDefinitionUnitIds(item);
    const linkedUnitNames = getShiftDefinitionUnitNames(item);
    if (linkedUnitIds.length === 0) return linkedUnitNames;
    return linkedUnitIds.map((unitId, index) => units.find((unit) => unit.id === unitId)?.name ?? linkedUnitNames[index] ?? unitId);
  };

  const listCounts = useMemo(() => timeConfigListCounts(shiftDefinitions), [shiftDefinitions]);
  const statusDefinitions = useMemo(
    () => filterTimeConfigsByListStatus(shiftDefinitions, listStatus),
    [listStatus, shiftDefinitions],
  );
  const visibleDefinitions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return statusDefinitions.filter((item) => {
      const matchesSearch = !term || `${item.name} ${item.code ?? ''} ${resolveUnitLabels(item).join(' ')}`.toLocaleLowerCase('pt-BR').includes(term);
      const linkedUnitIds = getShiftDefinitionUnitIds(item);
      const matchesUnit = unitFilter === 'all'
        || (unitFilter === 'global' && linkedUnitIds.length === 0)
        || (unitFilter !== 'global' && (linkedUnitIds.length === 0 || linkedUnitIds.includes(unitFilter)));
      return matchesSearch && matchesUnit;
    });
    // resolveUnitLabels depende só de `units`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusDefinitions, search, unitFilter, units]);

  async function onSubmit(values: ShiftDefForm) {
    setSaveError(null);
    try {
      const selectedUnits = units.filter((unit) => (values.unitIds ?? []).includes(unit.id));
      const selectedUnitIds = selectedUnits.map((unit) => unit.id);
      const selectedUnitNames = selectedUnits.map((unit) => unit.name);
      const data = {
        ...values,
        code: panel?.mode === 'edit' ? panel.def.code : values.code,
        name: panel?.mode === 'edit' ? panel.def.name : values.name,
        unitIds: selectedUnitIds,
        unitNames: selectedUnitNames,
        unitId: selectedUnitIds[0],
        unitName: selectedUnitNames[0],
        bizneoTemplateId: panel?.mode === 'edit' ? panel.def.bizneoTemplateId : (values.bizneoTemplateId || undefined),
        breakStart: values.breakType === 'fixed' ? (values.breakStart || undefined) : undefined,
        breakEnd: values.breakType === 'fixed' ? (values.breakEnd || undefined) : undefined,
        breakDurationMinutes: values.breakType === 'flexible' || values.breakType === 'staggered'
          ? Number(values.breakDurationMinutes)
          : undefined,
        breakWindowStart: values.breakType === 'staggered' ? (values.breakWindowStart || undefined) : undefined,
        breakWindowEnd: values.breakType === 'staggered' ? (values.breakWindowEnd || undefined) : undefined,
        journeyIds: values.journeyIds ?? [],
        description: values.description || undefined,
        configurationNotes: values.configurationNotes || undefined,
        expectedPunches: values.expectedPunches ? Number(values.expectedPunches) : undefined,
      };
      if (panel?.mode === 'edit') await updateShiftDefinition(panel.def.id, data);
      else await addShiftDefinition(data);
      setPanel(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar o turno. Tente novamente.');
    }
  }

  async function confirmDelete() {
    if (!def) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await deleteShiftDefinition(def.id);
      setPanel(null);
    } catch {
      setConfirmingDelete(false);
      setSaveError('Não foi possível excluir o turno. Tente novamente.');
    } finally {
      setDeleting(false);
    }
  }

  async function setArchived(isArchived: boolean) {
    if (!def) return;
    setUpdatingStatus(true);
    setSaveError(null);
    try {
      await updateShiftDefinition(def.id, { isArchived });
      setPanel(null);
      setListStatus(isArchived ? 'archived' : 'active');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : `Não foi possível ${isArchived ? 'arquivar' : 'reativar'} o turno.`);
    } finally {
      setUpdatingStatus(false);
      setConfirmingArchive(false);
    }
  }

  if (shiftDefsLoading && shiftDefinitions.length === 0) {
    return (
      <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Carregando turnos">
        <ListSkeleton rows={5} />
      </div>
    );
  }
  if (shiftDefsError && shiftDefinitions.length === 0) {
    return <p role="alert" className="text-sm font-semibold text-ds-danger">Erro ao carregar turnos: {shiftDefsError}</p>;
  }

  return (
    <div className="space-y-5">
      <ControlPanel className="flex flex-col gap-4 px-[26px] pb-5 pt-[22px] shadow-none ring-1 ring-white/10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Turnos reutilizáveis</p>
            <p className="mt-1 text-[44px] font-bold leading-none tracking-tighter font-ds-mono">{statusDefinitions.length}</p>
            <p className="mt-1 text-base font-extrabold">Definições de turno</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ControlSearch value={search} onChange={setSearch} placeholder="Buscar turno, código ou unidade" />
          <select
            aria-label="Filtrar turnos por unidade ou quiosque"
            className="h-12 min-w-[210px] rounded-ds-btn-lg border border-white/10 bg-white/[0.07] px-4 text-sm font-bold text-white outline-hidden focus:ring-2 focus:ring-ds-accent-kicker"
            value={unitFilter}
            onChange={(event) => setUnitFilter(event.target.value)}
          >
            <option className="text-ds-ink" value="all">Todas as unidades</option>
            {activeOperationalUnits(units).map((unit) => (
              <option className="text-ds-ink" key={unit.id} value={unit.id}>{unit.name}</option>
            ))}
            <option className="text-ds-ink" value="global">Turnos globais</option>
          </select>
          <Button type="button" variant="primary-page" size="xl" onClick={() => setPanel({ mode: 'create' })}>
            + Novo turno
          </Button>
        </div>
        <FilterChips
          includeAll={false}
          value={listStatus}
          onChange={(value) => setListStatus(value === 'archived' ? 'archived' : 'active')}
          chips={[
            { value: 'active', label: 'Ativos', count: listCounts.active },
            { value: 'archived', label: 'Arquivados', count: listCounts.archived },
          ]}
        />
      </ControlPanel>

      <div className="flex items-baseline gap-2.5">
        <span className="text-[28px] font-extrabold tracking-[-0.03em]">{visibleDefinitions.length}</span>
        <span className="text-[13px] text-ds-ink-faint">de {statusDefinitions.length} turnos {listStatus === 'active' ? 'ativos' : 'arquivados'}</span>
      </div>

      <ListShell minWidth={1240}>
        <ListHead template={ROW_TEMPLATE}>
          <span>Turno</span>
          <span>Expediente definido</span>
          <span>Expediente esperado</span>
          <span>Dias</span>
          <span>Unidades</span>
          <span />
        </ListHead>
        {visibleDefinitions.map((item) => {
          const unitLabels = resolveUnitLabels(item);
          const definedDuration = shiftDurationSummary(item);
          const expectation = resolveShiftExpectation(item, journeys);
          return (
            <ListRow
              key={item.id}
              template={ROW_TEMPLATE}
              isOpen={def?.id === item.id}
              isSelected={false}
              isMuted={item.isArchived === true}
              onOpen={() => setPanel({ mode: 'view', def: item })}
              label={`Abrir turno ${item.name}`}
            >
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-bold">{item.name}</p>
              </div>
              <span className="text-xs text-ds-ink-muted">
                <span className="block font-ds-mono text-[13px] font-semibold text-ds-ink">{item.startTime}–{item.endTime} · {formatShiftMinutes(definedDuration.workedMinutes)}</span>
                <span className="mt-0.5 block">Intervalo {formatShiftMinutes(definedDuration.breakMinutes)}</span>
              </span>
              {expectation.status === 'resolved' ? (
                <span className="text-xs text-ds-ink-muted">
                  <span className="block font-ds-mono text-[13px] font-semibold text-ds-ink">{expectation.comparison.expectedStartTime}–{expectation.comparison.expectedEndTime} · {formatShiftMinutes(expectation.comparison.expectedWorkMinutes)}</span>
                  <span className="mt-0.5 block">Intervalo {formatShiftMinutes(expectation.comparison.expectedBreakMinutes)}</span>
                </span>
              ) : (
                <span className="text-xs font-semibold text-ds-ink-muted">{expectation.status === 'variable' ? 'Varia conforme a jornada' : 'Sem jornada aplicável'}</span>
              )}
              <span className="text-xs text-ds-ink-muted">{item.daysOfWeek.map((day) => DOW_LABELS[day]).join(' · ')}</span>
              <span className="truncate text-xs text-ds-ink-muted">{unitLabels.length > 0 ? unitLabels.join(', ') : 'Todas as unidades'}</span>
              <Chevron />
            </ListRow>
          );
        })}
        {shiftDefinitions.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhum turno cadastrado. Crie o primeiro com “Novo turno”.</p>
        ) : visibleDefinitions.length === 0 ? (
          <EmptyResults title={statusDefinitions.length === 0 ? `Nenhum turno ${listStatus === 'active' ? 'ativo' : 'arquivado'}.` : 'Nenhum turno encontrado com esses filtros.'} onClear={() => { setSearch(''); setUnitFilter('all'); }} />
        ) : null}
      </ListShell>

      <SidePanel
        open={!!panel}
        onOpenChange={(open) => { if (!open) setPanel(null); }}
        kicker={panel?.mode === 'create' ? 'Novo turno' : panel?.mode === 'edit' ? 'Editar turno' : 'Turno'}
        title={panel?.mode === 'create' ? 'Sem nome' : (def?.name ?? '')}
        subtitle="Código, horários e dias da semana do turno reutilizável."
      >
        {panel && !editing && def ? (
          <>
            <PanelSection title="Situação">
              <div className="flex items-center justify-between gap-3">
                <StatusPill variant={def.isArchived ? 'neutral' : 'ok'}>{def.isArchived ? 'Arquivado' : 'Ativo'}</StatusPill>
                <p className="text-right text-xs text-ds-ink-muted">{def.isArchived ? 'Somente histórico; não pode ser usado em novas escalas.' : 'Disponível para novas configurações e escalas.'}</p>
              </div>
            </PanelSection>
            <PanelSection title="Horário">
              {(() => {
                const definedDuration = shiftDurationSummary(def);
                const expectation = resolveShiftExpectation(def, journeys);
                return (
                  <div className="space-y-3.5">
                    <PanelField label="Código">
                      <span className="font-ds-mono text-[15px] font-semibold">{getDisplayCode(def)}</span>
                    </PanelField>

                    <article className="rounded-ds-btn-lg border border-ds-border bg-white px-4 py-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ds-ink">Expediente definido</p>
                        <span className="rounded-ds-pill bg-ds-neutral-bg px-2.5 py-1 text-[10.5px] font-bold text-ds-neutral">Em vigor</span>
                      </div>
                      <p className="mt-2.5 font-ds-mono text-2xl font-bold leading-none text-ds-ink">{def.startTime}–{def.endTime}</p>
                      <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-ds-divider pt-3">
                        <div>
                          <dt className="text-[11px] font-semibold text-ds-ink-muted">Trabalho</dt>
                          <dd className="mt-0.5 text-base font-bold text-ds-ink">{formatShiftMinutes(definedDuration.workedMinutes)}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] font-semibold text-ds-ink-muted">Intervalo</dt>
                          <dd className="mt-0.5 text-base font-bold text-ds-ink">{formatShiftMinutes(definedDuration.breakMinutes)}</dd>
                          <dd className="mt-0.5 text-xs leading-snug text-ds-ink-muted">{breakDescription(def)}</dd>
                        </div>
                      </dl>
                    </article>

                    <article className="rounded-ds-btn border border-ds-divider bg-ds-surface px-3.5 py-3">
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ds-ink-muted">Esperado pela jornada</p>
                      {expectation.status === 'resolved' ? (
                        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
                          <p className="font-ds-mono text-base font-semibold text-ds-ink">
                            {expectation.comparison.expectedStartTime}–{expectation.comparison.expectedEndTime}
                          </p>
                          <p className="text-xs text-ds-ink-muted">
                            <span className="font-semibold text-ds-ink">{formatShiftMinutes(expectation.comparison.expectedWorkMinutes)}</span> de trabalho
                            {' · '}
                            <span className="font-semibold text-ds-ink">{formatShiftMinutes(expectation.comparison.expectedBreakMinutes)}</span> de intervalo
                          </p>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-xs font-semibold leading-relaxed text-ds-ink-muted">
                          {expectation.status === 'variable'
                            ? 'Varia conforme a jornada aplicável.'
                            : 'Não há jornada aplicável para calcular este expediente.'}
                        </p>
                      )}
                    </article>

                    {expectation.status === 'resolved' && expectation.comparison.endsBeforeExpected ? (
                      <p
                        role="note"
                        className={cn(
                          'rounded-ds-btn border px-3.5 py-3 text-xs font-semibold',
                          expectation.journey.useDefinedShiftWhenShorter ?? true
                            ? 'border-ds-alert-border bg-ds-alert-bg text-ds-alert-ink'
                            : 'border-ds-confirm-border bg-ds-confirm-bg text-ds-confirm-ink',
                        )}
                      >
                        {expectation.journey.useDefinedShiftWhenShorter ?? true
                          ? 'O expediente definido prevalece sobre o esperado da jornada.'
                          : 'Antecipação não autorizada na jornada.'}
                      </p>
                    ) : null}
                  </div>
                );
              })()}
            </PanelSection>
            <PanelSection title="Dias da semana">
              <div className="flex flex-wrap gap-1.5">
                {DOW_LABELS.map((label, index) => (
                  <StatusPill key={label} variant={def.daysOfWeek.includes(index) ? 'ok' : 'neutral'}>{label}</StatusPill>
                ))}
              </div>
            </PanelSection>
            <PanelSection title="Vínculos">
              <PanelField label="Unidades">{resolveUnitLabels(def).length > 0 ? resolveUnitLabels(def).join(', ') : 'Todas as unidades'}</PanelField>
              <PanelField label="Jornadas">{def.journeyIds?.length ? def.journeyIds.map((id) => journeys.find((journey) => journey.id === id)?.name ?? id).join(', ') : 'Sem restrição por jornada'}</PanelField>
            </PanelSection>
            <PanelSection title="Integração Bizneo">
              {(() => {
                const bizneoIdentity = resolveBizneoShiftIdentity(def);
                return (
              <div className="grid grid-cols-2 gap-4">
                <PanelField label="Nome exportado">{def.name}</PanelField>
                <PanelField label="ID do modelo">
                  {bizneoIdentity.id ? (
                    <span>
                      <span className="font-ds-mono">{bizneoIdentity.id}</span>
                      {bizneoIdentity.source === 'numeric_code' ? <span className="mt-0.5 block text-xs text-ds-ink-muted">Herdado do código legado</span> : null}
                    </span>
                  ) : 'Sem vínculo'}
                </PanelField>
              </div>
                );
              })()}
              <p className="text-xs leading-relaxed text-ds-ink-muted">O nome e o ID continuam sendo usados pela exportação atual. As novas configurações internas não criam outro turno.</p>
            </PanelSection>
            {(def.description || def.configurationNotes || def.expectedPunches) ? (
              <PanelSection title="Configuração interna">
                {def.description ? <PanelField label="Descrição">{def.description}</PanelField> : null}
                {def.expectedPunches ? <PanelField label="Batidas esperadas">{def.expectedPunches}</PanelField> : null}
                {def.configurationNotes ? <PanelField label="Observações">{def.configurationNotes}</PanelField> : null}
              </PanelSection>
            ) : null}
            {saveError ? <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{saveError}</p> : null}
            <div className="mt-auto flex flex-col gap-3 border-t border-ds-divider pt-4">
              {def.isArchived && confirmingDelete ? (
                <InlineConfirm
                  message={`Excluir definitivamente o turno “${def.name}”?`}
                  loading={deleting}
                  returnFocusRef={deleteTriggerRef}
                  onCancel={() => setConfirmingDelete(false)}
                  onConfirm={() => void confirmDelete()}
                />
              ) : def.isArchived ? (
                <>
                  <Button type="button" variant="primary-modal" size="md" loading={updatingStatus} onClick={() => void setArchived(false)}>Reativar turno</Button>
                  <div>
                    <Button ref={deleteTriggerRef} type="button" variant="danger-link" size="xs" onClick={() => setConfirmingDelete(true)}>Excluir definitivamente</Button>
                  </div>
                </>
              ) : confirmingArchive ? (
                <InlineConfirm
                  message={`Arquivar o turno “${def.name}”? Ele deixará de aparecer em novas escalas.`}
                  loading={updatingStatus}
                  returnFocusRef={archiveTriggerRef}
                  onCancel={() => setConfirmingArchive(false)}
                  onConfirm={() => void setArchived(true)}
                />
              ) : (
                <>
                  <Button type="button" variant="primary-modal" size="md" onClick={() => setPanel({ mode: 'edit', def })}>Editar turno</Button>
                  <div>
                    <Button ref={archiveTriggerRef} type="button" variant="danger-link" size="xs" onClick={() => setConfirmingArchive(true)}>Arquivar turno</Button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}

        {panel && editing ? (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col gap-5" noValidate>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Código" htmlFor="shift-code" error={errors.code?.message} hint={panel.mode === 'edit' ? 'Preservado no turno existente.' : undefined}>
                <Input id="shift-code" placeholder="Ex.: T1" readOnly={panel.mode === 'edit'} aria-invalid={!!errors.code} className={cn(fieldInputClass, 'font-ds-mono')} {...register('code')} />
              </Field>
              <Field label="Nome" htmlFor="shift-name" error={errors.name?.message} className="col-span-2" hint={panel.mode === 'edit' ? 'Preservado para manter a exportação Bizneo.' : undefined}>
                <Input id="shift-name" placeholder="Ex.: Turno da manhã" readOnly={panel.mode === 'edit'} aria-invalid={!!errors.name} className={fieldInputClass} {...register('name')} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Início" htmlFor="shift-start" error={errors.startTime?.message}>
                <Input id="shift-start" type="time" aria-invalid={!!errors.startTime} className={fieldInputClass} {...register('startTime')} />
              </Field>
              <Field label="Fim" htmlFor="shift-end" error={errors.endTime?.message}>
                <Input id="shift-end" type="time" aria-invalid={!!errors.endTime} className={fieldInputClass} {...register('endTime')} />
              </Field>
            </div>
            <div className="space-y-3 rounded-ds-btn-lg border border-ds-border bg-ds-surface px-4 py-4">
              <div className="flex items-center gap-2">
                <h3 className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Intervalo intrajornada</h3>
                <InfoTooltip title="Tipos de intervalo">
                  <p><strong>Único pré-definido:</strong> possui início e fim fixos.</p>
                  <p><strong>Livre:</strong> define somente a duração, sem horário fixo.</p>
                  <p><strong>Intercalado:</strong> define duração e uma janela para revezar os intervalos da equipe.</p>
                </InfoTooltip>
              </div>
              <Field label="Modalidade" htmlFor="shift-break-type">
                <select id="shift-break-type" className={fieldInputClass} {...register('breakType')}>
                  <option value="none">Sem intervalo</option>
                  <option value="fixed">Intervalo único pré-definido</option>
                  <option value="flexible">Intervalo livre</option>
                  <option value="staggered">Intervalo intercalado</option>
                </select>
              </Field>
              {selectedBreakType === 'fixed' ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Início do intervalo" htmlFor="shift-break-start" error={errors.breakStart?.message}>
                    <Input id="shift-break-start" type="time" aria-invalid={!!errors.breakStart} className={fieldInputClass} {...register('breakStart')} />
                  </Field>
                  <Field label="Fim do intervalo" htmlFor="shift-break-end">
                    <Input id="shift-break-end" type="time" className={fieldInputClass} {...register('breakEnd')} />
                  </Field>
                </div>
              ) : null}
              {selectedBreakType === 'flexible' || selectedBreakType === 'staggered' ? (
                <Field label="Duração do intervalo" htmlFor="shift-break-duration" hint="Em minutos. De 1 a 480." error={errors.breakDurationMinutes?.message}>
                  <Input id="shift-break-duration" type="number" min={1} max={480} aria-invalid={!!errors.breakDurationMinutes} className={fieldInputClass} {...register('breakDurationMinutes')} />
                </Field>
              ) : null}
              {selectedBreakType === 'staggered' ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Início da janela" htmlFor="shift-break-window-start" error={errors.breakWindowStart?.message}>
                    <Input id="shift-break-window-start" type="time" aria-invalid={!!errors.breakWindowStart} className={fieldInputClass} {...register('breakWindowStart')} />
                  </Field>
                  <Field label="Fim da janela" htmlFor="shift-break-window-end">
                    <Input id="shift-break-window-end" type="time" className={fieldInputClass} {...register('breakWindowEnd')} />
                  </Field>
                </div>
              ) : null}
            </div>
            <Field label="Dias da semana" error={errors.daysOfWeek?.message}>
              <Controller
                control={control}
                name="daysOfWeek"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Dias da semana">
                    {DOW_LABELS.map((label, index) => {
                      const selected = field.value.includes(index);
                      return (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => field.onChange(selected ? field.value.filter((day) => day !== index) : [...field.value, index].sort())}
                          className={cn(
                            'h-10 min-w-[56px] rounded-ds-md px-3 text-sm font-bold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2',
                            selected
                              ? 'border-2 border-ds-modal bg-ds-modal-soft text-ds-modal-ink'
                              : 'border border-ds-border-input bg-white text-ds-ink-2'
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              />
            </Field>
            <Field label="Unidades vinculadas" requirement="opcional" hint="Sem unidades, o turno vale para todas.">
              <Controller
                control={control}
                name="unitIds"
                render={({ field }) => (
                  <MultiSelect
                    options={activeOperationalUnits(units).map((unit) => ({ value: unit.id, label: unit.name }))}
                    selected={field.value ?? []}
                    onChange={field.onChange}
                    placeholder="Selecione uma ou mais unidades"
                  />
                )}
              />
            </Field>
            <div className="rounded-ds-btn-lg border border-ds-border bg-ds-surface px-4 py-4">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Integração Bizneo</h3>
                <InfoTooltip title="Compatibilidade com o Bizneo">
                  <p>A exportação continua usando o nome do turno e o ID do modelo exatamente como hoje.</p>
                  <p>Jornada, descrição e demais metadados são internos do Coala One.</p>
                </InfoTooltip>
              </div>
              <Field label="ID do modelo no Bizneo" htmlFor="shift-bizneo" requirement="opcional" hint={panel.mode === 'edit' ? 'Preservado no turno existente; em registros legados, o código numérico é usado como ID.' : 'Usado como shift_id na exportação.'}>
                <Input id="shift-bizneo" placeholder="Ex.: 15693788" readOnly={panel.mode === 'edit'} className={cn(fieldInputClass, 'font-ds-mono')} {...register('bizneoTemplateId')} />
              </Field>
            </div>

            {canManageTime ? (
              <Field label="Jornadas permitidas" requirement="opcional" hint="Sem seleção, o turno pode ser usado por qualquer jornada. Ao selecionar, ele fica restrito às jornadas indicadas.">
                <Controller
                  control={control}
                  name="journeyIds"
                  render={({ field }) => (
                    <MultiSelect
                      options={journeys
                        .filter((journey) => journey.status === 'published' || (field.value ?? []).includes(journey.id))
                        .map((journey) => ({
                          value: journey.id,
                          label: `${journey.name} · v${journey.version}${journey.status === 'archived' ? ' · arquivada' : ''}`,
                        }))}
                      selected={field.value ?? []}
                      onChange={field.onChange}
                      placeholder="Sem restrição por jornada"
                    />
                  )}
                />
              </Field>
            ) : (
              <p className="text-xs text-ds-ink-muted">Para vincular jornadas, é necessária a permissão “Gerenciar Tempo”.</p>
            )}

            <Field label="Descrição interna" htmlFor="shift-description" requirement="opcional">
              <textarea id="shift-description" className={`${fieldInputClass} min-h-20 py-2`} {...register('description')} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Batidas esperadas" htmlFor="shift-punches" requirement="opcional" hint="De 2 a 12." error={errors.expectedPunches?.message}>
                <Input id="shift-punches" type="number" min={2} max={12} aria-invalid={!!errors.expectedPunches} className={fieldInputClass} {...register('expectedPunches')} />
              </Field>
              <Field label="Saída no dia seguinte" hint="Ative para turnos que atravessam a meia-noite.">
                <div className="flex h-10 items-center justify-between rounded-ds-md border border-ds-border-input bg-ds-input px-3">
                  <span className="text-[13px] text-ds-ink-2">Turno noturno</span>
                  <Controller control={control} name="overnight" render={({ field }) => <Switch aria-label="Turno com saída no dia seguinte" checked={field.value} onCheckedChange={field.onChange} />} />
                </div>
              </Field>
            </div>
            <Field label="Observações da configuração" htmlFor="shift-notes" requirement="opcional">
              <textarea id="shift-notes" className={`${fieldInputClass} min-h-24 py-2`} {...register('configurationNotes')} />
            </Field>

            {saveError ? <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{saveError}</p> : null}
            <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
              <Button type="button" variant="ds-secondary" size="md" disabled={isSubmitting} onClick={() => (def ? setPanel({ mode: 'view', def }) : setPanel(null))}>Cancelar</Button>
              <Button type="submit" variant="primary-modal" size="md" loading={isSubmitting}>
                {panel.mode === 'create' ? 'Criar turno' : 'Salvar turno'}
              </Button>
            </div>
          </form>
        ) : null}
      </SidePanel>
    </div>
  );
}
