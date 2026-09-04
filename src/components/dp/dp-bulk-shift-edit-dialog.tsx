"use client";

import React from 'react';

import type { DPShift, DPShiftDefinition } from '@/types';
import type { BulkWorkShiftInput } from '@/features/dp/shifts/schemas';
import { buildShiftStreakState, isWorkShift } from '@/lib/dp-shift-rules';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Trash2, Wand2, X } from 'lucide-react';

type BulkAction = 'replace' | 'clear';

type SelectedShiftItem = {
  shift: DPShift;
  userName: string;
  unitName: string;
};

interface BulkShiftEditPanelProps {
  selectedShifts: SelectedShiftItem[];
  allCurrentShifts: DPShift[];
  previousShifts: DPShift[];
  siblingShifts: DPShift[];
  shiftDefinitions: DPShiftDefinition[];
  /** Colaboradoras disponíveis para reatribuição em lote. */
  people?: { id: string; name: string }[];
  /** userId → datas (YYYY-MM-DD) em que a pessoa já tem folga registrada nesta escala. */
  dayOffDatesByUser?: Map<string, Set<string>>;
  /** userId → datas (YYYY-MM-DD) em que a pessoa está em férias aprovadas. */
  vacationDatesByUser?: Map<string, Set<string>>;
  visiblePeople?: { id: string; name: string; shiftIds: string[] }[];
  onTogglePerson?: (shiftIds: string[]) => void;
  onRemoveSelected?: (shiftIds: string[]) => void;
  applyShiftsBatch: (input: BulkWorkShiftInput) => Promise<void>;
  onApplied: () => void;
  onCancel: () => void;
}

function uniqSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function formatDate(date: string) {
  const [year, month, day] = date.split('-');
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function personColor(name: string) {
  const colors = ['#db2777', '#0e7490', '#4f46e5', '#d97706', '#059669', '#7c3aed'];
  const hash = Array.from(name).reduce((total, char) => total + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function getPredictedDayOffDates(shifts: DPShift[]) {
  const state = buildShiftStreakState(shifts.filter(isWorkShift));
  return uniqSorted(
    Array.from(state.predictedDayOffsByUser.values())
      .flat()
      .map((item) => item.date)
  );
}

function groupSelectedShifts(selectedShifts: SelectedShiftItem[]) {
  const groups = new Map<string, SelectedShiftItem[]>();
  selectedShifts.forEach((item) => {
    const current = groups.get(item.shift.userId) ?? [];
    current.push(item);
    groups.set(item.shift.userId, current);
  });
  return Array.from(groups.entries());
}

export function DPBulkShiftEditPanel({
  selectedShifts,
  allCurrentShifts,
  previousShifts,
  siblingShifts,
  shiftDefinitions,
  people = [],
  dayOffDatesByUser,
  vacationDatesByUser,
  visiblePeople = [],
  onTogglePerson,
  onRemoveSelected,
  applyShiftsBatch,
  onApplied,
  onCancel,
}: BulkShiftEditPanelProps) {
  const { toast } = useToast();
  const [action, setAction] = React.useState<BulkAction>('replace');
  const [shiftDefinitionId, setShiftDefinitionId] = React.useState('');
  const [startTime, setStartTime] = React.useState('');
  const [endTime, setEndTime] = React.useState('');
  const [swapUserId, setSwapUserId] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const selectedDates = React.useMemo(
    () => Array.from(new Set(selectedShifts.map((item) => item.shift.date))),
    [selectedShifts],
  );
  const swapPerson = people.find((person) => person.id === swapUserId) ?? null;
  const swapDayOffWarning = React.useMemo(() => {
    if (!swapUserId || !dayOffDatesByUser) return 0;
    const dates = dayOffDatesByUser.get(swapUserId);
    if (!dates) return 0;
    return selectedDates.filter((date) => dates.has(date)).length;
  }, [dayOffDatesByUser, selectedDates, swapUserId]);
  const swapVacationWarning = React.useMemo(() => {
    if (!swapUserId || !vacationDatesByUser) return 0;
    const dates = vacationDatesByUser.get(swapUserId);
    if (!dates) return 0;
    return selectedDates.filter((date) => dates.has(date)).length;
  }, [selectedDates, swapUserId, vacationDatesByUser]);
  const hasTimeChange = Boolean(startTime && endTime);

  const affectedUsers = React.useMemo(
    () => uniqSorted(selectedShifts.map((item) => item.userName)),
    [selectedShifts]
  );

  const affectedUnits = React.useMemo(
    () => uniqSorted(selectedShifts.map((item) => item.unitName)),
    [selectedShifts]
  );
  const selectedGroups = React.useMemo(
    () => groupSelectedShifts(selectedShifts),
    [selectedShifts],
  );
  const selectedIdSet = React.useMemo(
    () => new Set(selectedShifts.map(({ shift }) => shift.id)),
    [selectedShifts],
  );
  const visibleShiftIds = React.useMemo(
    () => Array.from(new Set(visiblePeople.flatMap((person) => person.shiftIds))),
    [visiblePeople],
  );
  const allVisibleSelected = visibleShiftIds.length > 0
    && visibleShiftIds.every((shiftId) => selectedIdSet.has(shiftId));

  const preview = React.useMemo(() => {
    if (selectedShifts.length === 0) return null;

    const selectedIds = new Set(selectedShifts.map((item) => item.shift.id));
    const beforeCombined = [...previousShifts, ...siblingShifts, ...allCurrentShifts];
    let afterCurrent = allCurrentShifts.filter((shift) => !selectedIds.has(shift.id));

    if (action === 'replace') {
      afterCurrent = [
        ...afterCurrent,
        ...selectedShifts.map(({ shift }) => ({
          ...shift,
          ...(hasTimeChange ? { shiftDefinitionId: shiftDefinitionId || undefined, startTime, endTime } : {}),
          ...(swapUserId ? { userId: swapUserId } : {}),
          type: 'work' as const,
        })),
      ];
    }

    const beforePredicted = new Set(getPredictedDayOffDates(beforeCombined));
    const afterPredicted = new Set(getPredictedDayOffDates([
      ...previousShifts,
      ...siblingShifts,
      ...afterCurrent,
    ]));

    return {
      predictedAdded: Array.from(afterPredicted).filter((date) => !beforePredicted.has(date)),
      predictedRemoved: Array.from(beforePredicted).filter((date) => !afterPredicted.has(date)),
    };
  }, [action, allCurrentShifts, endTime, hasTimeChange, previousShifts, selectedShifts, shiftDefinitionId, siblingShifts, startTime, swapUserId]);

  const handleDefinitionChange = (value: string) => {
    setShiftDefinitionId(value);
    const definition = shiftDefinitions.find((item) => item.id === value);
    if (!definition) return;
    setStartTime(definition.startTime);
    setEndTime(definition.endTime);
  };

  async function handleApply() {
    if (selectedShifts.length === 0) {
      toast({ title: 'Selecione ao menos um turno.', variant: 'destructive' });
      return;
    }

    if (action === 'replace' && !hasTimeChange && !swapUserId) {
      toast({ title: 'Escolha um turno/horário ou uma colaboradora.', variant: 'destructive' });
      return;
    }

    if (action === 'replace' && hasTimeChange && startTime >= endTime) {
      toast({ title: 'O horário final deve ser posterior ao horário inicial.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      if (action === 'replace') {
        await applyShiftsBatch({
          action: 'replace',
          shiftIds: selectedShifts.map(({ shift }) => shift.id),
          patch: {
            ...(hasTimeChange ? { shiftDefinitionId: shiftDefinitionId || null, startTime, endTime } : {}),
            ...(swapPerson ? { userId: swapPerson.id } : {}),
          },
        });
      } else {
        await applyShiftsBatch({
          action: 'delete',
          shiftIds: selectedShifts.map(({ shift }) => shift.id),
        });
      }

      toast({
        title: action === 'clear'
          ? 'Turnos removidos.'
          : swapPerson
            ? `${selectedShifts.length} turno(s) atribuídos a ${swapPerson.name}.`
            : 'Turnos substituídos.',
        description: action === 'clear' || !swapPerson ? `${selectedShifts.length} turno(s) alterados.` : undefined,
      });
      onApplied();
    } catch (error) {
      toast({
        title: 'Erro ao aplicar alteração em lote.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside className="flex flex-col overflow-hidden border-l border-[#e3e9f1] bg-white min-[1180px]:sticky min-[1180px]:top-0 min-[1180px]:h-[calc(100vh-10rem)] min-[1180px]:max-h-[780px] max-[1179px]:mt-3 max-[1179px]:rounded-[14px] max-[1179px]:border">
      <div className="flex shrink-0 items-start gap-2 border-b border-[#eef1f6] px-[14px] py-[13px]">
        <div className="min-w-0">
          <div className="text-[13.5px] font-black leading-4 text-[#0f172a]">Edição em lote</div>
          <p className="mt-0.5 text-[11.5px] font-semibold leading-4 text-[#94a3b8]">As opções acompanham a escala.</p>
        </div>
        <button type="button" onClick={onCancel} aria-label="Fechar edição em lote" className="ml-auto grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg text-[#94a3b8] outline-none hover:bg-[#f6f8fb] focus-visible:ring-2 focus-visible:ring-[#db2777]">
          <X className="h-[13px] w-[13px]" strokeWidth={2.6} />
        </button>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-[14px]">
        <div className="flex flex-wrap gap-1.5">
          {[`${selectedShifts.length} turnos`, `${affectedUsers.length} pessoas`, `${affectedUnits.length} unidades`].map((label) => (
            <span key={label} className="rounded-[7px] border border-[#e3e9f1] px-[9px] py-[3px] text-[11px] font-extrabold leading-4 text-[#475569]">{label}</span>
          ))}
          {visiblePeople.length > 0 && (
            <button type="button" className="ml-auto rounded-[7px] border border-[#bfdbfe] bg-[#eff6ff] px-[9px] py-[3px] text-[11px] font-extrabold leading-4 text-[#1d4ed8] hover:bg-[#dbeafe]" onClick={() => onTogglePerson?.(visibleShiftIds)}>
              {allVisibleSelected ? 'Desmarcar visíveis' : 'Selecionar visíveis'}
            </button>
          )}
        </div>

        {visiblePeople.length > 0 && (
          <>
            <p className="mt-[14px] text-[11.5px] font-extrabold text-[#334155]">Selecionar por colaboradora</p>
            <div className="no-scrollbar mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {visiblePeople.map((person) => {
                const selectedCount = person.shiftIds.filter((shiftId) => selectedIdSet.has(shiftId)).length;
                const fullySelected = selectedCount === person.shiftIds.length;
                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => onTogglePerson?.(person.shiftIds)}
                    className={`flex h-[29px] max-w-full items-center gap-1.5 rounded-[9px] border py-0 pl-1 pr-[9px] ${fullySelected ? 'border-[#f7cfe1] bg-[#fdf0f6]' : 'border-[#e3e9f1] bg-white hover:bg-[#f8fafc]'}`}
                  >
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[8px] font-black text-white" style={{ backgroundColor: personColor(person.name) }}>{initials(person.name)}</span>
                    <span className="truncate text-[11.5px] font-extrabold text-[#334155]">{person.name.split(' ')[0]}</span>
                    <span className={`shrink-0 text-[10px] font-extrabold tabular-nums ${fullySelected ? 'text-[#db2777]' : 'text-[#94a3b8]'}`}>{selectedCount}/{person.shiftIds.length}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {selectedShifts.length === 0 ? (
          <div className="mt-[14px] rounded-[12px] border border-dashed border-[#dfe6f0] px-[14px] py-[22px] text-center text-[11.5px] font-bold leading-[1.5] text-[#a3aec0]">
            Selecione os turnos na escala para liberar as opções.
          </div>
        ) : (
          <>
            <p className="mt-[15px] text-[11.5px] font-extrabold text-[#334155]">Ação</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([['replace', 'Substituir'], ['clear', 'Remover']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAction(value)}
                  className={`rounded-[10px] border py-[9px] text-xs font-extrabold transition-colors ${
                    action === value
                      ? value === 'clear' ? 'border-[#fbd0da] bg-[#fef2f4] text-[#be123c]' : 'border-[#f7cfe1] bg-[#fdf0f6] text-[#db2777]'
                      : 'border-[#e9edf4] bg-white text-[#64748b] hover:bg-[#f8fafc]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {action === 'replace' ? (
              <>
                <div className="mt-3 rounded-[12px] border border-[#e9edf4] p-3">
                  <p className="text-[11.5px] font-extrabold text-[#334155]">Turno</p>
                  <div className="mt-[7px] flex flex-col gap-[5px]">
                    <button
                      type="button"
                      onClick={() => setShiftDefinitionId('')}
                      className={`flex items-center gap-[9px] rounded-[9px] border px-[10px] py-2 text-left ${!shiftDefinitionId ? 'border-[#f7cfe1] bg-[#fdf0f6]' : 'border-[#e9edf4] bg-white hover:bg-[#f8fafc]'}`}
                    >
                      <span className={`h-[7px] w-[7px] rounded-full ${!shiftDefinitionId ? 'bg-[#db2777]' : 'bg-[#cbd5e1]'}`} />
                      <span className={`text-xs font-extrabold ${!shiftDefinitionId ? 'text-[#db2777]' : 'text-[#475569]'}`}>Manual</span>
                    </button>
                    {shiftDefinitions.map((definition) => {
                      const selected = shiftDefinitionId === definition.id;
                      return (
                        <button
                          key={definition.id}
                          type="button"
                          onClick={() => handleDefinitionChange(definition.id)}
                          className={`flex items-center gap-[9px] rounded-[9px] border px-[10px] py-2 text-left ${selected ? 'border-[#f7cfe1] bg-[#fdf0f6]' : 'border-[#e9edf4] bg-white hover:bg-[#f8fafc]'}`}
                        >
                          <span className={`h-[7px] w-[7px] rounded-full ${selected ? 'bg-[#db2777]' : 'bg-[#cbd5e1]'}`} />
                          <span className={`min-w-0 flex-1 truncate text-xs font-extrabold ${selected ? 'text-[#db2777]' : 'text-[#475569]'}`}>{definition.name}</span>
                          <span className="shrink-0 text-[11px] font-bold tabular-nums text-[#94a3b8]">{definition.startTime}–{definition.endTime}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-[11px] grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11.5px] font-extrabold text-[#334155]">Início</label>
                      <Input type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); setShiftDefinitionId(''); }} className="mt-1.5 h-[34px] rounded-[9px] border-[#e3e9f1] bg-white px-[9px] text-[12.5px] font-bold text-[#0f172a]" />
                    </div>
                    <div>
                      <label className="text-[11.5px] font-extrabold text-[#334155]">Fim</label>
                      <Input type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); setShiftDefinitionId(''); }} className="mt-1.5 h-[34px] rounded-[9px] border-[#e3e9f1] bg-white px-[9px] text-[12.5px] font-bold text-[#0f172a]" />
                    </div>
                  </div>
                </div>

                {people.length > 0 && (
                  <div className="mt-3 rounded-[12px] border border-[#e9edf4] p-3">
                    <div className="flex items-baseline gap-[7px]">
                      <label className="text-[11.5px] font-extrabold text-[#334155]">Trocar colaboradora</label>
                      <span className="text-[10.5px] font-bold text-[#a3aec0]">{swapPerson ? `para ${swapPerson.name}` : 'opcional'}</span>
                    </div>
                    <Select value={swapUserId || '__keep__'} onValueChange={(value) => setSwapUserId(value === '__keep__' ? '' : value)}>
                      <SelectTrigger className="mt-2 h-9 rounded-[9px] border-[#e3e9f1] bg-white text-xs font-bold text-[#475569]"><SelectValue placeholder="Manter colaboradora atual" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__keep__">Manter colaboradora atual</SelectItem>
                        {people.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {swapDayOffWarning > 0 && <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-[#be123c]"><AlertTriangle className="h-3 w-3 shrink-0" />{swapPerson?.name} tem folga em {swapDayOffWarning} dia(s).</p>}
                    {swapVacationWarning > 0 && <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-[#be123c]"><AlertTriangle className="h-3 w-3 shrink-0" />{swapPerson?.name} está de férias em {swapVacationWarning} dia(s).</p>}
                  </div>
                )}
              </>
            ) : (
              <div className="mt-3 flex gap-2 rounded-[12px] border border-[#fbd0da] bg-[#fef2f4] px-3 py-[11px] text-[11.5px] font-bold leading-[1.45] text-[#be123c]">
                <AlertTriangle className="mt-0.5 h-[15px] w-[15px] shrink-0" />
                <p>Os turnos selecionados serão excluídos sem criar folgas no lugar.</p>
              </div>
            )}

            {preview && (preview.predictedAdded.length > 0 || preview.predictedRemoved.length > 0) && (
              <div className="mt-3 rounded-[12px] border border-[#fde68a] bg-[#fffbeb] px-3 py-[10px] text-[11.5px] font-bold leading-[1.5] text-[#b45309]">
                {preview.predictedAdded.length > 0 && <p>Novas folgas previstas: {preview.predictedAdded.map(formatDate).join(', ')}.</p>}
                {preview.predictedRemoved.length > 0 && <p>Folgas previstas removidas: {preview.predictedRemoved.map(formatDate).join(', ')}.</p>}
              </div>
            )}

            <p className="mt-[14px] text-[11.5px] font-extrabold text-[#334155]">Pessoas selecionadas</p>
            <div className="no-scrollbar mt-[7px] flex max-h-[200px] flex-col gap-1.5 overflow-y-auto">
              {selectedGroups.map(([userId, items]) => (
                <div key={userId} className="flex items-center gap-2 rounded-[10px] border border-[#e9edf4] px-[10px] py-2">
                  <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[8.5px] font-black text-white" style={{ backgroundColor: personColor(items[0].userName) }}>{initials(items[0].userName)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-extrabold text-[#0f172a]">{items[0].userName}</p>
                    <p className="truncate text-[10.5px] font-bold text-[#94a3b8]">{items.map(({ shift }) => formatDate(shift.date)).join(', ')}</p>
                    <p className="truncate text-[10.5px] font-bold text-[#94a3b8]">{items[0].unitName}</p>
                  </div>
                  <span className="shrink-0 text-[11px] font-extrabold tabular-nums text-[#64748b]">{items.length}</span>
                  <button type="button" aria-label={`Remover ${items[0].userName} da seleção`} onClick={() => onRemoveSelected?.(items.map(({ shift }) => shift.id))} className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] text-[#b6c0cf] hover:bg-[#f6f8fb] hover:text-[#64748b]">
                    <X className="h-3 w-3" strokeWidth={2.6} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-[#eef1f6] px-[14px] py-3">
        <Button
          type="button"
          className={`h-[38px] w-full rounded-[10px] text-[12.5px] font-extrabold text-white ${action === 'clear' ? 'bg-[#e11d48] hover:bg-[#be123c]' : 'bg-[#db2777] hover:bg-[#be185d]'}`}
          onClick={handleApply}
          disabled={selectedShifts.length === 0 || submitting || swapDayOffWarning > 0 || swapVacationWarning > 0}
        >
          {action === 'clear' ? <Trash2 className="mr-2 h-4 w-4" /> : <Wand2 className="mr-2 h-4 w-4" />}
          {submitting ? 'Aplicando...' : action === 'clear' ? `Remover ${selectedShifts.length}` : swapPerson ? `Passar ${selectedShifts.length} para ${swapPerson.name}` : `Substituir ${selectedShifts.length}`}
        </Button>
      </div>
    </aside>
  );
}
