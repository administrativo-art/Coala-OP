"use client";

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Timestamp } from 'firebase/firestore';
import { startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { format } from 'date-fns';
import { useGoals } from '@/contexts/goals-context';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { type GoalTemplate, type GoalShift } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, ChevronLeft, Plus, X } from 'lucide-react';

// ─── Step 1 schema ────────────────────────────────────────────────────────────

const step1Schema = z.object({
  // "yyyy-MM" — e.g. "2026-03"
  month: z.string().min(1, 'Selecione o mês'),
  targetValue: z.number().min(0.01, 'Valor deve ser maior que zero'),
  upValue: z.number().min(0.01, 'Valor deve ser maior que zero'),
}).refine(d => d.upValue > d.targetValue, {
  message: 'Meta UP deve ser maior que a Meta Alvo',
  path: ['upValue'],
});

type Step1Values = z.infer<typeof step1Schema>;

// ─── Shift state ──────────────────────────────────────────────────────────────

interface ShiftDraft {
  id: string;
  label: string;
  pct: string; // string for input, converted to number on submit
}

interface EmployeeAssignment {
  shiftId: string;
  employeeId: string;
  pct: string; // % within the shift
}

function ordinalLabel(n: number): string {
  const ordinals = ['1º', '2º', '3º', '4º', '5º', '6º', '7º', '8º', '9º', '10º'];
  return `${ordinals[n] ?? `${n + 1}º`} Turno`;
}

function monthToDateRange(monthStr: string): { start: Date; end: Date } {
  // monthStr = "yyyy-MM"
  const [year, month] = monthStr.split('-').map(Number);
  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(start);
  return { start, end };
}

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface InstantiateGoalPeriodModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: GoalTemplate | null;
  onPeriodCreated: (periodId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InstantiateGoalPeriodModal({ open, onOpenChange, template, onPeriodCreated }: InstantiateGoalPeriodModalProps) {
  const { addPeriod, addEmployeeGoal } = useGoals();
  const { users } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [step1Data, setStep1Data] = useState<Step1Values | null>(null);
  const [shifts, setShifts] = useState<ShiftDraft[]>([
    { id: 'shift-0', label: '1º Turno', pct: '50' },
    { id: 'shift-1', label: '2º Turno', pct: '50' },
  ]);
  const [assignments, setAssignments] = useState<EmployeeAssignment[]>([]);
  const [saving, setSaving] = useState(false);

  // New assignment row state per shift
  const [newEmp, setNewEmp] = useState<Record<string, string>>({});
  const [newPct, setNewPct] = useState<Record<string, string>>({});

  const form = useForm<Step1Values>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      month: currentMonthValue(),
      targetValue: template?.targetValue ?? 0,
      upValue: template?.upValue ?? 0,
    },
  });

  const kioskUsers = useMemo(() =>
    users.filter(u => template && u.assignedKioskIds?.includes(template.kioskId)),
    [users, template]
  );

  // ── Step 2 helpers ──────────────────────────────────────────────────────────

  const shiftCount = shifts.length;
  const pctSum = shifts.reduce((s, sh) => s + (parseFloat(sh.pct) || 0), 0);
  const pctSumOk = Math.abs(pctSum - 100) < 0.01;

  function handleShiftCountChange(count: number) {
    setShifts(prev => {
      if (count <= 0) return prev;
      if (count > prev.length) {
        const next = [...prev];
        while (next.length < count) {
          next.push({ id: `shift-${next.length}`, label: ordinalLabel(next.length), pct: '' });
        }
        return next;
      }
      return prev.slice(0, count);
    });
  }

  function updateShiftPct(id: string, pct: string) {
    setShifts(prev => prev.map(s => s.id === id ? { ...s, pct } : s));
  }

  // ── Step 3 helpers ──────────────────────────────────────────────────────────

  function assignmentsForShift(shiftId: string) {
    return assignments.filter(a => a.shiftId === shiftId);
  }

  function allocatedPct(shiftId: string) {
    return assignments
      .filter(a => a.shiftId === shiftId)
      .reduce((s, a) => s + (parseFloat(a.pct) || 0), 0);
  }

  function addAssignment(shiftId: string) {
    const empId = newEmp[shiftId];
    const pct = newPct[shiftId];
    if (!empId || !pct) return;
    const pctNum = parseFloat(pct);
    if (isNaN(pctNum) || pctNum <= 0 || pctNum > 100) {
      toast({ title: 'Porcentagem inválida', variant: 'destructive' });
      return;
    }
    if (assignments.some(a => a.shiftId === shiftId && a.employeeId === empId)) {
      toast({ title: 'Colaborador já adicionado neste turno', variant: 'destructive' });
      return;
    }
    setAssignments(prev => [...prev, { shiftId, employeeId: empId, pct }]);
    setNewEmp(prev => ({ ...prev, [shiftId]: '' }));
    setNewPct(prev => ({ ...prev, [shiftId]: '' }));
  }

  function removeAssignment(shiftId: string, empId: string) {
    setAssignments(prev => prev.filter(a => !(a.shiftId === shiftId && a.employeeId === empId)));
  }

  function availableUsers(shiftId: string) {
    return kioskUsers.filter(u => !assignments.some(a => a.shiftId === shiftId && a.employeeId === u.id));
  }

  const getUserName = (id: string) => users.find(u => u.id === id)?.username ?? id;

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function submitCore(data: Step1Values, usedShifts: ShiftDraft[], usedAssignments: EmployeeAssignment[]) {
    if (!template) return;
    setSaving(true);

    const { start, end } = monthToDateRange(data.month);
    const goalShifts: GoalShift[] = usedShifts.map(s => ({
      id: s.id, label: s.label, fraction: (parseFloat(s.pct) || 0) / 100,
    }));

    const periodId = await addPeriod({
      templateId: template.id,
      kioskId: template.kioskId,
      startDate: Timestamp.fromDate(start),
      endDate: Timestamp.fromDate(end),
      targetValue: data.targetValue,
      upValue: data.upValue,
      currentValue: 0,
      dailyProgress: {},
      shifts: goalShifts,
      status: 'active',
    });

    if (!periodId) {
      toast({ title: 'Erro ao criar período', variant: 'destructive' });
      setSaving(false);
      return;
    }

    let savedCount = 0;
    let failCount = 0;
    for (const a of usedAssignments) {
      const shift = goalShifts.find(s => s.id === a.shiftId);
      if (!shift) continue;
      const withinFraction = (parseFloat(a.pct) || 0) / 100;
      const egId = await addEmployeeGoal({
        periodId, employeeId: a.employeeId, kioskId: template.kioskId,
        shiftId: a.shiftId, fraction: withinFraction,
        targetValue: data.targetValue * shift.fraction * withinFraction,
        currentValue: 0, dailyProgress: {},
      });
      if (egId) savedCount++; else failCount++;
    }

    if (failCount > 0) {
      toast({ title: `Período criado, mas ${failCount} colaborador(es) não foram salvos.`, description: 'Verifique as permissões e tente adicionar pelo botão de colaboradores.', variant: 'destructive' });
    } else {
      toast({ title: 'Período criado com sucesso.', description: savedCount > 0 ? `${savedCount} colaborador(es) vinculado(s).` : undefined });
    }
    onPeriodCreated(periodId);
    handleClose();
    setSaving(false);
  }

  async function handleSubmit() {
    if (!step1Data) return;
    // Auto-confirmar inputs preenchidos mas não adicionados via "+"
    const finalAssignments = [...assignments];
    for (const shift of shifts) {
      const empId = newEmp[shift.id];
      const pct = newPct[shift.id];
      if (empId && pct) {
        const pctNum = parseFloat(pct);
        if (!isNaN(pctNum) && pctNum > 0 && pctNum <= 100 &&
            !finalAssignments.some(a => a.shiftId === shift.id && a.employeeId === empId)) {
          finalAssignments.push({ shiftId: shift.id, employeeId: empId, pct });
        }
      }
    }
    await submitCore(step1Data, shifts, finalAssignments);
  }

  function handleClose() {
    onOpenChange(false);
    setStep(1);
    setStep1Data(null);
    setShifts([
      { id: 'shift-0', label: '1º Turno', pct: '50' },
      { id: 'shift-1', label: '2º Turno', pct: '50' },
    ]);
    setAssignments([]);
    setNewEmp({});
    setNewPct({});
    form.reset({
      month: currentMonthValue(),
      targetValue: template?.targetValue ?? 0,
      upValue: template?.upValue ?? 0,
    });
  }

  // ── Step indicator ──────────────────────────────────────────────────────────

  const stepLabels = ['Dados', 'Turnos', 'Colaboradores'];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Instanciar Período</DialogTitle>
          <DialogDescription>
            <span className="flex gap-1 mt-1">
              {stepLabels.map((label, i) => (
                <span key={i} className={`flex items-center gap-1 text-xs ${i + 1 === step ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs ${i + 1 === step ? 'bg-primary text-primary-foreground' : i + 1 < step ? 'bg-primary/30 text-primary' : 'bg-muted'}`}>{i + 1}</span>
                  {label}
                  {i < stepLabels.length - 1 && <span className="text-muted-foreground/40 mx-1">›</span>}
                </span>
              ))}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* ── PASSO 1 ── */}
        {step === 1 && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(values => { setStep1Data(values); setStep(2); })} className="space-y-4">
              <FormField control={form.control} name="month" render={({ field }) => (
                <FormItem>
                  <FormLabel>Mês de referência</FormLabel>
                  <FormControl><Input type="month" {...field} /></FormControl>
                  <FormMessage />
                  {field.value && (
                    <p className="text-xs text-muted-foreground">
                      {(() => {
                        try {
                          const { start, end } = monthToDateRange(field.value);
                          return `${format(start, "dd/MM/yyyy")} até ${format(end, "dd/MM/yyyy")}`;
                        } catch { return ''; }
                      })()}
                    </p>
                  )}
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="targetValue" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Meta Alvo</FormLabel>
                    <FormControl>
                      <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0,00" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="upValue" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Meta UP</FormLabel>
                    <FormControl>
                      <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0,00" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleClose}>Cancelar</Button>
                <Button type="submit">Próximo <ChevronRight className="ml-1 h-4 w-4" /></Button>
              </DialogFooter>
            </form>
          </Form>
        )}

        {/* ── PASSO 2 ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Quantos turnos?</span>
              <Select value={String(shiftCount)} onValueChange={v => handleShiftCountChange(parseInt(v))}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map(n => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              {shifts.map((shift, i) => (
                <div key={shift.id} className="flex items-center gap-3">
                  <span className="text-sm w-24 shrink-0">{shift.label}</span>
                  <div className="relative flex-1">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      placeholder="0"
                      className="pr-8"
                      value={shift.pct}
                      onChange={e => updateShiftPct(shift.id, e.target.value)}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                  </div>
                  {step1Data && (
                    <span className="text-xs text-muted-foreground w-28 text-right shrink-0">
                      = R$ {((parseFloat(shift.pct) || 0) / 100 * step1Data.targetValue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className={`text-sm font-medium ${pctSumOk ? 'text-green-600' : 'text-destructive'}`}>
              Soma: {pctSum.toFixed(1)}%{pctSumOk ? ' ✓' : ` — faltam ${(100 - pctSum).toFixed(1)}%`}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
              <Button disabled={!pctSumOk} onClick={() => setStep(3)}>Próximo <ChevronRight className="ml-1 h-4 w-4" /></Button>
            </DialogFooter>
          </div>
        )}

        {/* ── PASSO 3 ── */}
        {step === 3 && (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {shifts.map(shift => {
              const shiftPct = parseFloat(shift.pct) || 0;
              const shiftTarget = step1Data ? (shiftPct / 100) * step1Data.targetValue : 0;
              const allocated = allocatedPct(shift.id);
              const shiftAssignments = assignmentsForShift(shift.id);
              const available = availableUsers(shift.id);

              return (
                <div key={shift.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{shift.label}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{shiftPct.toFixed(0)}%</Badge>
                      <span className="text-xs text-muted-foreground">
                        Alvo: R$ {shiftTarget.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {shiftAssignments.length > 0 && (
                    <div className="space-y-1">
                      {shiftAssignments.map(a => (
                        <div key={a.employeeId} className="flex items-center justify-between rounded bg-muted/50 px-2 py-1 text-sm">
                          <span>{getUserName(a.employeeId)}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{parseFloat(a.pct).toFixed(0)}% do turno</Badge>
                            <button onClick={() => removeAssignment(shift.id, a.employeeId)} className="text-muted-foreground hover:text-destructive">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className={`text-xs ${allocated > 0 ? 'text-muted-foreground' : 'text-muted-foreground/60'}`}>
                    Alocado: {allocated.toFixed(0)}% deste turno
                  </div>

                  {available.length > 0 && (
                    <div className="flex gap-2 pt-1 border-t">
                      <Select value={newEmp[shift.id] ?? ''} onValueChange={v => setNewEmp(prev => ({ ...prev, [shift.id]: v }))}>
                        <SelectTrigger className="flex-1 h-8 text-sm"><SelectValue placeholder="Colaborador" /></SelectTrigger>
                        <SelectContent>{available.map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}</SelectContent>
                      </Select>
                      <div className="relative w-24">
                        <Input
                          className="h-8 text-sm pr-7"
                          type="number"
                          min="1"
                          max="100"
                          placeholder="50"
                          value={newPct[shift.id] ?? ''}
                          onChange={e => setNewPct(prev => ({ ...prev, [shift.id]: e.target.value }))}
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                      </div>
                      <Button size="sm" className="h-8 px-2" onClick={() => addAssignment(shift.id)} disabled={!newEmp[shift.id] || !newPct[shift.id]}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => setStep(2)}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
              <Button onClick={handleSubmit} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
