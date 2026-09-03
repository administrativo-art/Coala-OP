"use client";

import React from 'react';

import type { DPShift, DPShiftDefinition } from '@/types';
import { buildShiftStreakState } from '@/lib/dp-shift-rules';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  updateShiftsBatch: (shifts: DPShift[]) => Promise<void>;
  deleteShiftsBatch: (shifts: Pick<DPShift, 'id' | 'type'>[]) => Promise<void>;
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

function getPredictedDayOffDates(shifts: DPShift[]) {
  const state = buildShiftStreakState(shifts.filter((shift) => shift.type === 'work'));
  return uniqSorted(
    Array.from(state.predictedDayOffsByUser.values())
      .flat()
      .map((item) => item.date)
  );
}

export function DPBulkShiftEditPanel({
  selectedShifts,
  allCurrentShifts,
  previousShifts,
  siblingShifts,
  shiftDefinitions,
  updateShiftsBatch,
  deleteShiftsBatch,
  onApplied,
  onCancel,
}: BulkShiftEditPanelProps) {
  const { toast } = useToast();
  const [action, setAction] = React.useState<BulkAction>('replace');
  const [shiftDefinitionId, setShiftDefinitionId] = React.useState('');
  const [startTime, setStartTime] = React.useState('');
  const [endTime, setEndTime] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const affectedUsers = React.useMemo(
    () => uniqSorted(selectedShifts.map((item) => item.userName)),
    [selectedShifts]
  );

  const affectedUnits = React.useMemo(
    () => uniqSorted(selectedShifts.map((item) => item.unitName)),
    [selectedShifts]
  );

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
          shiftDefinitionId: shiftDefinitionId || undefined,
          startTime,
          endTime,
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
  }, [action, allCurrentShifts, endTime, previousShifts, selectedShifts, shiftDefinitionId, siblingShifts, startTime]);

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

    if (action === 'replace' && (!startTime || !endTime)) {
      toast({ title: 'Selecione um turno ou informe início e fim.', variant: 'destructive' });
      return;
    }

    if (action === 'replace' && startTime >= endTime) {
      toast({ title: 'O horário final deve ser posterior ao horário inicial.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      if (action === 'replace') {
        await updateShiftsBatch(
          selectedShifts.map(({ shift }) => ({
            ...shift,
            shiftDefinitionId: shiftDefinitionId || undefined,
            startTime,
            endTime,
            type: 'work',
          }))
        );
      } else {
        await deleteShiftsBatch(selectedShifts.map(({ shift }) => ({ id: shift.id, type: shift.type })));
      }

      toast({
        title: action === 'clear' ? 'Turnos removidos.' : 'Turnos substituídos.',
        description: `${selectedShifts.length} turno(s) alterados.`,
      });
      onApplied();
    } catch {
      toast({ title: 'Erro ao aplicar alteração em lote.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside className="rounded-xl border bg-card shadow-sm min-[1180px]:sticky min-[1180px]:top-4 min-[1180px]:max-h-[calc(100vh-2rem)] min-[1180px]:overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur">
        <div>
          <h3 className="text-sm font-semibold">Edição em lote</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">As opções acompanham a escala.</p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel} aria-label="Fechar edição em lote">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{selectedShifts.length} turnos</Badge>
          <Badge variant="outline">{affectedUsers.length} pessoas</Badge>
          <Badge variant="outline">{affectedUnits.length} unidades</Badge>
        </div>

        {selectedShifts.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            Selecione os turnos na escala para liberar as opções.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-xs font-medium">Ação</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['replace', 'Substituir'],
                  ['clear', 'Remover'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAction(value as BulkAction)}
                    className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                      action === value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {action === 'replace' ? (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Turno</label>
                  <Select value={shiftDefinitionId || '__manual__'} onValueChange={(value) => {
                    if (value === '__manual__') {
                      setShiftDefinitionId('');
                      return;
                    }
                    handleDefinitionChange(value);
                  }}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__manual__">— Manual —</SelectItem>
                      {shiftDefinitions.map((definition) => (
                        <SelectItem key={definition.id} value={definition.id}>
                          {definition.name} ({definition.startTime}–{definition.endTime})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Início</label>
                    <Input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Fim</label>
                    <Input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="h-9" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Os turnos selecionados serão excluídos sem criar folgas no lugar.</p>
              </div>
            )}

            {preview && (preview.predictedAdded.length > 0 || preview.predictedRemoved.length > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-700">
                {preview.predictedAdded.length > 0 && <p>Novas folgas previstas: {preview.predictedAdded.join(', ')}.</p>}
                {preview.predictedRemoved.length > 0 && <p>Folgas previstas removidas: {preview.predictedRemoved.join(', ')}.</p>}
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs font-medium">Selecionados</p>
              <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                {selectedShifts.map(({ shift, userName, unitName }) => (
                  <div key={shift.id} className="rounded-lg border px-2.5 py-2 text-xs">
                    <p className="truncate font-medium">{userName}</p>
                    <p className="truncate text-muted-foreground">
                      {formatDate(shift.date)} · {unitName}
                    </p>
                    <p className="text-muted-foreground">{shift.startTime}–{shift.endTime}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="sticky bottom-0 border-t bg-card/95 p-3 backdrop-blur">
        <Button
          type="button"
          className="w-full"
          variant={action === 'clear' ? 'destructive' : 'default'}
          onClick={handleApply}
          disabled={selectedShifts.length === 0 || submitting}
        >
          {action === 'clear' ? <Trash2 className="mr-2 h-4 w-4" /> : <Wand2 className="mr-2 h-4 w-4" />}
          {submitting
            ? 'Aplicando...'
            : action === 'clear'
              ? `Remover ${selectedShifts.length}`
              : `Substituir ${selectedShifts.length}`}
        </Button>
      </div>
    </aside>
  );
}
