"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
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
import type { DPCalendar } from '@/types';

const currentYear = new Date().getFullYear();
const ROW_TEMPLATE = 'minmax(240px,1.6fr) 90px 130px 16px';

const calendarSchema = z.object({
  name: z.string().min(1, 'Informe o nome do calendário.'),
  year: z.coerce.number().min(2020, 'Informe um ano a partir de 2020.'),
  state: z.string().optional(),
  city: z.string().optional(),
});

type CalendarForm = z.infer<typeof calendarSchema>;

function formValuesFor(calendar?: DPCalendar | null): CalendarForm {
  return {
    name: calendar?.name ?? '',
    year: calendar?.year ?? currentYear,
    state: calendar?.state ?? '',
    city: calendar?.city ?? '',
  };
}

function locationLabel(calendar: DPCalendar) {
  return [calendar.state, calendar.city].filter(Boolean).join(' · ') || 'Nacional';
}

type PanelState = { mode: 'view'; calendar: DPCalendar } | { mode: 'edit'; calendar: DPCalendar } | { mode: 'create' };

export function DPSettingsCalendars({ onSelect }: { onSelect?: (id: string) => void } = {}) {
  const { calendars, calendarsLoading, calendarsError, deleteCalendar, addCalendar, updateCalendar } = useDP();
  const router = useRouter();

  const [panel, setPanel] = useState<PanelState | null>(null);
  const [search, setSearch] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);

  const form = useForm<CalendarForm>({ resolver: zodResolver(calendarSchema), defaultValues: formValuesFor(null) });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  const editing = panel?.mode === 'edit' || panel?.mode === 'create';
  const calendar = panel && panel.mode !== 'create' ? panel.calendar : null;

  useEffect(() => {
    setConfirmingDelete(false);
    setSaveError(null);
    if (panel?.mode === 'edit') reset(formValuesFor(panel.calendar));
    if (panel?.mode === 'create') reset(formValuesFor(null));
    // O formulário reinicia só quando o painel muda de calendário ou de modo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  const openHolidays = (id: string) => {
    if (onSelect) onSelect(id);
    else router.push(`/dashboard/dp/settings/calendars/${id}`);
  };

  const sections = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    const map = new Map<string, { label: string; items: DPCalendar[] }>();
    [...calendars]
      .sort((a, b) => b.year - a.year)
      .filter((item) => !term || `${item.name} ${item.year} ${locationLabel(item)}`.toLocaleLowerCase('pt-BR').includes(term))
      .forEach((item) => {
        const key = [item.state || '—', item.city || '—'].join('::');
        if (!map.has(key)) map.set(key, { label: locationLabel(item), items: [] });
        map.get(key)!.items.push(item);
      });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  }, [calendars, search]);
  const visibleCount = sections.reduce((total, section) => total + section.items.length, 0);

  async function onSubmit(values: CalendarForm) {
    setSaveError(null);
    try {
      const data = { ...values, state: values.state || undefined, city: values.city || undefined };
      if (panel?.mode === 'edit') {
        await updateCalendar({ ...panel.calendar, ...data });
        setPanel(null);
      } else {
        const id = await addCalendar(data);
        setPanel(null);
        openHolidays(id);
      }
    } catch {
      setSaveError('Não foi possível salvar o calendário. Tente novamente.');
    }
  }

  async function confirmDelete() {
    if (!calendar) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await deleteCalendar(calendar.id);
      setPanel(null);
    } catch {
      setConfirmingDelete(false);
      setSaveError('Não foi possível excluir o calendário. Tente novamente.');
    } finally {
      setDeleting(false);
    }
  }

  if (calendarsLoading && calendars.length === 0) {
    return (
      <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Carregando calendários">
        <ListSkeleton rows={5} />
      </div>
    );
  }
  if (calendarsError && calendars.length === 0) {
    return <p role="alert" className="text-sm font-semibold text-ds-danger">Erro ao carregar calendários: {calendarsError}</p>;
  }

  return (
    <div className="space-y-5">
      <ControlPanel className="flex flex-col gap-4 px-[26px] pb-5 pt-[22px]">
        <div>
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Calendários de trabalho</p>
          <p className="mt-1 font-ds-mono text-[44px] font-bold leading-none tracking-[-0.05em]">{calendars.length}</p>
          <p className="mt-1 text-base font-extrabold">Calendários de feriados</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ControlSearch value={search} onChange={setSearch} placeholder="Buscar calendário, ano, UF ou cidade" />
          <Button type="button" variant="primary-page" size="xl" onClick={() => setPanel({ mode: 'create' })}>
            + Novo calendário
          </Button>
        </div>
      </ControlPanel>

      <div className="flex items-baseline gap-2.5">
        <span className="text-[28px] font-extrabold tracking-[-0.03em]">{visibleCount}</span>
        <span className="text-[13px] text-ds-ink-faint">de {calendars.length} calendários</span>
      </div>

      <ListShell minWidth={620}>
        <ListHead template={ROW_TEMPLATE}>
          <span>Calendário</span>
          <span>Ano</span>
          <span>Feriados</span>
          <span />
        </ListHead>
        {sections.map((section) => (
          <React.Fragment key={section.label}>
            <div data-ui="list-band" className="flex items-center justify-between gap-3 border-b border-ds-divider bg-ds-muted px-5 py-2.5">
              <span className="text-[13px] font-extrabold">{section.label}</span>
              <span className="text-xs text-ds-ink-faint">{section.items.length} {section.items.length === 1 ? 'calendário' : 'calendários'}</span>
            </div>
            {section.items.map((item) => (
              <ListRow
                key={item.id}
                template={ROW_TEMPLATE}
                isOpen={calendar?.id === item.id}
                isSelected={false}
                isMuted={false}
                onOpen={() => setPanel({ mode: 'view', calendar: item })}
                label={`Abrir calendário ${item.name}`}
              >
                <p className="truncate text-[13.5px] font-bold">{item.name}</p>
                <span className="font-ds-mono text-[13px] font-semibold">{item.year}</span>
                <span className="text-xs text-ds-ink-muted">{item.holidayCount ?? 0} {(item.holidayCount ?? 0) === 1 ? 'feriado' : 'feriados'}</span>
                <Chevron />
              </ListRow>
            ))}
          </React.Fragment>
        ))}
        {calendars.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhum calendário cadastrado. Crie o primeiro com “Novo calendário”.</p>
        ) : visibleCount === 0 ? (
          <EmptyResults title="Nenhum calendário encontrado com essa busca." onClear={() => setSearch('')} />
        ) : null}
      </ListShell>

      <SidePanel
        open={!!panel}
        onOpenChange={(open) => { if (!open) setPanel(null); }}
        kicker={panel?.mode === 'create' ? 'Novo calendário' : panel?.mode === 'edit' ? 'Editar calendário' : 'Calendário'}
        title={panel?.mode === 'create' ? 'Sem nome' : (calendar?.name ?? '')}
        subtitle="Nome, ano e localização do calendário de feriados."
      >
        {panel && !editing && calendar ? (
          <>
            <PanelSection title="Dados">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <PanelField label="Ano"><span className="font-ds-mono">{calendar.year}</span></PanelField>
                <PanelField label="Feriados">{calendar.holidayCount ?? 0}</PanelField>
                <PanelField label="Localização">{locationLabel(calendar)}</PanelField>
              </div>
            </PanelSection>
            {saveError ? <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{saveError}</p> : null}
            <div className="mt-auto flex flex-col gap-3 border-t border-ds-divider pt-4">
              {confirmingDelete ? (
                <InlineConfirm
                  message={`Excluir o calendário “${calendar.name}” e todos os seus feriados?`}
                  loading={deleting}
                  returnFocusRef={deleteTriggerRef}
                  onCancel={() => setConfirmingDelete(false)}
                  onConfirm={() => void confirmDelete()}
                />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="primary-modal" size="md" onClick={() => openHolidays(calendar.id)}>Gerenciar feriados</Button>
                    <Button type="button" variant="ds-secondary" size="md" onClick={() => setPanel({ mode: 'edit', calendar })}>Editar calendário</Button>
                  </div>
                  <div>
                    <Button ref={deleteTriggerRef} type="button" variant="danger-link" size="xs" onClick={() => setConfirmingDelete(true)}>Excluir calendário</Button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}

        {panel && editing ? (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col gap-5" noValidate>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Nome" htmlFor="calendar-name" error={errors.name?.message} className="col-span-2">
                <Input id="calendar-name" placeholder="Ex.: Nacional 2026" aria-invalid={!!errors.name} className={fieldInputClass} {...register('name')} />
              </Field>
              <Field label="Ano" htmlFor="calendar-year" error={errors.year?.message}>
                <Input id="calendar-year" type="number" aria-invalid={!!errors.year} className={fieldInputClass} {...register('year')} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="UF" htmlFor="calendar-state" requirement="opcional">
                <Input id="calendar-state" placeholder="Ex.: MA" maxLength={2} className={fieldInputClass} {...register('state')} />
              </Field>
              <Field label="Cidade" htmlFor="calendar-city" requirement="opcional">
                <Input id="calendar-city" placeholder="Ex.: São Luís" className={fieldInputClass} {...register('city')} />
              </Field>
            </div>
            {saveError ? <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{saveError}</p> : null}
            <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
              <Button type="button" variant="ds-secondary" size="md" disabled={isSubmitting} onClick={() => (calendar ? setPanel({ mode: 'view', calendar }) : setPanel(null))}>Cancelar</Button>
              <Button type="submit" variant="primary-modal" size="md" loading={isSubmitting}>
                {panel.mode === 'create' ? 'Criar e adicionar feriados' : 'Salvar calendário'}
              </Button>
            </div>
          </form>
        ) : null}
      </SidePanel>
    </div>
  );
}
