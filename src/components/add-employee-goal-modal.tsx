"use client";

import { useState, useMemo } from 'react';
import { useGoals } from '@/contexts/goals-context';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { type GoalPeriodDoc } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, X, AlertCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface AddEmployeeGoalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: GoalPeriodDoc | null;
}

export function AddEmployeeGoalModal({ open, onOpenChange, period }: AddEmployeeGoalModalProps) {
  const { employeeGoals, addEmployeeGoal, deleteEmployeeGoal } = useGoals();
  const { users } = useAuth();
  const { toast } = useToast();

  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [fraction, setFraction] = useState('');
  const [selectedShift, setSelectedShift] = useState('');
  const [loading, setLoading] = useState(false);

  const hasShifts = (period?.shifts?.length ?? 0) > 0;

  const periodEmployeeGoals = useMemo(() =>
    employeeGoals.filter(eg => eg.periodId === period?.id),
    [employeeGoals, period]
  );

  const kioskUsers = useMemo(() =>
    users.filter(u => {
      if (!period) return false;
      // Show user if they participate in goals OR are assigned to this kiosk
      const participates = u.participatesInGoals === true;
      const assigned = u.assignedKioskIds?.includes(period.kioskId);
      return participates || assigned;
    }),
    [users, period]
  );

  const getUserName = (id: string) => users.find(u => u.id === id)?.username ?? id;

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
    if (!empId || !pct) return;
    const fractionNum = parseFloat(pct) / 100;
    if (isNaN(fractionNum) || fractionNum <= 0 || fractionNum > 1) {
      toast({ title: 'Porcentagem inválida', variant: 'destructive' });
      return;
    }
    const shift = period.shifts?.find(s => s.id === shiftId);
    if (!shift) return;
    setLoading(true);
    await addEmployeeGoal({
      periodId: period.id,
      employeeId: empId,
      kioskId: period.kioskId,
      shiftId,
      fraction: fractionNum,
      targetValue: period.targetValue * shift.fraction * fractionNum,
      currentValue: 0,
    });
    toast({ title: 'Colaborador adicionado ao turno.' });
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
    if (!period || !selectedEmployee || !fraction) return;
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
    await addEmployeeGoal({
      periodId: period.id,
      employeeId: selectedEmployee,
      kioskId: period.kioskId,
      fraction: fractionNum,
      targetValue: period.targetValue * fractionNum,
      currentValue: 0,
    });
    toast({ title: 'Colaborador adicionado à meta.' });
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
                          <button onClick={() => deleteEmployeeGoal(eg.id)} className="text-muted-foreground hover:text-destructive">
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
                      <button onClick={() => deleteEmployeeGoal(eg.id)} className="text-muted-foreground hover:text-destructive">
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
