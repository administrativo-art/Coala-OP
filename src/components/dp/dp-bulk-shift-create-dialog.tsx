"use client";

import React from 'react';

import type { DPShift, DPShiftDefinition } from '@/types';
import type { BulkWorkShiftInput } from '@/features/dp/shifts/schemas';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';

type PersonOption = { id: string; name: string };
type DateOption = { date: string; label: string; dowLabel: string };

interface DPBulkShiftCreatePanelProps {
  people: PersonOption[];
  dates: DateOption[];
  shiftDefinitions: DPShiftDefinition[];
  existingShifts: Pick<DPShift, 'userId' | 'date'>[];
  dayOffDatesByUser?: Map<string, Set<string>>;
  vacationDatesByUser?: Map<string, Set<string>>;
  siblingOccupied?: Map<string, Set<string>>;
  applyShiftsBatch: (input: BulkWorkShiftInput) => Promise<void>;
  onApplied: () => void;
  onCancel: () => void;
}

type PreviewReason = 'already_filled' | 'day_off' | 'vacation' | 'cross_unit_conflict';

function selectionKey(userId: string, date: string) {
  return `${userId}::${date}`;
}

function formatDate(date: string) {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}

export function DPBulkShiftCreatePanel({
  people,
  dates,
  shiftDefinitions,
  existingShifts,
  dayOffDatesByUser,
  vacationDatesByUser,
  siblingOccupied,
  applyShiftsBatch,
  onApplied,
  onCancel,
}: DPBulkShiftCreatePanelProps) {
  const { toast } = useToast();
  const [selectedUserIds, setSelectedUserIds] = React.useState<Set<string>>(() => new Set());
  const [selectedDates, setSelectedDates] = React.useState<Set<string>>(() => new Set());
  const [shiftDefinitionId, setShiftDefinitionId] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const existingKeys = React.useMemo(
    () => new Set(existingShifts.map((shift) => selectionKey(shift.userId, shift.date))),
    [existingShifts],
  );
  const selectedDefinition = shiftDefinitions.find((definition) => definition.id === shiftDefinitionId);
  const entries = React.useMemo(
    () => Array.from(selectedUserIds).flatMap((userId) => Array.from(selectedDates).map((date) => ({ userId, date }))),
    [selectedDates, selectedUserIds],
  );
  const preview = React.useMemo(() => {
    const reasons = new Map<PreviewReason, number>();
    let creatable = 0;
    entries.forEach(({ userId, date }) => {
      let reason: PreviewReason | null = null;
      if (existingKeys.has(selectionKey(userId, date))) reason = 'already_filled';
      else if (dayOffDatesByUser?.get(userId)?.has(date)) reason = 'day_off';
      else if (vacationDatesByUser?.get(userId)?.has(date)) reason = 'vacation';
      else if (siblingOccupied?.get(userId)?.has(date)) reason = 'cross_unit_conflict';
      if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      else creatable += 1;
    });
    return { creatable, reasons };
  }, [dayOffDatesByUser, entries, existingKeys, siblingOccupied, vacationDatesByUser]);

  const toggle = (current: Set<string>, value: string) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const selectAllPeople = () => setSelectedUserIds(new Set(people.map((person) => person.id)));
  const selectAllDates = () => setSelectedDates(new Set(dates.map((item) => item.date)));
  const selectWeekdays = () => setSelectedDates(new Set(dates.filter((item) => !['Sáb', 'Dom'].includes(item.dowLabel)).map((item) => item.date)));

  async function handleApply() {
    if (!shiftDefinitionId || !selectedDefinition) {
      toast({ title: 'Escolha o turno que será aplicado.', variant: 'destructive' });
      return;
    }
    if (selectedUserIds.size === 0 || selectedDates.size === 0) {
      toast({ title: 'Selecione ao menos uma colaboradora e um dia.', variant: 'destructive' });
      return;
    }
    if (entries.length > 200) {
      toast({ title: 'A seleção excede o limite de 200 turnos por operação.', variant: 'destructive' });
      return;
    }
    if (preview.creatable === 0) {
      toast({ title: 'Não há dias vazios para preencher.', description: 'Revise os conflitos exibidos antes de tentar novamente.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const input: BulkWorkShiftInput = {
        action: 'create',
        shiftDefinitionId: selectedDefinition.id,
        startTime: selectedDefinition.startTime,
        endTime: selectedDefinition.endTime,
        entries: entries.filter(({ userId, date }) => (
          !existingKeys.has(selectionKey(userId, date))
          && !dayOffDatesByUser?.get(userId)?.has(date)
          && !vacationDatesByUser?.get(userId)?.has(date)
        )),
      };
      await applyShiftsBatch(input);
      toast({
        title: `${preview.creatable} turno${preview.creatable === 1 ? '' : 's'} adicionado${preview.creatable === 1 ? '' : 's'}.`,
        description: preview.reasons.size > 0 ? 'Os dias com conflito foram preservados.' : undefined,
      });
      onApplied();
    } catch (error) {
      toast({
        title: 'Não foi possível preencher a escala.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="flex max-h-[90vh] min-h-0 flex-col overflow-hidden rounded-lg bg-white">
      <div className="flex shrink-0 items-start gap-2 border-b border-[#eef1f6] px-[14px] py-[13px]">
        <div className="min-w-0">
          <div className="text-[13.5px] font-black leading-4 text-[#0f172a]">Preencher em lote</div>
          <p className="mt-0.5 text-[11.5px] font-semibold leading-4 text-[#94a3b8]">Cria turnos somente nos dias vazios.</p>
        </div>
        <button type="button" onClick={onCancel} aria-label="Fechar preenchimento em lote" className="ml-auto grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg text-[#94a3b8] hover:bg-[#f6f8fb]">×</button>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-[14px]">
        <section>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11.5px] font-extrabold text-[#334155]">Colaboradoras</p>
            <button type="button" onClick={selectAllPeople} className="text-[10.5px] font-extrabold text-[#2563eb] hover:underline">Selecionar todas</button>
          </div>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-[10px] border border-[#e3e9f1] p-2">
            {people.map((person) => (
              <label key={person.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold text-[#334155] hover:bg-[#f8fafc]">
                <Checkbox checked={selectedUserIds.has(person.id)} onCheckedChange={() => setSelectedUserIds((current) => toggle(current, person.id))} />
                <span className="truncate">{person.name}</span>
              </label>
            ))}
            {people.length === 0 ? <p className="px-2 py-2 text-[11px] text-[#94a3b8]">Nenhuma colaboradora disponível.</p> : null}
          </div>
        </section>

        <section className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11.5px] font-extrabold text-[#334155]">Dias</p>
            <div className="flex gap-2 text-[10.5px] font-extrabold text-[#2563eb]">
              <button type="button" onClick={selectWeekdays} className="hover:underline">Dias úteis</button>
              <button type="button" onClick={selectAllDates} className="hover:underline">Todos</button>
              <button type="button" onClick={() => setSelectedDates(new Set())} className="text-[#64748b] hover:underline">Limpar</button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5 rounded-[10px] border border-[#e3e9f1] p-2">
            {dates.map((item) => (
              <label key={item.date} className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[10.5px] font-bold text-[#475569] hover:bg-[#f8fafc]">
                <Checkbox checked={selectedDates.has(item.date)} onCheckedChange={() => setSelectedDates((current) => toggle(current, item.date))} />
                <span>{item.dowLabel} {formatDate(item.date)}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="mt-4">
          <p className="text-[11.5px] font-extrabold text-[#334155]">Turno</p>
          <select value={shiftDefinitionId} onChange={(event) => setShiftDefinitionId(event.target.value)} className="mt-2 h-9 w-full rounded-[9px] border border-[#e3e9f1] bg-white px-2.5 text-xs font-bold text-[#334155]">
            <option value="">Selecione o turno</option>
            {shiftDefinitions.filter((definition) => !definition.isArchived).map((definition) => (
              <option key={definition.id} value={definition.id}>{definition.name} · {definition.startTime}–{definition.endTime}</option>
            ))}
          </select>
          {selectedDefinition ? <p className="mt-1.5 text-[10.5px] font-semibold text-[#64748b]">Horário definido pelo cadastro do turno e não editável aqui.</p> : null}
        </section>

        <section className="mt-4 rounded-[10px] border border-[#e3e9f1] bg-[#f8fafc] p-3 text-[11px] font-semibold text-[#475569]">
          <p><strong className="text-[#0f172a]">{preview.creatable}</strong> turno{preview.creatable === 1 ? '' : 's'} será{preview.creatable === 1 ? '' : 'ão'} criado{preview.creatable === 1 ? '' : 's'}.</p>
          {preview.reasons.get('already_filled') ? <p>Já preenchidos: {preview.reasons.get('already_filled')}</p> : null}
          {preview.reasons.get('day_off') ? <p>Com DSR: {preview.reasons.get('day_off')}</p> : null}
          {preview.reasons.get('vacation') ? <p>Em férias: {preview.reasons.get('vacation')}</p> : null}
          {preview.reasons.get('cross_unit_conflict') ? <p>Conflito em outra unidade: {preview.reasons.get('cross_unit_conflict')} (será sinalizado).</p> : null}
          {entries.length > 200 ? <p className="font-extrabold text-[#be123c]">Limite excedido: reduza a seleção para até 200 turnos.</p> : null}
        </section>
      </div>

      <div className="flex shrink-0 gap-2 border-t border-[#eef1f6] p-[14px]">
        <button type="button" onClick={onCancel} className="h-9 flex-1 rounded-[9px] border border-[#e3e9f1] text-xs font-extrabold text-[#64748b] hover:bg-[#f8fafc]">Cancelar</button>
        <button type="button" onClick={() => void handleApply()} disabled={submitting || preview.creatable === 0 || entries.length > 200} className="h-9 flex-1 rounded-[9px] bg-[#db2777] text-xs font-extrabold text-white hover:bg-[#be185d] disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Adicionando…' : 'Adicionar turnos'}</button>
      </div>
    </section>
  );
}
