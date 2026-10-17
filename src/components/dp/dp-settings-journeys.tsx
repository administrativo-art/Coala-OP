"use client";

import { useEffect, useMemo, useRef, useState } from 'react';

import { EmptyResults, ListHead, ListRow, ListShell, ListSkeleton, Chevron } from '@/components/cadastros/cadastros-ui';
import { useDP } from '@/components/dp-context';
import { DPTimeApplicabilityFields, TimeConfigurationNotice } from '@/components/dp/dp-time-config-fields';
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
import { useHrBootstrap } from '@/hooks/use-hr-bootstrap';
import {
  applicabilityLabel,
  buildJourneyDays,
  formatValidityBR,
  formatDuration,
  journeyCycleMatchesWeeklyLoad,
  journeyDistributionLabel,
  journeyRegimeDescription,
  journeyRegimeLabel,
  maskDurationInput,
  monthlyWorkloadMinutes,
  parseCycleLengthDaysInput,
  parseDuration,
  timeConfigStatusLabel,
  weeklyRestPlacementLabel,
} from '@/lib/dp-time-config-ui';
import { defaultExpectedBreakMinutes, formatShiftMinutes, shiftJourneyComparisons } from '@/lib/dp-shift-duration';
import { activeOperationalUnits } from '@/lib/dp-units';
import { resolveUnitAccess } from '@/lib/unit-access';
import { filterTimeConfigsByListStatus, timeConfigListCounts, type DPTimeConfigListStatus } from '@/lib/dp-time-config-status';
import type { DPJourney, DPJourneyDay, DPShiftDefinition, DPTimeApplicability } from '@/types';

const ROW_TEMPLATE = 'minmax(220px,1.35fr) 110px 110px minmax(180px,1fr) 140px 16px';

type JourneyForm = {
  name: string;
  description: string;
  weeklyLoad: string;
  cycleLengthDays: string;
  dayDurations: string[];
  regimeMode: NonNullable<DPJourney['regime']>['mode'];
  flexibleWindowStart: string;
  flexibleWindowEnd: string;
  weeklyRestPlacement: NonNullable<DPJourney['weeklyRest']>['placement'];
  scaleValidationMode: NonNullable<DPJourney['scaleValidation']>['mode'];
  expectedBreakMinutes: string;
  useDefinedShiftWhenShorter: boolean;
  maxConsecutiveWorkDays: string;
  sundayCadenceWeeks: string;
  allowedShiftDefinitionIds: string[];
  applicability: DPTimeApplicability;
  validFrom: string;
  validTo: string;
};

type PanelState =
  | { mode: 'view'; item: DPJourney }
  | { mode: 'edit'; item: DPJourney }
  | { mode: 'create'; supersedes?: DPJourney };

const defaultDays = ['07:20', '07:20', '07:20', '07:20', '07:20', '07:20', '00:00'];

function shorterShiftComparisons(
  journey: Pick<DPJourney, 'days' | 'expectedBreakMinutes' | 'allowedShiftDefinitionIds'>,
  shiftDefinitions: DPShiftDefinition[],
) {
  const allowed = new Set(journey.allowedShiftDefinitionIds ?? []);
  const candidates = allowed.size
    ? shiftDefinitions.filter((shift) => allowed.has(shift.id))
    : shiftDefinitions.filter((shift) => shift.isArchived !== true);
  return candidates.flatMap((shift) => shiftJourneyComparisons(shift, journey)
    .filter((comparison) => comparison.endsBeforeExpected)
    .map((comparison) => ({ shift, comparison })));
}

const regimeOptions: Array<{
  mode: JourneyForm['regimeMode'];
  label: string;
  description: string;
}> = [
  {
    mode: 'fixed',
    label: 'Fixa',
    description: 'Compara as batidas com os horários do turno escalado.',
  },
  {
    mode: 'flexible',
    label: 'Flexível',
    description: 'Apura a quantidade trabalhada, sem exigir horários exatos.',
  },
];

function formFor(item?: DPJourney): JourneyForm {
  const firstWorkdayMinutes = item?.days.find((day) => !day.isRestDay)?.plannedMinutes ?? 440;
  return {
    name: item?.name ?? '',
    description: item?.description ?? '',
    weeklyLoad: formatDuration(item?.weeklyMinutes ?? 44 * 60),
    cycleLengthDays: item ? String(item.cycleLengthDays) : '',
    dayDurations: item
      ? buildJourneyDays(item.cycleLengthDays, item.days).map((day) => formatDuration(day.plannedMinutes))
      : defaultDays,
    regimeMode: item?.regime?.mode ?? 'fixed',
    flexibleWindowStart: item?.regime?.mode === 'flexible' ? item.regime.windowStart ?? '' : '',
    flexibleWindowEnd: item?.regime?.mode === 'flexible' ? item.regime.windowEnd ?? '' : '',
    weeklyRestPlacement: item?.weeklyRest?.placement ?? 'fixed_cycle',
    scaleValidationMode: item?.scaleValidation?.mode ?? 'consecutive_days',
    expectedBreakMinutes: String(item?.expectedBreakMinutes ?? defaultExpectedBreakMinutes(firstWorkdayMinutes)),
    useDefinedShiftWhenShorter: item ? item.useDefinedShiftWhenShorter ?? true : false,
    maxConsecutiveWorkDays: String(item?.weeklyRest?.maxConsecutiveWorkDays ?? 6),
    sundayCadenceWeeks: item?.weeklyRest?.sundayCadenceWeeks ? String(item.weeklyRest.sundayCadenceWeeks) : '',
    allowedShiftDefinitionIds: item?.allowedShiftDefinitionIds ?? [],
    applicability: item?.applicability ?? { scope: { kind: 'company' } },
    validFrom: item?.validFrom ?? new Date().toISOString().slice(0, 10),
    validTo: item?.validTo ?? '',
  };
}

function statusVariant(status: DPJourney['status']) {
  if (status === 'published') return 'ok' as const;
  if (status === 'archived') return 'neutral' as const;
  return 'warn' as const;
}

function buildPayload(form: JourneyForm) {
  const weeklyMinutes = parseDuration(form.weeklyLoad);
  const cycleLengthDays = parseCycleLengthDaysInput(form.cycleLengthDays);
  if (form.name.trim().length < 2) throw new Error('Informe um nome com pelo menos 2 caracteres.');
  if (!weeklyMinutes) throw new Error('Informe a carga semanal no formato HH:MM.');
  if (!cycleLengthDays) throw new Error('Informe os dias do ciclo, de 1 a 42.');
  const parsedDays = Array.from(
    { length: cycleLengthDays },
    (_, index) => parseDuration(form.dayDurations[index] ?? '00:00'),
  );
  if (parsedDays.some((value) => value == null)) throw new Error('Revise os horários do ciclo. Use o formato HH:MM.');
  if (!form.validFrom) throw new Error('Informe o início da vigência.');
  if (form.validTo && form.validTo < form.validFrom) throw new Error('O fim da vigência deve ser posterior ao início.');
  if (form.applicability.scope.kind !== 'company' && !form.applicability.scope.id) throw new Error('Selecione a abrangência da jornada.');
  if (form.regimeMode === 'flexible' && Boolean(form.flexibleWindowStart) !== Boolean(form.flexibleWindowEnd)) {
    throw new Error('Informe o início e o fim da janela flexível, ou deixe os dois campos vazios.');
  }
  if (form.regimeMode === 'flexible' && form.flexibleWindowStart && form.flexibleWindowStart === form.flexibleWindowEnd) {
    throw new Error('A janela flexível precisa ter horários diferentes.');
  }

  const days: DPJourneyDay[] = parsedDays.map((plannedMinutes, index) => ({
    dayIndex: index + 1,
    plannedMinutes: plannedMinutes!,
    isRestDay: plannedMinutes === 0,
  }));
  if (!days.some((day) => day.isRestDay)) throw new Error('O ciclo precisa prever ao menos um descanso semanal.');
  if (!journeyCycleMatchesWeeklyLoad(weeklyMinutes, cycleLengthDays, days)) {
    throw new Error('A soma do ciclo não corresponde à carga semanal informada.');
  }
  const maxConsecutiveWorkDays = Number(form.maxConsecutiveWorkDays);
  if (!Number.isInteger(maxConsecutiveWorkDays) || maxConsecutiveWorkDays < 1 || maxConsecutiveWorkDays > 6) {
    throw new Error('O limite de dias consecutivos deve estar entre 1 e 6.');
  }
  const sundayCadenceWeeks = form.sundayCadenceWeeks ? Number(form.sundayCadenceWeeks) : undefined;
  if (sundayCadenceWeeks !== undefined && (!Number.isInteger(sundayCadenceWeeks) || sundayCadenceWeeks < 1 || sundayCadenceWeeks > 12)) {
    throw new Error('A periodicidade de domingo deve estar entre 1 e 12 semanas.');
  }
  const expectedBreakMinutes = Number(form.expectedBreakMinutes);
  if (!Number.isInteger(expectedBreakMinutes) || expectedBreakMinutes < 0 || expectedBreakMinutes > 480) {
    throw new Error('O intervalo esperado deve estar entre 0 e 480 minutos.');
  }

  return {
    name: form.name.trim(),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    weeklyMinutes,
    cycleLengthDays,
    days,
    regime: form.regimeMode === 'flexible'
      ? {
          mode: 'flexible' as const,
          ...(form.flexibleWindowStart ? { windowStart: form.flexibleWindowStart, windowEnd: form.flexibleWindowEnd } : {}),
        }
      : { mode: form.regimeMode },
    weeklyRest: {
      placement: form.weeklyRestPlacement,
      maxConsecutiveWorkDays,
      ...(sundayCadenceWeeks ? { sundayCadenceWeeks } : {}),
    },
    scaleValidation: { mode: form.scaleValidationMode },
    expectedBreakMinutes,
    useDefinedShiftWhenShorter: form.useDefinedShiftWhenShorter,
    ...(form.allowedShiftDefinitionIds.length ? { allowedShiftDefinitionIds: form.allowedShiftDefinitionIds } : {}),
    applicability: form.applicability,
    validFrom: form.validFrom,
    ...(form.validTo ? { validTo: form.validTo } : {}),
  };
}

export function DPSettingsJourneys() {
  const { permissions, isDefaultAdmin, activeUsers, user } = useAuth();
  const canManage = Boolean(
    (isDefaultAdmin || permissions.dp?.settings?.manageTime === true)
    && user
    && resolveUnitAccess(user, { isDefaultAdmin }).allUnits
  );
  const { units, unitGroups, unitOrganizations, shiftDefinitions } = useDP();
  const { roles, functions } = useHrBootstrap();
  const { items, loading, error, reload, create, update } = useDPTimeConfigs('journeys', canManage);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [form, setForm] = useState<JourneyForm>(() => formFor());
  const [search, setSearch] = useState('');
  const [listStatus, setListStatus] = useState<DPTimeConfigListStatus>('active');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const archiveTriggerRef = useRef<HTMLButtonElement>(null);

  const editing = panel?.mode === 'create' || panel?.mode === 'edit';
  const item = panel && panel.mode !== 'create' ? panel.item : panel?.supersedes ?? null;
  const editingCycleLengthDays = parseCycleLengthDaysInput(form.cycleLengthDays);

  useEffect(() => {
    setSaveError(null);
    setConfirmingArchive(false);
    if (panel?.mode === 'edit') setForm(formFor(panel.item));
    if (panel?.mode === 'create') setForm(formFor(panel.supersedes));
  }, [panel]);

  const unitNames = useMemo(() => new Map(units.map((unit) => [unit.id, unit.name])), [units]);
  const groupNames = useMemo(() => new Map(unitGroups.map((group) => [group.id, group.name])), [unitGroups]);
  const organizationNames = useMemo(() => new Map(unitOrganizations.map((organization) => [organization.id, organization.name])), [unitOrganizations]);
  const listCounts = useMemo(() => timeConfigListCounts(items), [items]);
  const statusItems = useMemo(() => filterTimeConfigsByListStatus(items, listStatus), [items, listStatus]);
  const visibleItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    if (!term) return statusItems;
    return statusItems.filter((entry) => `${entry.name} ${entry.description ?? ''} ${journeyRegimeLabel(entry.regime)} ${applicabilityLabel(entry.applicability, { unitNames, unitGroupNames: groupNames, unitOrganizationNames: organizationNames })}`.toLocaleLowerCase('pt-BR').includes(term));
  }, [groupNames, organizationNames, search, statusItems, unitNames]);
  const draftComparisonRows = useMemo(() => {
    const cycleLengthDays = parseCycleLengthDaysInput(form.cycleLengthDays);
    if (!editing || !cycleLengthDays) return [];
    const days = Array.from({ length: cycleLengthDays }, (_, index) => {
      const plannedMinutes = parseDuration(form.dayDurations[index] ?? '00:00') ?? 0;
      return { dayIndex: index + 1, plannedMinutes, isRestDay: plannedMinutes === 0 };
    });
    const expectedBreakMinutes = Number(form.expectedBreakMinutes);
    return shorterShiftComparisons({
      days,
      ...(Number.isInteger(expectedBreakMinutes) ? { expectedBreakMinutes } : {}),
      allowedShiftDefinitionIds: form.allowedShiftDefinitionIds,
    }, shiftDefinitions);
  }, [editing, form.allowedShiftDefinitionIds, form.cycleLengthDays, form.dayDurations, form.expectedBreakMinutes, shiftDefinitions]);

  async function saveJourney() {
    setSaveError(null);
    setSaving(true);
    try {
      const payload = buildPayload(form);
      if (panel?.mode === 'edit') {
        const updated = await update(panel.item.id, {
          action: 'update',
          data: {
            ...payload,
            description: form.description.trim() || null,
            allowedShiftDefinitionIds: form.allowedShiftDefinitionIds,
            validTo: form.validTo || null,
          },
        });
        setPanel({ mode: 'view', item: updated });
      } else if (panel?.mode === 'create') {
        const created = await create({ ...payload, ...(panel.supersedes ? { supersedesId: panel.supersedes.id } : {}) });
        setPanel({ mode: 'view', item: created });
      }
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : 'Não foi possível salvar a jornada.');
    } finally {
      setSaving(false);
    }
  }

  async function transition(action: 'publish' | 'archive') {
    if (!item) return;
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await update(item.id, { action });
      setPanel({ mode: 'view', item: updated });
      if (action === 'archive') setListStatus('archived');
    } catch (transitionError) {
      setSaveError(transitionError instanceof Error ? transitionError.message : 'Não foi possível alterar a situação da jornada.');
    } finally {
      setSaving(false);
      setConfirmingArchive(false);
    }
  }

  if (!canManage) {
    return <p role="alert" className="text-sm font-semibold text-ds-danger">Você não tem permissão para gerenciar jornadas.</p>;
  }
  if (loading && items.length === 0) {
    return <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Carregando jornadas"><ListSkeleton rows={4} /></div>;
  }
  if (error && items.length === 0) {
    return (
      <div className="space-y-3" role="alert">
        <p className="text-sm font-semibold text-ds-danger">Erro ao carregar jornadas: {error}</p>
        <Button type="button" variant="ds-secondary" size="sm" onClick={() => void reload()}>Tentar novamente</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <TimeConfigurationNotice>
        <span className="inline-flex flex-wrap items-center gap-2">
          Jornada é a referência contratual. Ela define a carga e o limite do ciclo; a escala apenas registra em quais datas os turnos e as folgas acontecem.
          <InfoTooltip title="Jornada, turno e escala">
            <p>A jornada define carga, ciclo, abrangência e vigência.</p>
            <p>O turno define o horário de uma ocorrência e continua com o mesmo nome e ID usados no Bizneo.</p>
            <p>Na regra 6×1 móvel, a jornada exige uma folga após no máximo seis dias; a escala escolhe e registra a data dessa folga. Não são duas regras diferentes.</p>
          </InfoTooltip>
        </span>
      </TimeConfigurationNotice>

      <ControlPanel className="flex flex-col gap-4 px-[26px] pb-5 pt-[22px] shadow-none ring-1 ring-white/10">
        <div>
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Referências contratuais</p>
          <p className="mt-1 font-ds-mono text-[44px] font-bold leading-none tracking-tighter">{statusItems.length}</p>
          <p className="mt-1 text-base font-extrabold">Jornadas cadastradas</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ControlSearch value={search} onChange={setSearch} placeholder="Buscar jornada ou abrangência" />
          <Button type="button" variant="primary-page" size="xl" onClick={() => setPanel({ mode: 'create' })}>+ Nova jornada</Button>
        </div>
        <FilterChips
          includeAll={false}
          value={listStatus}
          onChange={(value) => setListStatus(value === 'archived' ? 'archived' : 'active')}
          chips={[
            { value: 'active', label: 'Ativas', count: listCounts.active },
            { value: 'archived', label: 'Arquivadas', count: listCounts.archived },
          ]}
        />
      </ControlPanel>

      <div className="flex items-baseline gap-2.5">
        <span className="text-[28px] font-extrabold tracking-[-0.03em]">{visibleItems.length}</span>
        <span className="text-[13px] text-ds-ink-faint">de {statusItems.length} jornadas {listStatus === 'active' ? 'ativas' : 'arquivadas'}</span>
      </div>

      <ListShell minWidth={940}>
        <ListHead template={ROW_TEMPLATE}>
          <span>Jornada</span><span>Carga semanal</span><span>Carga mensal</span><span>Abrangência</span><span>Situação</span><span />
        </ListHead>
        {visibleItems.map((entry) => (
          <ListRow
            key={entry.id}
            template={ROW_TEMPLATE}
            isOpen={item?.id === entry.id}
            isSelected={false}
            isMuted={entry.status === 'archived'}
            onOpen={() => setPanel({ mode: 'view', item: entry })}
            label={`Abrir jornada ${entry.name}`}
          >
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-bold">{entry.name}</p>
              <p className="truncate text-xs text-ds-ink-muted">Versão {entry.version} · {journeyRegimeLabel(entry.regime)} · ciclo de {entry.cycleLengthDays} dias</p>
            </div>
            <span className="font-ds-mono text-[13px] font-semibold">{formatDuration(entry.weeklyMinutes)}</span>
            <span className="font-ds-mono text-[13px] font-semibold">{formatDuration(monthlyWorkloadMinutes(entry.weeklyMinutes))}</span>
            <span className="truncate text-xs text-ds-ink-muted">{applicabilityLabel(entry.applicability, { unitNames, unitGroupNames: groupNames, unitOrganizationNames: organizationNames })}</span>
            <StatusPill variant={statusVariant(entry.status)}>{timeConfigStatusLabel(entry.status)}</StatusPill>
            <Chevron />
          </ListRow>
        ))}
        {items.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhuma jornada cadastrada. Crie a primeira como rascunho.</p>
        ) : visibleItems.length === 0 ? <EmptyResults title={statusItems.length === 0 ? `Nenhuma jornada ${listStatus === 'active' ? 'ativa' : 'arquivada'}.` : 'Nenhuma jornada encontrada com essa busca.'} onClear={() => setSearch('')} /> : null}
      </ListShell>

      <SidePanel
        open={!!panel}
        onOpenChange={(open) => { if (!open) setPanel(null); }}
        kicker={panel?.mode === 'create' ? (panel.supersedes ? 'Nova versão' : 'Nova jornada') : panel?.mode === 'edit' ? 'Editar jornada' : `Jornada · v${item?.version ?? 1}`}
        title={editing ? (form.name || 'Sem nome') : (item?.name ?? '')}
        subtitle="Carga contratual, ciclo, forma de apuração, turnos permitidos, abrangência e vigência."
      >
        {panel && !editing && item ? (
          <>
            <PanelSection title="Referência">
              <div className="grid grid-cols-2 gap-4">
                <PanelField label="Carga semanal"><span className="font-ds-mono">{formatDuration(item.weeklyMinutes)}</span></PanelField>
                <PanelField label="Carga mensal"><span className="font-ds-mono">{formatDuration(monthlyWorkloadMinutes(item.weeklyMinutes))}</span></PanelField>
                <PanelField label="Ciclo">{item.cycleLengthDays} dias</PanelField>
                <PanelField label="Vigência">{formatValidityBR(item.validFrom, item.validTo)}</PanelField>
                <PanelField label="Situação"><StatusPill variant={statusVariant(item.status)}>{timeConfigStatusLabel(item.status)}</StatusPill></PanelField>
              </div>
              {item.description ? <p className="text-[13px] text-ds-ink-muted">{item.description}</p> : null}
            </PanelSection>
            <PanelSection title="Distribuição do ciclo">
              <div className="grid grid-cols-2 gap-2">
                {item.days.map((day, index) => (
                  <div key={day.dayIndex} className="flex items-center justify-between rounded-ds-md border border-ds-divider px-2.5 py-2 text-xs">
                    <span>{journeyDistributionLabel(
                      day,
                      item.cycleLengthDays,
                      item.weeklyRest,
                      item.days.slice(0, index + 1).filter((entry) => !entry.isRestDay).length,
                      item.days.slice(0, index + 1).filter((entry) => entry.isRestDay).length,
                    )}</span>
                    <span className="font-ds-mono font-bold">{day.isRestDay ? (item.weeklyRest?.placement === 'schedule' ? 'DSR móvel' : 'Descanso') : formatDuration(day.plannedMinutes)}</span>
                  </div>
                ))}
              </div>
            </PanelSection>
            <PanelSection title="Descanso semanal remunerado">
              <PanelField label="Posicionamento">{weeklyRestPlacementLabel(item.weeklyRest)}</PanelField>
              <PanelField label="Limite de trabalho seguido">{item.weeklyRest?.maxConsecutiveWorkDays ?? 6} dias</PanelField>
              <PanelField label="Coincidência com domingo">
                {item.weeklyRest?.sundayCadenceWeeks
                  ? `Ao menos uma vez a cada ${item.weeklyRest.sundayCadenceWeeks} semana(s)`
                  : 'Sem periodicidade adicional configurada'}
              </PanelField>
              <PanelField label="Validação da escala">
                {item.scaleValidation?.mode === 'manual_review'
                  ? 'Revisão manual antes do fechamento'
                  : 'Automática por dias consecutivos'}
              </PanelField>
            </PanelSection>
            <PanelSection title="Forma de apuração">
              <PanelField label="Regime">{journeyRegimeLabel(item.regime)}</PanelField>
              <p className="text-[13px] text-ds-ink-muted">{journeyRegimeDescription(item.regime)}</p>
              {item.regime?.mode === 'flexible' ? (
                <PanelField label="Janela permitida">
                  {item.regime.windowStart && item.regime.windowEnd
                    ? `${item.regime.windowStart}–${item.regime.windowEnd}`
                    : 'Sem restrição de janela'}
                </PanelField>
              ) : null}
            </PanelSection>
            <PanelSection title="Expediente menor que o esperado">
              <PanelField label="Comportamento">
                {(item.useDefinedShiftWhenShorter ?? true)
                  ? 'O expediente definido no turno prevalece'
                  : 'Não autorizado nesta jornada'}
              </PanelField>
              <PanelField label="Intervalo do expediente esperado">
                {formatShiftMinutes(item.expectedBreakMinutes ?? defaultExpectedBreakMinutes(item.days.find((day) => !day.isRestDay)?.plannedMinutes ?? 0))}
              </PanelField>
              {(item.useDefinedShiftWhenShorter ?? true) ? (
                <div className="space-y-2">
                  {shorterShiftComparisons(item, shiftDefinitions).map(({ shift, comparison }) => (
                    <div key={`${shift.id}:${comparison.expectedWorkMinutes}`} className="rounded-ds-md border border-ds-divider bg-ds-surface px-3 py-2.5 text-xs">
                      <p className="font-extrabold text-ds-ink">{shift.name}</p>
                      <p className="mt-1 text-ds-ink-muted">
                        Definido: <span className="font-ds-mono font-bold text-ds-ink">{shift.startTime}–{shift.endTime}</span>
                        {' · '}{formatShiftMinutes(comparison.defined.workedMinutes)} trabalhadas
                        {' · '}{formatShiftMinutes(comparison.defined.breakMinutes)} de intervalo
                      </p>
                      <p className="mt-0.5 text-ds-ink-muted">
                        Esperado: <span className="font-ds-mono font-bold text-ds-ink">{comparison.expectedStartTime}–{comparison.expectedEndTime}</span>
                        {' · '}{formatShiftMinutes(comparison.expectedWorkMinutes)} de jornada
                        {' · '}{formatShiftMinutes(comparison.expectedBreakMinutes)} de intervalo
                      </p>
                    </div>
                  ))}
                  {shorterShiftComparisons(item, shiftDefinitions).length === 0 ? (
                    <p className="text-xs text-ds-ink-muted">Nenhum turno permitido termina antes do expediente esperado.</p>
                  ) : null}
                </div>
              ) : null}
            </PanelSection>
            <PanelSection title="Aplicação">
              <PanelField label="Abrangência">{applicabilityLabel(item.applicability, { unitNames, unitGroupNames: groupNames, unitOrganizationNames: organizationNames })}</PanelField>
              <PanelField label="Turnos permitidos">
                {item.allowedShiftDefinitionIds?.length
                  ? item.allowedShiftDefinitionIds.map((id) => shiftDefinitions.find((shift) => shift.id === id)?.name ?? id).join(', ')
                  : 'Todos os turnos existentes'}
              </PanelField>
            </PanelSection>
            {saveError ? <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{saveError}</p> : null}
            <div className="mt-auto space-y-3 border-t border-ds-divider pt-4">
              {item.status === 'draft' ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="ds-secondary" size="md" onClick={() => setPanel({ mode: 'edit', item })}>Editar rascunho</Button>
                  <Button type="button" variant="primary-modal" size="md" loading={saving} onClick={() => void transition('publish')}>Publicar jornada</Button>
                </div>
              ) : item.status === 'published' ? (
                <>
                  <Button type="button" variant="primary-modal" size="md" onClick={() => setPanel({ mode: 'create', supersedes: item })}>Criar nova versão</Button>
                  {confirmingArchive ? (
                    <InlineConfirm message={`Arquivar a jornada “${item.name}”?`} loading={saving} returnFocusRef={archiveTriggerRef} onCancel={() => setConfirmingArchive(false)} onConfirm={() => void transition('archive')} />
                  ) : (
                    <Button ref={archiveTriggerRef} type="button" variant="danger-link" size="xs" onClick={() => setConfirmingArchive(true)}>Arquivar jornada</Button>
                  )}
                </>
              ) : null}
            </div>
          </>
        ) : null}

        {panel && editing ? (
          <form className="flex flex-1 flex-col gap-5" onSubmit={(event) => { event.preventDefault(); void saveJourney(); }} noValidate>
            <Field label="Nome" htmlFor="journey-name">
              <Input id="journey-name" className={fieldInputClass} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Jornada lojas 44h" />
            </Field>
            <Field label="Descrição" htmlFor="journey-description" requirement="opcional">
              <textarea id="journey-description" className={`${fieldInputClass} min-h-20 py-2`} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Carga semanal" htmlFor="journey-weekly" hint="Use HH:MM. Ex.: 44:00.">
                <Input
                  id="journey-weekly"
                  inputMode="numeric"
                  maxLength={6}
                  className={`${fieldInputClass} font-ds-mono`}
                  value={form.weeklyLoad}
                  onChange={(event) => setForm((current) => ({ ...current, weeklyLoad: maskDurationInput(event.target.value) }))}
                  placeholder="44:00"
                />
              </Field>
              <Field label="Dias no ciclo" htmlFor="journey-cycle" hint="De 1 a 42 dias.">
                <Input
                  id="journey-cycle"
                  inputMode="numeric"
                  maxLength={2}
                  className={fieldInputClass}
                  value={form.cycleLengthDays}
                  onChange={(event) => {
                    const cycleLengthDays = event.target.value.replace(/\D/g, '').slice(0, 2);
                    setForm((current) => ({ ...current, cycleLengthDays }));
                  }}
                  placeholder="Ex.: 7"
                />
              </Field>
            </div>
            <div className="flex items-center gap-2 rounded-ds-btn border border-ds-border bg-ds-muted px-3.5 py-3 text-[12.5px] text-ds-ink-2">
              <span>Carga mensal de referência:</span>
              <strong className="font-ds-mono text-ds-ink">
                {formatDuration(monthlyWorkloadMinutes(parseDuration(form.weeklyLoad) ?? 0))}
              </strong>
              <InfoTooltip title="Como a carga mensal é calculada">
                <p>A referência mensal corresponde à carga semanal multiplicada por 5.</p>
                <p>Exemplo: 44:00 por semana resulta em 220:00 por mês.</p>
              </InfoTooltip>
            </div>
            <PanelSection
              title="Forma de apuração"
              aside={(
                <InfoTooltip title="Como o regime é aplicado">
                  <p>O regime fica salvo nesta versão da jornada e não altera o nome nem o ID dos turnos no Bizneo.</p>
                  <p>As regras Fixa e Flexível serão usadas pelo motor de ponto do Coala One quando ele for ativado.</p>
                </InfoTooltip>
              )}
            >
              <div className="grid gap-2" role="radiogroup" aria-label="Regime da jornada">
                {regimeOptions.map((option) => {
                  const selected = form.regimeMode === option.mode;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setForm((current) => ({ ...current, regimeMode: option.mode }))}
                      className={`rounded-ds-btn border px-3.5 py-3 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2 ${selected ? 'border-ds-modal bg-ds-modal-soft text-ds-modal-ink' : 'border-ds-border-input bg-white text-ds-ink-2'}`}
                    >
                      <span className="block text-sm font-extrabold">{option.label}</span>
                      <span className="mt-0.5 block text-xs font-medium text-ds-ink-muted">{option.description}</span>
                    </button>
                  );
                })}
              </div>
              {form.regimeMode === 'flexible' ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Início da janela" htmlFor="journey-flexible-window-start" requirement="opcional" hint="Se preenchido, informe também o fim.">
                    <Input
                      id="journey-flexible-window-start"
                      type="time"
                      className={fieldInputClass}
                      value={form.flexibleWindowStart}
                      onChange={(event) => setForm((current) => ({ ...current, flexibleWindowStart: event.target.value }))}
                    />
                  </Field>
                  <Field label="Fim da janela" htmlFor="journey-flexible-window-end" requirement="opcional">
                    <Input
                      id="journey-flexible-window-end"
                      type="time"
                      className={fieldInputClass}
                      value={form.flexibleWindowEnd}
                      onChange={(event) => setForm((current) => ({ ...current, flexibleWindowEnd: event.target.value }))}
                    />
                  </Field>
                </div>
              ) : null}
              <p className="text-xs text-ds-ink-muted">
                {journeyRegimeDescription(
                  form.regimeMode === 'flexible'
                    ? { mode: 'flexible', windowStart: form.flexibleWindowStart || undefined, windowEnd: form.flexibleWindowEnd || undefined }
                    : { mode: form.regimeMode },
                )}
              </p>
            </PanelSection>
            <PanelSection
              title="Expediente definido menor que o esperado"
              aside={(
                <InfoTooltip title="Como funciona">
                  <p>O expediente esperado é projetado com a carga diária da jornada a partir do início do turno.</p>
                  <p>Quando esta opção está ativa, o horário e o intervalo cadastrados no turno são os que o colaborador executa.</p>
                </InfoTooltip>
              )}
            >
              <div className="flex items-center justify-between gap-4 rounded-ds-btn border border-ds-border-input bg-white px-3.5 py-3">
                <div>
                  <p className="text-sm font-extrabold text-ds-ink">Usar o expediente definido no turno</p>
                  <p className="mt-0.5 text-xs text-ds-ink-muted">Autoriza um turno a terminar antes da saída esperada pela jornada.</p>
                </div>
                <Switch
                  aria-label="Usar expediente definido quando for menor que o esperado"
                  checked={form.useDefinedShiftWhenShorter}
                  onCheckedChange={(useDefinedShiftWhenShorter) => setForm((current) => ({ ...current, useDefinedShiftWhenShorter }))}
                />
              </div>
              <Field label="Intervalo do expediente esperado" htmlFor="journey-expected-break" hint="Em minutos; usado para projetar a hora esperada de saída.">
                <Input
                  id="journey-expected-break"
                  type="number"
                  min={0}
                  max={480}
                  className={fieldInputClass}
                  value={form.expectedBreakMinutes}
                  onChange={(event) => setForm((current) => ({ ...current, expectedBreakMinutes: event.target.value }))}
                />
              </Field>
              {form.useDefinedShiftWhenShorter ? (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-ds-ink-2">Comparativo dos turnos menores</p>
                  {draftComparisonRows.map(({ shift, comparison }) => (
                    <div key={`${shift.id}:${comparison.expectedWorkMinutes}`} className="rounded-ds-md border border-ds-divider bg-ds-surface px-3 py-2.5 text-xs">
                      <p className="font-extrabold text-ds-ink">{shift.name}</p>
                      <p className="mt-1 text-ds-ink-muted">
                        Definido: <span className="font-ds-mono font-bold text-ds-ink">{shift.startTime}–{shift.endTime}</span>
                        {' · '}{formatShiftMinutes(comparison.defined.workedMinutes)} trabalhadas
                        {' · '}{formatShiftMinutes(comparison.defined.breakMinutes)} de intervalo
                      </p>
                      <p className="mt-0.5 text-ds-ink-muted">
                        Esperado: <span className="font-ds-mono font-bold text-ds-ink">{comparison.expectedStartTime}–{comparison.expectedEndTime}</span>
                        {' · '}{formatShiftMinutes(comparison.expectedWorkMinutes)} de jornada
                        {' · '}{formatShiftMinutes(comparison.expectedBreakMinutes)} de intervalo
                      </p>
                    </div>
                  ))}
                  {draftComparisonRows.length === 0 ? (
                    <p className="rounded-ds-md border border-dashed border-ds-divider px-3 py-3 text-xs text-ds-ink-muted">Nenhum turno permitido termina antes do expediente esperado.</p>
                  ) : null}
                </div>
              ) : null}
            </PanelSection>
            <PanelSection
              title="Descanso semanal remunerado"
              aside={(
                <InfoTooltip title="Como a folga é posicionada">
                  <p>Na posição fixa, o descanso acompanha o dia zerado deste ciclo.</p>
                  <p>Definido na escala permite antecipar a folga. O sistema reinicia a contagem no dia escolhido e valida a sequência entre meses e unidades.</p>
                </InfoTooltip>
              )}
            >
              <div className="grid gap-2" role="radiogroup" aria-label="Posicionamento do descanso semanal">
                {([
                  { value: 'fixed_cycle', label: 'Posição fixa no ciclo', description: 'O dia marcado com 00:00 é o descanso previsto.' },
                  { value: 'schedule', label: 'Definido na escala', description: 'A escala escolhe a data real do DSR conforme a operação.' },
                ] as const).map((option) => {
                  const selected = form.weeklyRestPlacement === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setForm((current) => ({ ...current, weeklyRestPlacement: option.value }))}
                      className={`rounded-ds-btn border px-3.5 py-3 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2 ${selected ? 'border-ds-modal bg-ds-modal-soft text-ds-modal-ink' : 'border-ds-border-input bg-white text-ds-ink-2'}`}
                    >
                      <span className="block text-sm font-extrabold">{option.label}</span>
                      <span className="mt-0.5 block text-xs font-medium text-ds-ink-muted">{option.description}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Máximo de dias consecutivos" htmlFor="journey-rest-max" hint="De 1 a 6 dias.">
                  <Input
                    id="journey-rest-max"
                    inputMode="numeric"
                    maxLength={1}
                    className={fieldInputClass}
                    value={form.maxConsecutiveWorkDays}
                    onChange={(event) => setForm((current) => ({ ...current, maxConsecutiveWorkDays: event.target.value.replace(/\D/g, '').slice(0, 1) }))}
                  />
                </Field>
                <Field label="Domingo a cada" htmlFor="journey-rest-sunday" requirement="opcional" hint="Semanas; conforme CCT aplicável.">
                  <Input
                    id="journey-rest-sunday"
                    inputMode="numeric"
                    maxLength={2}
                    className={fieldInputClass}
                    value={form.sundayCadenceWeeks}
                    onChange={(event) => setForm((current) => ({ ...current, sundayCadenceWeeks: event.target.value.replace(/\D/g, '').slice(0, 2) }))}
                    placeholder="Ex.: 3"
                  />
                </Field>
              </div>
              {form.weeklyRestPlacement === 'schedule' ? (
                <p className="rounded-ds-md border border-ds-border bg-ds-info-bg px-3 py-2.5 text-xs font-semibold text-ds-info">
                  Os descansos em 00:00 abaixo definem a quantidade no ciclo. A data real será registrada como folga na escala.
                </p>
              ) : null}
              <div className="grid gap-2" role="radiogroup" aria-label="Validação da jornada na escala">
                {([
                  {
                    value: 'consecutive_days',
                    label: 'Validação automática',
                    description: 'Controla a sequência entre meses e unidades pelo máximo de dias consecutivos.',
                  },
                  {
                    value: 'manual_review',
                    label: 'Revisão manual',
                    description: 'Use em ciclos ainda não automatizados, como 12×36. O fechamento exigirá conferência.',
                  },
                ] as const).map((option) => {
                  const selected = form.scaleValidationMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setForm((current) => ({ ...current, scaleValidationMode: option.value }))}
                      className={`rounded-ds-btn border px-3.5 py-3 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2 ${selected ? 'border-ds-modal bg-ds-modal-soft text-ds-modal-ink' : 'border-ds-border-input bg-white text-ds-ink-2'}`}
                    >
                      <span className="block text-sm font-extrabold">{option.label}</span>
                      <span className="mt-0.5 block text-xs font-medium text-ds-ink-muted">{option.description}</span>
                    </button>
                  );
                })}
              </div>
            </PanelSection>
            <Field label="Distribuição do ciclo" hint={form.weeklyRestPlacement === 'schedule' ? 'A soma precisa equivaler à carga semanal. 00:00 representa um DSR móvel.' : 'A soma precisa equivaler à carga semanal. 00:00 marca descanso fixo.'}>
              {editingCycleLengthDays ? (
                <div className="grid grid-cols-2 gap-2">
                {Array.from(
                  { length: editingCycleLengthDays },
                  (_, index) => form.dayDurations[index] ?? '00:00',
                ).map((duration, index, durations) => {
                  const parsedDay = { dayIndex: index + 1, plannedMinutes: parseDuration(duration) ?? 0, isRestDay: (parseDuration(duration) ?? 0) === 0 };
                  const preceding = durations.slice(0, index + 1).map((value, dayIndex) => ({ dayIndex: dayIndex + 1, plannedMinutes: parseDuration(value) ?? 0, isRestDay: (parseDuration(value) ?? 0) === 0 }));
                  return (
                  <label key={index} className="flex items-center gap-2 rounded-ds-md border border-ds-divider bg-ds-surface px-2.5 py-2 text-xs font-bold text-ds-ink-2">
                    <span className="min-w-16">{journeyDistributionLabel(
                      parsedDay,
                      editingCycleLengthDays,
                      { placement: form.weeklyRestPlacement, maxConsecutiveWorkDays: Number(form.maxConsecutiveWorkDays) || 6 },
                      preceding.filter((day) => !day.isRestDay).length,
                      preceding.filter((day) => day.isRestDay).length,
                    )}</span>
                    <Input
                      aria-label={`Duração do dia ${index + 1}`}
                      className={`${fieldInputClass} h-8 font-ds-mono`}
                      value={duration}
                      onChange={(event) => setForm((current) => {
                        const dayDurations = Array.from(
                          { length: Math.max(current.dayDurations.length, index + 1) },
                          (_, dayIndex) => dayIndex === index
                            ? maskDurationInput(event.target.value)
                            : current.dayDurations[dayIndex] ?? '00:00',
                        );
                        return { ...current, dayDurations };
                      })}
                    />
                  </label>
                  );
                })}
                </div>
              ) : (
                <p className="rounded-ds-md border border-dashed border-ds-divider px-3 py-4 text-sm text-ds-ink-muted">
                  Informe os dias no ciclo para configurar a distribuição.
                </p>
              )}
            </Field>
            <Field label="Turnos permitidos" requirement="opcional" hint="Selecione turnos já existentes. Eles não são duplicados e mantêm nome e ID do Bizneo.">
              <MultiSelect
                options={shiftDefinitions
                  .filter((shift) => shift.isArchived !== true || form.allowedShiftDefinitionIds.includes(shift.id))
                  .map((shift) => ({
                    value: shift.id,
                    label: `${shift.name} · ${shift.startTime}–${shift.endTime}${shift.isArchived ? ' · arquivado' : ''}`,
                  }))}
                selected={form.allowedShiftDefinitionIds}
                onChange={(allowedShiftDefinitionIds) => setForm((current) => ({ ...current, allowedShiftDefinitionIds }))}
                placeholder="Todos os turnos existentes"
              />
            </Field>
            <PanelSection title="Abrangência">
              <DPTimeApplicabilityFields
                value={form.applicability}
                onChange={(applicability) => setForm((current) => ({ ...current, applicability }))}
                units={activeOperationalUnits(units)}
                unitOrganizations={activeOperationalUnits(unitOrganizations)}
                unitGroups={unitGroups}
                roles={roles}
                functions={functions}
                people={activeUsers}
              />
            </PanelSection>
            <PanelSection title="Vigência">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Início" htmlFor="journey-valid-from">
                  <Input id="journey-valid-from" type="date" className={fieldInputClass} value={form.validFrom} onChange={(event) => setForm((current) => ({ ...current, validFrom: event.target.value }))} />
                </Field>
                <Field label="Fim" htmlFor="journey-valid-to" requirement="opcional" hint="Sem fim, permanece vigente.">
                  <Input id="journey-valid-to" type="date" className={fieldInputClass} value={form.validTo} onChange={(event) => setForm((current) => ({ ...current, validTo: event.target.value }))} />
                </Field>
              </div>
            </PanelSection>
            {saveError ? <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{saveError}</p> : null}
            <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
              <Button type="button" variant="ds-secondary" size="md" disabled={saving} onClick={() => item ? setPanel({ mode: 'view', item }) : setPanel(null)}>Cancelar</Button>
              <Button type="submit" variant="primary-modal" size="md" loading={saving}>{panel.mode === 'edit' ? 'Salvar rascunho' : 'Criar rascunho'}</Button>
            </div>
          </form>
        ) : null}
      </SidePanel>
    </div>
  );
}
