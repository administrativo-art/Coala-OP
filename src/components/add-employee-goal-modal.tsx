"use client";

import { useState, useMemo } from 'react';
import { useGoals } from '@/contexts/goals-context';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useToast } from '@/hooks/use-toast';
import { type EmployeeGoal, type GoalPeriodDoc } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, X, AlertCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useDP } from '@/components/dp-context';
import { useDPShifts } from '@/hooks/use-dp-shifts';
import { matchDPUnitForKiosk } from '@/lib/dp-kiosk-match';
import { externalCoverageUserIds } from '@/lib/dp-external-coverage';

interface AddEmployeeGoalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: GoalPeriodDoc | null;
}

export function AddEmployeeGoalModal({ open, onOpenChange, period }: AddEmployeeGoalModalProps) {
  const { employeeGoals, addEmployeeGoal, deleteEmployeeGoal, rebalancePeriodEmployeeGoals } = useGoals();
  const { users } = useAuth();
  const { kiosks } = useKiosks();
  const { schedules, units } = useDP();
  const { toast } = useToast();

  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [fraction, setFraction] = useState('');
  const [selectedShift, setSelectedShift] = useState('');
  const [loading, setLoading] = useState(false);

  const hasShifts = (period?.shifts?.length ?? 0) > 0 && period?.version !== 2;

  const kiosk = kiosks.find(item => item.id === period?.kioskId);
  const dpUnit = kiosk ? matchDPUnitForKiosk(kiosk.name, units) : undefined;
  const periodStart = period?.startDate?.toDate?.();
  const periodEnd = period?.endDate?.toDate?.();
  const schedule = schedules.find(item => item.unitId === dpUnit?.id
    && item.year === periodStart?.getFullYear()
    && item.month === (periodStart?.getMonth() ?? -1) + 1) ?? null;
  const { shifts: dpShifts, loading: dpShiftsLoading, error: dpShiftsError } = useDPShifts(schedule?.id ?? null);
  const scheduleEvidenceReady = !schedule || (!dpShiftsLoading && !dpShiftsError);
  const externalCoverageUsers = useMemo(() => {
    if (!periodStart || !periodEnd) return new Set<string>();
    const key = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    const startKey = key(periodStart);
    const endKey = key(periodEnd);
    return externalCoverageUserIds(dpShifts.filter(shift => shift.date >= startKey && shift.date <= endKey));
  }, [dpShifts, periodEnd, periodStart]);

  const periodEmployeeGoals = useMemo(() =>
    employeeGoals.filter(eg => eg.periodId === period?.id),
    [employeeGoals, period]
  );

  const kioskUsers = useMemo(() =>
    scheduleEvidenceReady ? users.filter(u => {
      if (!period) return false;
      // Metas valem para qualquer pessoa ativa, de qualquer vínculo, inclusive de outro quiosque.
      return u.isActive !== false && !externalCoverageUsers.has(u.id);
    }) : [],
    [externalCoverageUsers, users, period, scheduleEvidenceReady]
  );

  const getUserName = (id: string) => users.find(u => u.id === id)?.username ?? id;

  async function rebalanceWith(nextGoals: EmployeeGoal[]) {
    if (!period) return;
    if (period.version === 2) return;
    const kioskName = kiosks.find(kiosk => kiosk.id === period.kioskId)?.name;
    await rebalancePeriodEmployeeGoals(
      period,
      nextGoals,
      kioskName ? { [period.kioskId]: kioskName } : undefined
    );
  }

  async function handleDelete(goal: EmployeeGoal) {
    if (!period) return;
    setLoading(true);
    await deleteEmployeeGoal(goal.id);
    await rebalanceWith(periodEmployeeGoals.filter(item => item.id !== goal.id));
    setLoading(false);
  }

  // ── With shifts ─────────────────────────────────────────────────────────────

  function goalsForShift(shiftId: string) {
    return periodEmployeeGoals.filter(eg => eg.shiftId === shiftId);
  }

  function allocatedPct(shiftId: string) {
    return goalsForShift(shiftId).reduce((s, eg) => s + eg.fraction * 100, 0);
  }

  function availableUsersForShift(shiftId: string) {
    return kioskUsers.filter(u => !goalsForShift(shiftId).some(eg => eg.employeeId === u.id));
  }

  const [newEmp, setNewEmp] = useState<Record<string, string>>({});
  const [newPct, setNewPct] = useState<Record<string, string>>({});

  async function handleAddToShift(shiftId: string) {
    if (!period) return;
    const empId = newEmp[shiftId];
    const pct = newPct[shiftId];
    if (!empId || !pct || !scheduleEvidenceReady || externalCoverageUsers.has(empId)) return;
    const fractionNum = parseFloat(pct) / 100;
    if (isNaN(fractionNum) || fractionNum <= 0 || fractionNum > 1) {
      toast({ title: 'Porcentagem inválida', variant: 'destructive' });
      return;
    }
    const shift = period.shifts?.find(s => s.id === shiftId);
    if (!shift) return;
    setLoading(true);
    const employeeGoalData = {
      periodId: period.id,
      employeeId: empId,
      kioskId: period.kioskId,
      shiftId,
      fraction: fractionNum,
      targetValue: period.targetValue * shift.fraction * fractionNum,
      currentValue: 0,
      distributionMode: period.distributionMode ?? 'calendar_days',
    } satisfies Omit<EmployeeGoal, 'id' | 'createdAt' | 'updatedAt'>;
    const id = await addEmployeeGoal(employeeGoalData);
    if (id) {
      await rebalanceWith([...periodEmployeeGoals, { id, ...employeeGoalData } as EmployeeGoal]);
      toast({ title: 'Colaborador adicionado ao turno.' });
    } else {
      toast({ title: 'Colaborador não adicionado', description: 'Coberturas externas não participam das metas da unidade.', variant: 'destructive' });
    }
    setNewEmp(prev => ({ ...prev, [shiftId]: '' }));
    setNewPct(prev => ({ ...prev, [shiftId]: '' }));
    setLoading(false);
  }

  // ── Without shifts (legacy) ──────────────────────────────────────────────────

  const totalFraction = useMemo(() =>
    periodEmployeeGoals.reduce((s, eg) => s + eg.fraction, 0),
    [periodEmployeeGoals]
  );

  const availableUsersLegacy = useMemo(() =>
    kioskUsers.filter(u => !periodEmployeeGoals.some(eg => eg.employeeId === u.id)),
    [kioskUsers, periodEmployeeGoals]
  );

  async function handleAddLegacy() {
    if (!period || !selectedEmployee || !fraction || !scheduleEvidenceReady || externalCoverageUsers.has(selectedEmployee)) return;
    // Unify to use percentage (1-100) instead of decimal (0-1)
    const fractionNum = parseFloat(fraction) / 100;
    if (isNaN(fractionNum) || fractionNum <= 0 || fractionNum > 1) {
      toast({ title: 'Porcentagem inválida', description: 'Deve ser entre 1 e 100.', variant: 'destructive' });
      return;
    }
    if (totalFraction + fractionNum > 1.001) {
      toast({ title: 'Soma das frações ultrapassa 100%', variant: 'destructive' });
      return;
    }
    setLoading(true);
    const employeeGoalData = {
      periodId: period.id,
      employeeId: selectedEmployee,
      kioskId: period.kioskId,
      fraction: fractionNum,
      targetValue: period.targetValue * fractionNum,
      currentValue: 0,
      distributionMode: period.distributionMode ?? 'calendar_days',
    } satisfies Omit<EmployeeGoal, 'id' | 'createdAt' | 'updatedAt'>;
    const id = await addEmployeeGoal(employeeGoalData);
    if (id) {
      await rebalanceWith([...periodEmployeeGoals, { id, ...employeeGoalData } as EmployeeGoal]);
      toast({ title: 'Colaborador adicionado à meta.' });
    } else {
      toast({ title: 'Colaborador não adicionado', description: 'Coberturas externas não participam das metas da unidade.', variant: 'destructive' });
    }
    setSelectedEmployee('');
    setFraction('');
    setLoading(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Metas por Colaborador</DialogTitle>
          <DialogDescription>
            {hasShifts
              ? `${period?.shifts?.length} turno(s) definido(s)`
              : `Soma atual: ${(totalFraction * 100).toFixed(0)}% de 100%`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {schedule && !scheduleEvidenceReady ? (
            <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-900">
              {dpShiftsLoading
                ? 'Carregando a escala para validar a equipe da meta…'
                : 'A escala não pôde ser validada. Recarregue antes de alterar participantes.'}
            </p>
          ) : null}
          {hasShifts ? (
            // ── POR TURNO ──────────────────────────────────────────────────
            period!.shifts!.map(shift => {
              const shiftGoals = goalsForShift(shift.id);
              const allocated = allocatedPct(shift.id);
              const available = availableUsersForShift(shift.id);
              const shiftTarget = period!.targetValue * shift.fraction;

              return (
                <div key={shift.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{shift.label}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{(shift.fraction * 100).toFixed(0)}%</Badge>
                      <span className="text-xs text-muted-foreground">
                        Alvo: R$ {shiftTarget.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {shiftGoals.map(eg => {
                    const userObj = users.find(u => u.id === eg.employeeId);
                    const hasPdvId = !!userObj?.pdvOperatorIds?.[period!.kioskId];

                    return (
                      <div key={eg.id} className="flex items-center justify-between rounded bg-muted/50 px-2 py-1 text-sm">
                        <div className="flex items-center gap-2">
                          <span>{userObj?.username ?? eg.employeeId}</span>
                          {!hasPdvId && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                                </TooltipTrigger>
                                <TooltipContent>Sem ID de PDV para este quiosque. O faturamento automático não funcionará para este colaborador.</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">
                            {(eg.fraction * 100).toFixed(0)}% do turno — Alvo: R$ {eg.targetValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </Badge>
                          <button onClick={() => handleDelete(eg)} className="text-muted-foreground hover:text-destructive">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <div className="text-xs text-muted-foreground">Alocado: {allocated.toFixed(0)}% deste turno</div>

                  {available.length > 0 && (
                    <div className="flex gap-2 pt-1 border-t">
                      <Select value={newEmp[shift.id] ?? ''} onValueChange={v => setNewEmp(p => ({ ...p, [shift.id]: v }))}>
                        <SelectTrigger className="flex-1 h-8 text-sm"><SelectValue placeholder="Colaborador" /></SelectTrigger>
                        <SelectContent>{available.map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}</SelectContent>
                      </Select>
                      <div className="relative w-24">
                        <Input
                          className="h-8 text-sm pr-7"
                          type="number" min="1" max="100" placeholder="50"
                          value={newPct[shift.id] ?? ''}
                          onChange={e => setNewPct(p => ({ ...p, [shift.id]: e.target.value }))}
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                      </div>
                      <Button size="sm" className="h-8 px-2" onClick={() => handleAddToShift(shift.id)} disabled={!newEmp[shift.id] || !newPct[shift.id] || loading}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            // ── LEGADO (sem turnos) ───────────────────────────────────────
            <>
              {periodEmployeeGoals.map(eg => {
                const userObj = users.find(u => u.id === eg.employeeId);
                const hasPdvId = !!userObj?.pdvOperatorIds?.[period!.kioskId];

                return (
                  <div key={eg.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span>{userObj?.username ?? eg.employeeId}</span>
                      {!hasPdvId && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                            </TooltipTrigger>
                            <TooltipContent>Sem ID de PDV para este quiosque. O faturamento automático não funcionará para este colaborador.</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{(eg.fraction * 100).toFixed(0)}% — Alvo: R$ {eg.targetValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</Badge>
                      <button onClick={() => handleDelete(eg)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {availableUsersLegacy.length > 0 && (
                <div className="flex gap-2 pt-2 border-t">
                  <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Selecionar colaborador" /></SelectTrigger>
                    <SelectContent>{availableUsersLegacy.map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}</SelectContent>
                  </Select>
                  <div className="relative w-24">
                    <Input className="h-10 pr-7" type="number" min="1" max="100" placeholder="50"
                      value={fraction} onChange={e => setFraction(e.target.value)} />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                  <Button onClick={handleAddLegacy} disabled={!selectedEmployee || !fraction || loading}>Adicionar</Button>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
