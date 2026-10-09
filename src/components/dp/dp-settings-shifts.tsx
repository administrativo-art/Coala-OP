"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Chevron, EmptyResults, ListHead, ListRow, ListShell, ListSkeleton } from '@/components/cadastros/cadastros-ui';
import { useDP } from '@/components/dp-context';
import { ControlPanel, ControlSearch } from '@/components/patterns/control-panel';
import { Field, fieldInputClass } from '@/components/patterns/field';
import { InlineConfirm } from '@/components/patterns/inline-confirm';
import { PanelField, PanelSection, SidePanel } from '@/components/patterns/side-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { StatusPill } from '@/components/ui/status-pill';
import { getShiftDefinitionUnitIds, getShiftDefinitionUnitNames } from '@/lib/dp-shift-definitions';
import { activeOperationalUnits } from '@/lib/dp-units';
import { cn } from '@/lib/utils';
import type { DPShiftDefinition } from '@/types';

const DOW_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ROW_TEMPLATE = 'minmax(230px,1.5fr) 130px minmax(190px,1.2fr) minmax(190px,1.3fr) 16px';

/** Período do dia deduzido do nome, só para rotular a linha. */
function shiftPeriodLabel(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes('intermedi')) return 'Intermediário';
  if (normalized.includes('manhã') || normalized.includes('manha')) return 'Manhã';
  if (normalized.includes('tarde')) return 'Tarde';
  if (normalized.includes('noite')) return 'Noite';
  return null;
}

function getDisplayCode(def: DPShiftDefinition) {
  const raw = String(def.code ?? '').trim();
  if (!raw) return '—';
  return /^\d+$/.test(raw) ? `#${raw}` : raw;
}

const shiftDefSchema = z.object({
  code: z.string().min(1, 'Informe o código.').max(10, 'Use até 10 caracteres.'),
  name: z.string().min(1, 'Informe o nome.'),
  startTime: z.string().min(1, 'Informe o horário de início.'),
  endTime: z.string().min(1, 'Informe o horário de fim.'),
  breakStart: z.string().optional(),
  breakEnd: z.string().optional(),
  unitIds: z.array(z.string()).optional(),
  daysOfWeek: z.array(z.number()).min(1, 'Selecione ao menos um dia.'),
  bizneoTemplateId: z.string().optional(),
});

type ShiftDefForm = z.infer<typeof shiftDefSchema>;

function formValuesFor(def?: DPShiftDefinition | null): ShiftDefForm {
  return {
    code: def?.code ?? '',
    name: def?.name ?? '',
    startTime: def?.startTime ?? '',
    endTime: def?.endTime ?? '',
    breakStart: def?.breakStart ?? '',
    breakEnd: def?.breakEnd ?? '',
    unitIds: getShiftDefinitionUnitIds(def),
    daysOfWeek: def?.daysOfWeek ?? [1, 2, 3, 4, 5],
    bizneoTemplateId: def?.bizneoTemplateId ?? '',
  };
}

type PanelState = { mode: 'view'; def: DPShiftDefinition } | { mode: 'edit'; def: DPShiftDefinition } | { mode: 'create' };

export function DPSettingsShifts() {
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);

  const form = useForm<ShiftDefForm>({ resolver: zodResolver(shiftDefSchema), defaultValues: formValuesFor(null) });
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  const editing = panel?.mode === 'edit' || panel?.mode === 'create';
  const def = panel && panel.mode !== 'create' ? panel.def : null;

  useEffect(() => {
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

  const visibleDefinitions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    if (!term) return shiftDefinitions;
    return shiftDefinitions.filter((item) =>
      `${item.name} ${item.code ?? ''} ${resolveUnitLabels(item).join(' ')}`.toLocaleLowerCase('pt-BR').includes(term)
    );
    // resolveUnitLabels depende só de `units`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftDefinitions, search, units]);

  async function onSubmit(values: ShiftDefForm) {
    setSaveError(null);
    try {
      const selectedUnits = units.filter((unit) => (values.unitIds ?? []).includes(unit.id));
      const selectedUnitIds = selectedUnits.map((unit) => unit.id);
      const selectedUnitNames = selectedUnits.map((unit) => unit.name);
      const data = {
        ...values,
        unitIds: selectedUnitIds.length > 0 ? selectedUnitIds : undefined,
        unitNames: selectedUnitNames.length > 0 ? selectedUnitNames : undefined,
        unitId: selectedUnitIds[0],
        unitName: selectedUnitNames[0],
        bizneoTemplateId: values.bizneoTemplateId || undefined,
        breakStart: values.breakStart || undefined,
        breakEnd: values.breakEnd || undefined,
      };
      if (panel?.mode === 'edit') await updateShiftDefinition({ ...panel.def, ...data });
      else await addShiftDefinition(data);
      setPanel(null);
    } catch {
      setSaveError('Não foi possível salvar o turno. Tente novamente.');
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
      <ControlPanel className="flex flex-col gap-4 px-[26px] pb-5 pt-[22px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Turnos reutilizáveis</p>
            <p className="mt-1 text-[44px] font-bold leading-none tracking-[-0.05em] font-ds-mono">{shiftDefinitions.length}</p>
            <p className="mt-1 text-base font-extrabold">Definições de turno</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ControlSearch value={search} onChange={setSearch} placeholder="Buscar turno, código ou unidade" />
          <Button type="button" variant="primary-page" size="xl" onClick={() => setPanel({ mode: 'create' })}>
            + Novo turno
          </Button>
        </div>
      </ControlPanel>

      <div className="flex items-baseline gap-2.5">
        <span className="text-[28px] font-extrabold tracking-[-0.03em]">{visibleDefinitions.length}</span>
        <span className="text-[13px] text-ds-ink-faint">de {shiftDefinitions.length} turnos</span>
      </div>

      <ListShell minWidth={840}>
        <ListHead template={ROW_TEMPLATE}>
          <span>Turno</span>
          <span>Horário</span>
          <span>Dias</span>
          <span>Unidades</span>
          <span />
        </ListHead>
        {visibleDefinitions.map((item) => {
          const period = shiftPeriodLabel(item.name);
          const unitLabels = resolveUnitLabels(item);
          return (
            <ListRow
              key={item.id}
              template={ROW_TEMPLATE}
              isOpen={def?.id === item.id}
              isSelected={false}
              isMuted={false}
              onOpen={() => setPanel({ mode: 'view', def: item })}
              label={`Abrir turno ${item.name}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-ds-mono text-xs font-bold text-ds-ink-faint">{getDisplayCode(item)}</span>
                  {period ? <StatusPill variant="neutral">{period}</StatusPill> : null}
                </div>
                <p className="truncate text-[13.5px] font-bold">{item.name}</p>
              </div>
              <span className="font-ds-mono text-[13px] font-semibold">{item.startTime}–{item.endTime}</span>
              <span className="text-xs text-ds-ink-muted">{item.daysOfWeek.map((day) => DOW_LABELS[day]).join(' · ')}</span>
              <span className="truncate text-xs text-ds-ink-muted">{unitLabels.length > 0 ? unitLabels.join(', ') : 'Todas as unidades'}</span>
              <Chevron />
            </ListRow>
          );
        })}
        {shiftDefinitions.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhum turno cadastrado. Crie o primeiro com “Novo turno”.</p>
        ) : visibleDefinitions.length === 0 ? (
          <EmptyResults title="Nenhum turno encontrado com essa busca." onClear={() => setSearch('')} />
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
            <PanelSection title="Horário">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <PanelField label="Código"><span className="font-ds-mono">{getDisplayCode(def)}</span></PanelField>
                <PanelField label="Expediente"><span className="font-ds-mono">{def.startTime}–{def.endTime}</span></PanelField>
                <PanelField label="Intervalo">
                  {def.breakStart && def.breakEnd ? <span className="font-ds-mono">{def.breakStart}–{def.breakEnd}</span> : 'Sem intervalo'}
                </PanelField>
              </div>
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
              <PanelField label="Modelo no Bizneo">{def.bizneoTemplateId ? <span className="font-ds-mono">{def.bizneoTemplateId}</span> : 'Sem vínculo'}</PanelField>
            </PanelSection>
            {saveError ? <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{saveError}</p> : null}
            <div className="mt-auto flex flex-col gap-3 border-t border-ds-divider pt-4">
              {confirmingDelete ? (
                <InlineConfirm
                  message={`Excluir o turno “${def.name}”?`}
                  loading={deleting}
                  returnFocusRef={deleteTriggerRef}
                  onCancel={() => setConfirmingDelete(false)}
                  onConfirm={() => void confirmDelete()}
                />
              ) : (
                <>
                  <Button type="button" variant="primary-modal" size="md" onClick={() => setPanel({ mode: 'edit', def })}>Editar turno</Button>
                  <div>
                    <Button ref={deleteTriggerRef} type="button" variant="danger-link" size="xs" onClick={() => setConfirmingDelete(true)}>Excluir turno</Button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}

        {panel && editing ? (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col gap-5" noValidate>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Código" htmlFor="shift-code" error={errors.code?.message}>
                <Input id="shift-code" placeholder="Ex.: T1" aria-invalid={!!errors.code} className={cn(fieldInputClass, 'font-ds-mono')} {...register('code')} />
              </Field>
              <Field label="Nome" htmlFor="shift-name" error={errors.name?.message} className="col-span-2">
                <Input id="shift-name" placeholder="Ex.: Turno da manhã" aria-invalid={!!errors.name} className={fieldInputClass} {...register('name')} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Início" htmlFor="shift-start" error={errors.startTime?.message}>
                <Input id="shift-start" type="time" aria-invalid={!!errors.startTime} className={fieldInputClass} {...register('startTime')} />
              </Field>
              <Field label="Fim" htmlFor="shift-end" error={errors.endTime?.message}>
                <Input id="shift-end" type="time" aria-invalid={!!errors.endTime} className={fieldInputClass} {...register('endTime')} />
              </Field>
              <Field label="Início do intervalo" htmlFor="shift-break-start" requirement="opcional">
                <Input id="shift-break-start" type="time" className={fieldInputClass} {...register('breakStart')} />
              </Field>
              <Field label="Fim do intervalo" htmlFor="shift-break-end" requirement="opcional">
                <Input id="shift-break-end" type="time" className={fieldInputClass} {...register('breakEnd')} />
              </Field>
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
                            'h-10 min-w-[56px] rounded-ds-md px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2',
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
            <Field label="ID do modelo no Bizneo" htmlFor="shift-bizneo" requirement="opcional">
              <Input id="shift-bizneo" placeholder="Ex.: 15693788" className={cn(fieldInputClass, 'font-ds-mono')} {...register('bizneoTemplateId')} />
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
