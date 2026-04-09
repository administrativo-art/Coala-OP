"use client";

import { useState, useMemo } from 'react';
import { Timestamp } from 'firebase/firestore';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { ProductSimulationContext } from '@/components/product-simulation-provider';
import { useContext } from 'react';
import { type GoalShift, type GoalType } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ChevronRight, ChevronLeft, Plus, X } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthToDateRange(monthStr: string): { start: Date; end: Date } {
  const [year, month] = monthStr.split('-').map(Number);
  const start = startOfMonth(new Date(year, month - 1, 1));
  return { start, end: endOfMonth(start) };
}

function ordinalLabel(n: number): string {
  const ordinals = ['1º', '2º', '3º', '4º', '5º', '6º', '7º', '8º', '9º', '10º'];
  return `${ordinals[n] ?? `${n + 1}º`} Turno`;
}

const GOAL_TYPE_OPTIONS: { type: GoalType; label: string; description: string }[] = [
  { type: 'revenue', label: 'Faturamento', description: 'Meta de receita total com turnos e colaboradores' },
  { type: 'ticket', label: 'Ticket Médio', description: 'Meta global do quiosque (faturamento ÷ cupons)' },
  { type: 'product_line', label: 'Linha de Produto', description: 'Meta por categoria (milkshake, açaí, casquinha…)' },
  { type: 'product_specific', label: 'Produto Específico', description: 'Meta para um produto individual' },
];

interface ShiftDraft {
  id: string;
  label: string;
  pct: string;
}

interface EmployeeAssignment {
  shiftId: string;
  employeeId: string;
  pct: string;
}

// Per-type config data
interface RevenueConfig {
  targetValue: number;
  upValue: number;
}
interface TicketConfig {
  targetValue: number;
}
interface ProductLineConfig {
  lineId: string;
  lineName: string;
  targetValue: number;
  upValue: number;
}
interface ProductSpecificConfig {
  productId: string;
  productName: string;
  targetValue: number;
  upValue: number;
}

type RevenueAllocationMode = 'shifts' | 'direct';

// Wizard step identifiers
type WizardStepId =
  | 'selection'
  | 'revenue_config'
  | 'revenue_shifts'
  | 'revenue_employees'
  | 'revenue_employees_direct'
  | 'ticket_config'
  | 'product_line_config'
  | 'product_specific_config';

function buildSteps(selectedTypes: Set<GoalType>, allocationMode: RevenueAllocationMode): WizardStepId[] {
  const steps: WizardStepId[] = ['selection'];
  if (selectedTypes.has('revenue')) {
    if (allocationMode === 'shifts') {
      steps.push('revenue_config', 'revenue_shifts', 'revenue_employees');
    } else {
      steps.push('revenue_config', 'revenue_employees_direct');
    }
  }
  if (selectedTypes.has('ticket')) steps.push('ticket_config');
  if (selectedTypes.has('product_line')) steps.push('product_line_config');
  if (selectedTypes.has('product_specific')) steps.push('product_specific_config');
  return steps;
}

const STEP_LABELS: Record<WizardStepId, string> = {
  selection: 'Seleção',
  revenue_config: 'Faturamento',
  revenue_shifts: 'Turnos',
  revenue_employees: 'Colaboradores',
  revenue_employees_direct: 'Colaboradores',
  ticket_config: 'Ticket Médio',
  product_line_config: 'Linha de Produto',
  product_specific_config: 'Produto Específico',
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface GoalTemplateFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GoalTemplateFormModal({ open, onOpenChange }: GoalTemplateFormModalProps) {
  const { addTemplate, addPeriod, addEmployeeGoal } = useGoals();
  const { kiosks } = useKiosks();
  const { user, permissions, users } = useAuth();
  const { toast } = useToast();
  const { categories } = useProductSimulationCategories();
  const simCtx = useContext(ProductSimulationContext);
  const simulations = simCtx?.simulations ?? [];

  const isAdmin = permissions.settings?.manageUsers ?? false;
  const availableKiosks = isAdmin ? kiosks : kiosks.filter(k => user?.assignedKioskIds?.includes(k.id));

  // Product lines from cost & price module
  const productLines = useMemo(() => categories.filter(c => c.type === 'line'), [categories]);

  // ── Global state ──────────────────────────────────────────────────────────
  const [stepIdx, setStepIdx] = useState(0);
  const [kioskId, setKioskId] = useState(availableKiosks[0]?.id ?? '');
  const [month, setMonth] = useState(currentMonthValue());
  const [selectedTypes, setSelectedTypes] = useState<Set<GoalType>>(new Set(['revenue']));

  // ── Revenue state ─────────────────────────────────────────────────────────
  const [revenueConfig, setRevenueConfig] = useState<RevenueConfig>({ targetValue: 0, upValue: 0 });
  const [revenueConfigError, setRevenueConfigError] = useState('');
  const [revenueAllocationMode, setRevenueAllocationMode] = useState<RevenueAllocationMode>('shifts');

  // Modo por turno
  const [shifts, setShifts] = useState<ShiftDraft[]>([
    { id: 'shift-0', label: '1º Turno', pct: '50' },
    { id: 'shift-1', label: '2º Turno', pct: '50' },
  ]);
  const [assignments, setAssignments] = useState<EmployeeAssignment[]>([]);
  const [newEmp, setNewEmp] = useState<Record<string, string>>({});
  const [newPct, setNewPct] = useState<Record<string, string>>({});

  // Modo direto por colaborador
  const [directAssignments, setDirectAssignments] = useState<{ employeeId: string; pct: string }[]>([]);
  const [newDirectEmp, setNewDirectEmp] = useState('');
  const [newDirectPct, setNewDirectPct] = useState('');

  const steps = useMemo(() => buildSteps(selectedTypes, revenueAllocationMode), [selectedTypes, revenueAllocationMode]);
  const currentStep = steps[stepIdx];

  // ── Ticket state ──────────────────────────────────────────────────────────
  const [ticketConfig, setTicketConfig] = useState<TicketConfig>({ targetValue: 0 });
  const [ticketError, setTicketError] = useState('');

  // ── Product line state ────────────────────────────────────────────────────
  const [productLineConfig, setProductLineConfig] = useState<Partial<ProductLineConfig>>({});
  const [productLineError, setProductLineError] = useState('');

  // ── Product specific state ────────────────────────────────────────────────
  const [productSpecificConfig, setProductSpecificConfig] = useState<Partial<ProductSpecificConfig>>({});
  const [productSpecificError, setProductSpecificError] = useState('');

  const [saving, setSaving] = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────────

  const kioskUsers = useMemo(() =>
    users.filter(u => {
      if (!kioskId) return false;
      return u.participatesInGoals === true || u.assignedKioskIds?.includes(kioskId);
    }),
    [users, kioskId]
  );

  const pctSum = shifts.reduce((s, sh) => s + (parseFloat(sh.pct) || 0), 0);
  const pctSumOk = Math.abs(pctSum - 100) < 0.01;

  // ── Helpers modo direto ───────────────────────────────────────────────────

  const directAllocatedPct = directAssignments.reduce((s, a) => s + (parseFloat(a.pct) || 0), 0);
  const availableUsersForDirect = kioskUsers.filter(u => !directAssignments.some(a => a.employeeId === u.id));

  function addDirectAssignment() {
    if (!newDirectEmp || !newDirectPct) return;
    const pctNum = parseFloat(newDirectPct);
    if (isNaN(pctNum) || pctNum <= 0 || pctNum > 100) {
      toast({ title: 'Porcentagem inválida', variant: 'destructive' });
      return;
    }
    setDirectAssignments(prev => [...prev, { employeeId: newDirectEmp, pct: newDirectPct }]);
    setNewDirectEmp('');
    setNewDirectPct('');
  }

  function removeDirectAssignment(employeeId: string) {
    setDirectAssignments(prev => prev.filter(a => a.employeeId !== employeeId));
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function handleNext() {
    if (currentStep === 'selection') {
      if (!kioskId || !month || selectedTypes.size === 0) return;
      setStepIdx(1);
      return;
    }
    if (currentStep === 'revenue_config') {
      if (revenueConfig.targetValue <= 0) { setRevenueConfigError('Meta alvo deve ser maior que zero'); return; }
      if (revenueConfig.upValue <= revenueConfig.targetValue) { setRevenueConfigError('Meta UP deve ser maior que a Meta alvo'); return; }
      setRevenueConfigError('');
      setStepIdx(i => i + 1);
      return;
    }
    if (currentStep === 'revenue_shifts') {
      if (!pctSumOk) return;
      const defaults: Record<string, string> = {};
      shifts.forEach(s => { defaults[s.id] = '100'; });
      setNewPct(defaults);
      setStepIdx(i => i + 1);
      return;
    }
    if (currentStep === 'revenue_employees' || currentStep === 'revenue_employees_direct') {
      setStepIdx(i => i + 1);
      return;
    }
    if (currentStep === 'ticket_config') {
      if (ticketConfig.targetValue <= 0) { setTicketError('Valor deve ser maior que zero'); return; }
      setTicketError('');
      setStepIdx(i => i + 1);
      return;
    }
    if (currentStep === 'product_line_config') {
      if (!productLineConfig.lineId) { setProductLineError('Selecione uma linha de produto'); return; }
      if (!productLineConfig.targetValue || productLineConfig.targetValue <= 0) { setProductLineError('Meta alvo deve ser maior que zero'); return; }
      if (!productLineConfig.upValue || productLineConfig.upValue <= (productLineConfig.targetValue ?? 0)) { setProductLineError('Meta UP deve ser maior que a Meta alvo'); return; }
      setProductLineError('');
      setStepIdx(i => i + 1);
      return;
    }
    if (currentStep === 'product_specific_config') {
      if (!productSpecificConfig.productId) { setProductSpecificError('Selecione um produto'); return; }
      if (!productSpecificConfig.targetValue || productSpecificConfig.targetValue <= 0) { setProductSpecificError('Meta alvo deve ser maior que zero'); return; }
      if (!productSpecificConfig.upValue || productSpecificConfig.upValue <= (productSpecificConfig.targetValue ?? 0)) { setProductSpecificError('Meta UP deve ser maior que a Meta alvo'); return; }
      setProductSpecificError('');
      setStepIdx(i => i + 1);
    }
  }

  function handleBack() {
    setStepIdx(i => Math.max(0, i - 1));
  }

  const isLastStep = stepIdx === steps.length - 1;

  // ── Shift helpers ─────────────────────────────────────────────────────────

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

  function assignmentsForShift(shiftId: string) {
    return assignments.filter(a => a.shiftId === shiftId);
  }

  function allocatedPct(shiftId: string) {
    return assignments.filter(a => a.shiftId === shiftId).reduce((s, a) => s + (parseFloat(a.pct) || 0), 0);
  }

  function availableUsersForShift(shiftId: string) {
    return kioskUsers.filter(u => !assignmentsForShift(shiftId).some(a => a.employeeId === u.id));
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
    setNewPct(prev => ({ ...prev, [shiftId]: '100' }));
  }

  function removeAssignment(shiftId: string, empId: string) {
    setAssignments(prev => prev.filter(a => !(a.shiftId === shiftId && a.employeeId === empId)));
  }

  const getUserName = (id: string) => users.find(u => u.id === id)?.username ?? id;

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setSaving(true);
    const { start, end } = monthToDateRange(month);
    let hasError = false;

    // Auto-confirm linhas não adicionadas (modo turnos)
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
    // Auto-confirm linha não adicionada (modo direto)
    const finalDirectAssignments = [...directAssignments];
    if (newDirectEmp && newDirectPct) {
      const pctNum = parseFloat(newDirectPct);
      if (!isNaN(pctNum) && pctNum > 0 && pctNum <= 100 &&
          !finalDirectAssignments.some(a => a.employeeId === newDirectEmp)) {
        finalDirectAssignments.push({ employeeId: newDirectEmp, pct: newDirectPct });
      }
    }

    // ── Revenue ──
    if (selectedTypes.has('revenue')) {
      const templateId = await addTemplate({
        kioskId,
        type: 'revenue',
        period: 'monthly',
        targetValue: revenueConfig.targetValue,
        upValue: revenueConfig.upValue,
      });

      if (templateId) {
        if (revenueAllocationMode === 'shifts') {
          const goalShifts: GoalShift[] = shifts.map(s => ({
            id: s.id, label: s.label, fraction: (parseFloat(s.pct) || 0) / 100,
          }));
          const periodId = await addPeriod({
            templateId, kioskId,
            startDate: Timestamp.fromDate(start),
            endDate: Timestamp.fromDate(end),
            targetValue: revenueConfig.targetValue,
            upValue: revenueConfig.upValue,
            currentValue: 0, dailyProgress: {},
            shifts: goalShifts, status: 'active',
          });
          if (periodId) {
            for (const a of finalAssignments) {
              const shift = goalShifts.find(s => s.id === a.shiftId);
              if (!shift) continue;
              const withinFraction = (parseFloat(a.pct) || 0) / 100;
              await addEmployeeGoal({
                periodId, employeeId: a.employeeId, kioskId,
                shiftId: a.shiftId, fraction: withinFraction,
                targetValue: revenueConfig.targetValue * shift.fraction * withinFraction,
                currentValue: 0, dailyProgress: {},
              });
            }
          } else hasError = true;
        } else {
          // Modo direto: sem turnos
          const periodId = await addPeriod({
            templateId, kioskId,
            startDate: Timestamp.fromDate(start),
            endDate: Timestamp.fromDate(end),
            targetValue: revenueConfig.targetValue,
            upValue: revenueConfig.upValue,
            currentValue: 0, dailyProgress: {},
            shifts: [], status: 'active',
          });
          if (periodId) {
            for (const a of finalDirectAssignments) {
              const fraction = (parseFloat(a.pct) || 0) / 100;
              await addEmployeeGoal({
                periodId, employeeId: a.employeeId, kioskId,
                fraction,
                targetValue: revenueConfig.targetValue * fraction,
                currentValue: 0, dailyProgress: {},
              });
            }
          } else hasError = true;
        }
      } else hasError = true;
    }

    // ── Ticket Médio ──
    if (selectedTypes.has('ticket')) {
      const templateId = await addTemplate({
        kioskId,
        type: 'ticket',
        period: 'monthly',
        targetValue: ticketConfig.targetValue,
        upValue: ticketConfig.targetValue, // no UP concept, same value
      });

      if (templateId) {
        const ok = await addPeriod({
          templateId,
          kioskId,
          startDate: Timestamp.fromDate(start),
          endDate: Timestamp.fromDate(end),
          targetValue: ticketConfig.targetValue,
          upValue: ticketConfig.targetValue,
          currentValue: 0,
          dailyProgress: {},
          shifts: [],
          status: 'active',
        });
        if (!ok) hasError = true;
      } else hasError = true;
    }

    // ── Product Line ──
    if (selectedTypes.has('product_line') && productLineConfig.lineId) {
      const templateId = await addTemplate({
        kioskId,
        type: 'product_line',
        period: 'monthly',
        targetValue: productLineConfig.targetValue!,
        upValue: productLineConfig.upValue!,
        productLineRef: productLineConfig.lineId,
        productLineName: productLineConfig.lineName,
      });

      if (templateId) {
        const ok = await addPeriod({
          templateId,
          kioskId,
          startDate: Timestamp.fromDate(start),
          endDate: Timestamp.fromDate(end),
          targetValue: productLineConfig.targetValue!,
          upValue: productLineConfig.upValue!,
          currentValue: 0,
          dailyProgress: {},
          shifts: [],
          status: 'active',
        });
        if (!ok) hasError = true;
      } else hasError = true;
    }

    // ── Product Specific ──
    if (selectedTypes.has('product_specific') && productSpecificConfig.productId) {
      const templateId = await addTemplate({
        kioskId,
        type: 'product_specific',
        period: 'monthly',
        targetValue: productSpecificConfig.targetValue!,
        upValue: productSpecificConfig.upValue!,
        productRef: productSpecificConfig.productId,
        productName: productSpecificConfig.productName,
      });

      if (templateId) {
        const ok = await addPeriod({
          templateId,
          kioskId,
          startDate: Timestamp.fromDate(start),
          endDate: Timestamp.fromDate(end),
          targetValue: productSpecificConfig.targetValue!,
          upValue: productSpecificConfig.upValue!,
          currentValue: 0,
          dailyProgress: {},
          shifts: [],
          status: 'active',
        });
        if (!ok) hasError = true;
      } else hasError = true;
    }

    if (hasError) {
      toast({ title: 'Alguns itens não foram salvos', description: 'Verifique as permissões e tente novamente.', variant: 'destructive' });
    } else {
      toast({ title: `${selectedTypes.size} meta(s) criada(s) com sucesso.` });
    }
    handleClose();
    setSaving(false);
  }

  function handleClose() {
    onOpenChange(false);
    setStepIdx(0);
    setKioskId(availableKiosks[0]?.id ?? '');
    setMonth(currentMonthValue());
    setSelectedTypes(new Set(['revenue']));
    setRevenueConfig({ targetValue: 0, upValue: 0 });
    setRevenueConfigError('');
    setRevenueAllocationMode('shifts');
    setShifts([
      { id: 'shift-0', label: '1º Turno', pct: '50' },
      { id: 'shift-1', label: '2º Turno', pct: '50' },
    ]);
    setAssignments([]);
    setNewEmp({});
    setNewPct({});
    setDirectAssignments([]);
    setNewDirectEmp('');
    setNewDirectPct('');
    setTicketConfig({ targetValue: 0 });
    setTicketError('');
    setProductLineConfig({});
    setProductLineError('');
    setProductSpecificConfig({});
    setProductSpecificError('');
  }

  function toggleType(type: GoalType) {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) { next.delete(type); } else { next.add(type); }
      return next;
    });
  }

  // ── Step label bar ────────────────────────────────────────────────────────

  const visibleStepLabels = steps.map(s => STEP_LABELS[s]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova meta</DialogTitle>
          <DialogDescription asChild>
            <span className="flex flex-wrap gap-1 mt-1">
              {visibleStepLabels.map((label, i) => (
                <span key={i} className={`flex items-center gap-1 text-xs ${i === stepIdx ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs ${i === stepIdx ? 'bg-primary text-primary-foreground' : i < stepIdx ? 'bg-primary/30 text-primary' : 'bg-muted'}`}>{i + 1}</span>
                  {label}
                  {i < visibleStepLabels.length - 1 && <span className="text-muted-foreground/40 mx-0.5">›</span>}
                </span>
              ))}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* ── STEP: SELECTION ── */}
        {currentStep === 'selection' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Quiosque</Label>
              <Select value={kioskId} onValueChange={setKioskId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{availableKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Mês de referência</Label>
              <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />
              {month && (() => {
                try {
                  const { start, end } = monthToDateRange(month);
                  return <p className="text-xs text-muted-foreground">{format(start, 'dd/MM/yyyy')} até {format(end, 'dd/MM/yyyy')}</p>;
                } catch { return null; }
              })()}
            </div>

            <div className="space-y-2">
              <Label>Tipos de meta</Label>
              <div className="space-y-2 rounded-lg border p-3">
                {GOAL_TYPE_OPTIONS.map(opt => (
                  <div key={opt.type} className="flex items-start gap-3">
                    <Checkbox
                      id={`type-${opt.type}`}
                      checked={selectedTypes.has(opt.type)}
                      onCheckedChange={() => toggleType(opt.type)}
                      className="mt-0.5"
                    />
                    <label htmlFor={`type-${opt.type}`} className="cursor-pointer space-y-0.5">
                      <div className="text-sm font-medium leading-none">{opt.label}</div>
                      <div className="text-xs text-muted-foreground">{opt.description}</div>
                    </label>
                  </div>
                ))}
              </div>
              {selectedTypes.size === 0 && (
                <p className="text-xs text-destructive">Selecione ao menos um tipo de meta</p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button disabled={!kioskId || !month || selectedTypes.size === 0} onClick={handleNext}>
                Próximo <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── STEP: REVENUE CONFIG ── */}
        {currentStep === 'revenue_config' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Meta alvo</Label>
                <CurrencyInput
                  value={revenueConfig.targetValue}
                  onChange={v => setRevenueConfig(prev => ({ ...prev, targetValue: v }))}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Meta UP</Label>
                <CurrencyInput
                  value={revenueConfig.upValue}
                  onChange={v => setRevenueConfig(prev => ({ ...prev, upValue: v }))}
                  placeholder="0,00"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Distribuição da meta</Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'shifts', label: 'Por turno', desc: 'Define % por turno e depois vincula colaboradores a cada turno' },
                  { value: 'direct', label: 'Por colaborador', desc: 'Vincula colaboradores diretamente com % da meta total' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRevenueAllocationMode(opt.value)}
                    className={`rounded-lg border p-3 text-left transition-colors ${revenueAllocationMode === opt.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${revenueAllocationMode === opt.value ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
                      <span className="text-sm font-medium">{opt.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {revenueConfigError && <p className="text-xs text-destructive">{revenueConfigError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
              <Button onClick={handleNext}>Próximo <ChevronRight className="ml-1 h-4 w-4" /></Button>
            </DialogFooter>
          </div>
        )}

        {/* ── STEP: REVENUE SHIFTS ── */}
        {currentStep === 'revenue_shifts' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Quantos turnos?</span>
              <Select value={String(shifts.length)} onValueChange={v => handleShiftCountChange(parseInt(v))}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4, 5].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              {shifts.map(shift => (
                <div key={shift.id} className="flex items-center gap-3">
                  <span className="text-sm w-24 shrink-0">{shift.label}</span>
                  <div className="relative flex-1">
                    <Input
                      type="number" min="0" max="100" step="0.1" placeholder="0"
                      className="pr-8"
                      value={shift.pct}
                      onChange={e => setShifts(prev => prev.map(s => s.id === shift.id ? { ...s, pct: e.target.value } : s))}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                  </div>
                  <span className="text-xs text-muted-foreground w-28 text-right shrink-0">
                    = R$ {((parseFloat(shift.pct) || 0) / 100 * revenueConfig.targetValue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
            </div>

            <div className={`text-sm font-medium ${pctSumOk ? 'text-green-600' : 'text-destructive'}`}>
              Soma: {pctSum.toFixed(1)}%{pctSumOk ? ' ✓' : ` — faltam ${(100 - pctSum).toFixed(1)}%`}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
              <Button disabled={!pctSumOk} onClick={handleNext}>Próximo <ChevronRight className="ml-1 h-4 w-4" /></Button>
            </DialogFooter>
          </div>
        )}

        {/* ── STEP: REVENUE EMPLOYEES ── */}
        {currentStep === 'revenue_employees' && (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {shifts.map(shift => {
              const shiftPct = parseFloat(shift.pct) || 0;
              const shiftTarget = (shiftPct / 100) * revenueConfig.targetValue;
              const shiftAssignments = assignmentsForShift(shift.id);
              const available = availableUsersForShift(shift.id);

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

                  <div className="text-xs text-muted-foreground">
                    Alocado: {allocatedPct(shift.id).toFixed(0)}% deste turno
                  </div>

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
                      <Button size="sm" className="h-8 px-2" onClick={() => addAssignment(shift.id)}
                        disabled={!newEmp[shift.id] || !newPct[shift.id]}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
              {isLastStep
                ? <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
                : <Button onClick={handleNext}>Próximo <ChevronRight className="ml-1 h-4 w-4" /></Button>
              }
            </DialogFooter>
          </div>
        )}

        {/* ── STEP: REVENUE EMPLOYEES DIRECT ── */}
        {currentStep === 'revenue_employees_direct' && (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <p className="text-sm text-muted-foreground">
              Defina o percentual da meta total para cada colaborador.
            </p>

            {directAssignments.length > 0 && (
              <div className="space-y-1.5">
                {directAssignments.map(a => {
                  const fraction = (parseFloat(a.pct) || 0) / 100;
                  const empTarget = revenueConfig.targetValue * fraction;
                  return (
                    <div key={a.employeeId} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                      <span className="font-medium">{getUserName(a.employeeId)}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{parseFloat(a.pct).toFixed(0)}%</Badge>
                        <span className="text-xs text-muted-foreground">R$ {empTarget.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                        <button onClick={() => removeDirectAssignment(a.employeeId)} className="text-muted-foreground hover:text-destructive">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground pt-0.5">
                  Total alocado: <strong>{directAllocatedPct.toFixed(1)}%</strong>
                  {' '}(R$ {(revenueConfig.targetValue * directAllocatedPct / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})
                </p>
              </div>
            )}

            {availableUsersForDirect.length > 0 && (
              <div className="flex gap-2 border-t pt-3">
                <Select value={newDirectEmp} onValueChange={setNewDirectEmp}>
                  <SelectTrigger className="flex-1 h-9 text-sm"><SelectValue placeholder="Colaborador" /></SelectTrigger>
                  <SelectContent>{availableUsersForDirect.map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}</SelectContent>
                </Select>
                <div className="relative w-24">
                  <Input
                    className="h-9 text-sm pr-7"
                    type="number" min="1" max="100" placeholder="50"
                    value={newDirectPct}
                    onChange={e => setNewDirectPct(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addDirectAssignment(); }}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                </div>
                <Button size="sm" className="h-9 px-2" onClick={addDirectAssignment} disabled={!newDirectEmp || !newDirectPct}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}

            {directAssignments.length === 0 && availableUsersForDirect.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">Nenhum colaborador disponível.</p>
            )}

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
              {isLastStep
                ? <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
                : <Button onClick={handleNext}>Próximo <ChevronRight className="ml-1 h-4 w-4" /></Button>
              }
            </DialogFooter>
          </div>
        )}

        {/* ── STEP: TICKET CONFIG ── */}
        {currentStep === 'ticket_config' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Meta global do quiosque. Calculada como faturamento total ÷ número de cupons. Não vinculada a colaboradores.
            </p>
            <div className="space-y-1.5">
              <Label>Ticket Médio Alvo (R$)</Label>
              <CurrencyInput
                value={ticketConfig.targetValue}
                onChange={v => setTicketConfig({ targetValue: v })}
                placeholder="0,00"
              />
            </div>
            {ticketError && <p className="text-xs text-destructive">{ticketError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
              {isLastStep
                ? <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
                : <Button onClick={handleNext}>Próximo <ChevronRight className="ml-1 h-4 w-4" /></Button>
              }
            </DialogFooter>
          </div>
        )}

        {/* ── STEP: PRODUCT LINE CONFIG ── */}
        {currentStep === 'product_line_config' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Selecione a linha de produto e defina os valores. Dados carregados do módulo de custo e preço.
            </p>
            <div className="space-y-1.5">
              <Label>Linha de produto</Label>
              <Select
                value={productLineConfig.lineId ?? ''}
                onValueChange={v => {
                  const line = productLines.find(l => l.id === v);
                  setProductLineConfig(prev => ({ ...prev, lineId: v, lineName: line?.name ?? '' }));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione a linha" /></SelectTrigger>
                <SelectContent>
                  {productLines.length === 0
                    ? <SelectItem value="_empty" disabled>Nenhuma linha cadastrada</SelectItem>
                    : productLines.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)
                  }
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Meta alvo (R$)</Label>
                <CurrencyInput
                  value={productLineConfig.targetValue ?? 0}
                  onChange={v => setProductLineConfig(prev => ({ ...prev, targetValue: v }))}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Meta UP (R$)</Label>
                <CurrencyInput
                  value={productLineConfig.upValue ?? 0}
                  onChange={v => setProductLineConfig(prev => ({ ...prev, upValue: v }))}
                  placeholder="0,00"
                />
              </div>
            </div>
            {productLineError && <p className="text-xs text-destructive">{productLineError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
              {isLastStep
                ? <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
                : <Button onClick={handleNext}>Próximo <ChevronRight className="ml-1 h-4 w-4" /></Button>
              }
            </DialogFooter>
          </div>
        )}

        {/* ── STEP: PRODUCT SPECIFIC CONFIG ── */}
        {currentStep === 'product_specific_config' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Selecione o produto e defina os valores. Dados carregados do módulo de custo e preço.
            </p>
            <div className="space-y-1.5">
              <Label>Produto</Label>
              <Select
                value={productSpecificConfig.productId ?? ''}
                onValueChange={v => {
                  const sim = simulations.find(s => s.id === v);
                  setProductSpecificConfig(prev => ({ ...prev, productId: v, productName: sim?.name ?? '' }));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione o produto" /></SelectTrigger>
                <SelectContent>
                  {simulations.length === 0
                    ? <SelectItem value="_empty" disabled>Nenhum produto cadastrado</SelectItem>
                    : simulations.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)
                  }
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Meta alvo (R$)</Label>
                <CurrencyInput
                  value={productSpecificConfig.targetValue ?? 0}
                  onChange={v => setProductSpecificConfig(prev => ({ ...prev, targetValue: v }))}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Meta UP (R$)</Label>
                <CurrencyInput
                  value={productSpecificConfig.upValue ?? 0}
                  onChange={v => setProductSpecificConfig(prev => ({ ...prev, upValue: v }))}
                  placeholder="0,00"
                />
              </div>
            </div>
            {productSpecificError && <p className="text-xs text-destructive">{productSpecificError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
              <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
