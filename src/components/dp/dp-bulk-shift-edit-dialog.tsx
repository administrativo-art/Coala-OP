"use client";

import React from 'react';

import type { DPShift, DPShiftDefinition } from '@/types';
import { buildShiftStreakState } from '@/lib/dp-shift-rules';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Wand2 } from 'lucide-react';

type BulkAction = 'replace' | 'clear' | 'day_off';

type SelectedShiftItem = {
  shift: DPShift;
  userName: string;
  unitName: string;
};

interface BulkShiftEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedShifts: SelectedShiftItem[];
  allCurrentShifts: DPShift[];
  previousShifts: DPShift[];
  siblingShifts: DPShift[];
  shiftDefinitions: DPShiftDefinition[];
  addShiftsBatch: (data: Omit<DPShift, 'id' | 'createdAt'>[]) => Promise<void>;
  updateShiftsBatch: (shifts: DPShift[]) => Promise<void>;
  deleteShiftsBatch: (shifts: Pick<DPShift, 'id' | 'type'>[]) => Promise<void>;
  onApplied: () => void;
}

function uniqSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function getPredictedDayOffDates(shifts: DPShift[]) {
  const state = buildShiftStreakState(shifts.filter((shift) => shift.type === 'work'));
  return uniqSorted(
    Array.from(state.predictedDayOffsByUser.values())
      .flat()
      .map((item) => item.date)
  );
}

export function DPBulkShiftEditDialog({
  open,
  onOpenChange,
  selectedShifts,
  allCurrentShifts,
  previousShifts,
  siblingShifts,
  shiftDefinitions,
  addShiftsBatch,
  updateShiftsBatch,
  deleteShiftsBatch,
  onApplied,
}: BulkShiftEditDialogProps) {
  const { toast } = useToast();
  const [action, setAction] = React.useState<BulkAction>('replace');
  const [shiftDefinitionId, setShiftDefinitionId] = React.useState('');
  const [startTime, setStartTime] = React.useState('');
  const [endTime, setEndTime] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setAction('replace');
    setShiftDefinitionId('');
    setStartTime('');
    setEndTime('');
  }, [open]);

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

    if (action === 'day_off') {
      afterCurrent = [
        ...afterCurrent,
        ...selectedShifts.map(({ shift }) => ({
          ...shift,
          shiftDefinitionId: undefined,
          startTime: '',
          endTime: '',
          type: 'day_off' as const,
        })),
      ];
    }

    const beforePredicted = new Set(getPredictedDayOffDates(beforeCombined));
    const afterPredicted = new Set(getPredictedDayOffDates([...previousShifts, ...siblingShifts, ...afterCurrent]));

    return {
      selectedCount: selectedShifts.length,
      uniqueUsers: affectedUsers.length,
      uniqueUnits: affectedUnits.length,
      predictedAdded: Array.from(afterPredicted).filter((date) => !beforePredicted.has(date)),
      predictedRemoved: Array.from(beforePredicted).filter((date) => !afterPredicted.has(date)),
    };
  }, [action, affectedUnits.length, affectedUsers.length, allCurrentShifts, endTime, previousShifts, selectedShifts, shiftDefinitionId, siblingShifts, startTime]);

  const actionRequiresShift = action === 'replace';

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

    if (actionRequiresShift && !shiftDefinitionId && (!startTime || !endTime)) {
      toast({ title: 'Selecione um turno ou informe início e fim.', variant: 'destructive' });
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
      }

      if (action === 'clear') {
        await deleteShiftsBatch(selectedShifts.map(({ shift }) => ({ id: shift.id, type: shift.type })));
      }

      if (action === 'day_off') {
        await deleteShiftsBatch(selectedShifts.map(({ shift }) => ({ id: shift.id, type: shift.type })));
        await addShiftsBatch(
          selectedShifts.map(({ shift }) => ({
            scheduleId: shift.scheduleId,
            unitId: shift.unitId,
            userId: shift.userId,
            shiftDefinitionId: undefined,
            date: shift.date,
            startTime: '',
            endTime: '',
            type: 'day_off',
            hasConflict: false,
          }))
        );
      }

      toast({
        title: 'Alteração em lote aplicada.',
        description: `${selectedShifts.length} turno(s) atualizados.`,
      });
      onApplied();
      onOpenChange(false);
    } catch {
      toast({ title: 'Erro ao aplicar alteração em lote.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Alterar turnos em lote</DialogTitle>
          <DialogDescription>
            A alteração será aplicada somente aos turnos selecionados na grade.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{selectedShifts.length} turno(s)</Badge>
            <Badge variant="outline">{affectedUsers.length} colaborador(es)</Badge>
            <Badge variant="outline">{affectedUnits.length} unidade(s)</Badge>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Ação</label>
            <div className="grid gap-2 md:grid-cols-3">
              {[
                ['replace', 'Substituir turno'],
                ['clear', 'Limpar'],
                ['day_off', 'Marcar folga'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAction(value as BulkAction)}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
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

          {actionRequiresShift && (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Turno pré-definido</label>
                <Select value={shiftDefinitionId || '__manual__'} onValueChange={(value) => {
                  if (value === '__manual__') {
                    setShiftDefinitionId('');
                    return;
                  }
                  handleDefinitionChange(value);
                }}>
                  <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
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

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Início</label>
                  <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Fim</label>
                  <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border p-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Turnos selecionados</p>
                <p className="mt-1 text-lg font-semibold">{preview?.selectedCount ?? 0}</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Colaboradores afetados</p>
                <p className="mt-1 text-lg font-semibold">{preview?.uniqueUsers ?? 0}</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Unidades afetadas</p>
                <p className="mt-1 text-lg font-semibold">{preview?.uniqueUnits ?? 0}</p>
              </div>
            </div>

            {preview && (preview.predictedAdded.length > 0 || preview.predictedRemoved.length > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-700">
                {preview.predictedAdded.length > 0 && (
                  <p>Novas folgas previstas: {preview.predictedAdded.join(', ')}.</p>
                )}
                {preview.predictedRemoved.length > 0 && (
                  <p>Folgas previstas removidas: {preview.predictedRemoved.join(', ')}.</p>
                )}
              </div>
            )}

            <div className="space-y-1">
              <p className="text-sm font-medium">Turnos selecionados</p>
              <div className="max-h-44 overflow-y-auto space-y-2 pr-1">
                {selectedShifts.map(({ shift, userName, unitName }) => (
                  <div key={shift.id} className="rounded-lg border px-3 py-2 text-xs">
                    <div className="font-medium">{userName}</div>
                    <div className="text-muted-foreground">
                      {shift.date} · {unitName} · {shift.startTime}–{shift.endTime}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleApply} disabled={submitting}>
            <Wand2 className="mr-2 h-4 w-4" />
            {submitting ? 'Aplicando...' : 'Aplicar alterações'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
