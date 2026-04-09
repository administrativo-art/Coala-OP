"use client";

import { useState, useMemo, useEffect } from 'react';
import { useGoals } from '@/contexts/goals-context';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { type GoalPeriodDoc } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Plus, X } from 'lucide-react';

interface EditGoalPeriodModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: GoalPeriodDoc | null;
}

export function EditGoalPeriodModal({ open, onOpenChange, period }: EditGoalPeriodModalProps) {
  const { employeeGoals, updatePeriod, addEmployeeGoal, deleteEmployeeGoal } = useGoals();
  const { users } = useAuth();
  const { toast } = useToast();

  const [targetValue, setTargetValue] = useState<number>(0);
  const [upValue, setUpValue] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [egLoading, setEgLoading] = useState(false);
  const [newEmp, setNewEmp] = useState<Record<string, string>>({});
  const [newPct, setNewPct] = useState<Record<string, string>>({});

  const hasShifts = (period?.shifts?.length ?? 0) > 0;

  const periodEmployeeGoals = useMemo(() =>
    employeeGoals.filter(eg => eg.periodId === period?.id),
    [employeeGoals, period]
  );

  const kioskUsers = useMemo(() =>
    users.filter(u => period && u.assignedKioskIds?.includes(period.kioskId)),
    [users, period]
  );

  const getUserName = (id: string) => users.find(u => u.id === id)?.username ?? id;

  // Inicializa valores quando o modal abre ou o período muda
  useEffect(() => {
    if (open && period) {
      setTargetValue(period.targetValue);
      setUpValue(period.upValue ?? period.targetValue * 1.2);
    }
  }, [open, period]);

  async function handleSavePeriod() {
    if (!period) return;
    setSaving(true);
    await updatePeriod(period.id, { targetValue, upValue });
    toast({ title: 'Meta atualizada.' });
    setSaving(false);
  }

  // ── Com turnos ──────────────────────────────────────────────────────────────

  function goalsForShift(shiftId: string) {
    return periodEmployeeGoals.filter(eg => eg.shiftId === shiftId);
  }

  function allocatedPct(shiftId: string) {
    return goalsForShift(shiftId).reduce((s, eg) => s + eg.fraction * 100, 0);
  }

  function availableUsersForShift(shiftId: string) {
    return kioskUsers.filter(u => !goalsForShift(shiftId).some(eg => eg.employeeId === u.id));
  }

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
    setEgLoading(true);
    const id = await addEmployeeGoal({
      periodId: period.id, employeeId: empId, kioskId: period.kioskId,
      shiftId, fraction: fractionNum,
      targetValue: period.targetValue * shift.fraction * fractionNum,
      currentValue: 0, dailyProgress: {},
    });
    if (id) toast({ title: 'Colaborador adicionado.' });
    else toast({ title: 'Erro ao adicionar colaborador.', variant: 'destructive' });
    setNewEmp(p => ({ ...p, [shiftId]: '' }));
    setNewPct(p => ({ ...p, [shiftId]: '' }));
    setEgLoading(false);
  }

  // ── Sem turnos (legado) ──────────────────────────────────────────────────────

  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [fraction, setFraction] = useState('');

  const availableUsersLegacy = useMemo(() =>
    kioskUsers.filter(u => !periodEmployeeGoals.some(eg => eg.employeeId === u.id)),
    [kioskUsers, periodEmployeeGoals]
  );

  async function handleAddLegacy() {
    if (!period || !selectedEmployee || !fraction) return;
    const fractionNum = parseFloat(fraction);
    if (isNaN(fractionNum) || fractionNum <= 0 || fractionNum > 1) {
      toast({ title: 'Fração inválida', variant: 'destructive' });
      return;
    }
    setEgLoading(true);
    const id = await addEmployeeGoal({
      periodId: period.id, employeeId: selectedEmployee, kioskId: period.kioskId,
      fraction: fractionNum, targetValue: period.targetValue * fractionNum,
      currentValue: 0, dailyProgress: {},
    });
    if (id) toast({ title: 'Colaborador adicionado.' });
    else toast({ title: 'Erro ao adicionar colaborador.', variant: 'destructive' });
    setSelectedEmployee('');
    setFraction('');
    setEgLoading(false);
  }

  if (!period) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar meta</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
          {/* ── Valores da meta ── */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Valores</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Meta alvo</Label>
                <CurrencyInput value={targetValue} onChange={setTargetValue} />
              </div>
              <div className="space-y-1.5">
                <Label>Meta UP</Label>
                <CurrencyInput value={upValue} onChange={setUpValue} />
              </div>
            </div>
          </div>

          <Separator />

          {/* ── Colaboradores ── */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Colaboradores</p>

            {hasShifts ? (
              period.shifts!.map(shift => {
                const shiftGoals = goalsForShift(shift.id);
                const allocated = allocatedPct(shift.id);
                const available = availableUsersForShift(shift.id);

                return (
                  <div key={shift.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{shift.label}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{(shift.fraction * 100).toFixed(0)}%</Badge>
                        <span className="text-xs text-muted-foreground">
                          Alvo: R$ {(period.targetValue * shift.fraction).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>

                    {shiftGoals.map(eg => (
                      <div key={eg.id} className="flex items-center justify-between rounded bg-muted/50 px-2 py-1 text-sm">
                        <span>{getUserName(eg.employeeId)}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">
                            {(eg.fraction * 100).toFixed(0)}% do turno — R$ {eg.targetValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </Badge>
                          <button onClick={() => deleteEmployeeGoal(eg.id)} className="text-muted-foreground hover:text-destructive">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className="text-xs text-muted-foreground">Alocado: {allocated.toFixed(0)}%</div>

                    {available.length > 0 && (
                      <div className="flex gap-2 pt-1 border-t">
                        <Select value={newEmp[shift.id] ?? ''} onValueChange={v => setNewEmp(p => ({ ...p, [shift.id]: v }))}>
                          <SelectTrigger className="flex-1 h-8 text-sm"><SelectValue placeholder="Colaborador" /></SelectTrigger>
                          <SelectContent>{available.map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}</SelectContent>
                        </Select>
                        <div className="relative w-24">
                          <Input className="h-8 text-sm pr-7" type="number" min="1" max="100" placeholder="50"
                            value={newPct[shift.id] ?? ''}
                            onChange={e => setNewPct(p => ({ ...p, [shift.id]: e.target.value }))} />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                        </div>
                        <Button size="sm" className="h-8 px-2" onClick={() => handleAddToShift(shift.id)}
                          disabled={!newEmp[shift.id] || !newPct[shift.id] || egLoading}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <>
                {periodEmployeeGoals.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum colaborador vinculado.</p>
                )}
                {periodEmployeeGoals.map(eg => (
                  <div key={eg.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                    <span>{getUserName(eg.employeeId)}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{(eg.fraction * 100).toFixed(0)}% — R$ {eg.targetValue.toFixed(2)}</Badge>
                      <button onClick={() => deleteEmployeeGoal(eg.id)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {availableUsersLegacy.length > 0 && (
                  <div className="flex gap-2 pt-2 border-t">
                    <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Colaborador" /></SelectTrigger>
                      <SelectContent>{availableUsersLegacy.map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input className="w-24" type="number" step="0.01" min="0.01" max="1" placeholder="0.50"
                      value={fraction} onChange={e => setFraction(e.target.value)} />
                    <Button onClick={handleAddLegacy} disabled={!selectedEmployee || !fraction || egLoading}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button onClick={handleSavePeriod} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
