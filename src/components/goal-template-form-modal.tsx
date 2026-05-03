"use client";

import { useState, useMemo } from 'react';
import { Timestamp } from 'firebase/firestore';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import { useDPShifts } from '@/hooks/use-dp-shifts';
import { matchDPUnitForKiosk } from '@/lib/dp-kiosk-match';
import { useShiftRevenueSalesReports } from '@/hooks/use-shift-revenue-suggestion';
import { computeShiftSuggestion } from '@/lib/shift-revenue-suggestion';
import { useToast } from '@/hooks/use-toast';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { ProductSimulationContext } from '@/components/product-simulation-provider';
import { useContext } from 'react';
import { type GoalPeriodDoc, type GoalShift, type GoalType } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ChevronRight, ChevronLeft } from 'lucide-react';

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

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
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

// Wizard step identifiers
type WizardStepId =
  | 'selection'
  | 'revenue_config'
  | 'revenue_shifts'
  | 'revenue_shifts_users'
  | 'ticket_config'
  | 'product_line_config'
  | 'product_specific_config';

function buildSteps(selectedTypes: Set<GoalType>): WizardStepId[] {
  const steps: WizardStepId[] = ['selection'];
  if (selectedTypes.has('revenue')) steps.push('revenue_config', 'revenue_shifts', 'revenue_shifts_users');
  if (selectedTypes.has('ticket')) steps.push('ticket_config');
  if (selectedTypes.has('product_line')) steps.push('product_line_config');
  if (selectedTypes.has('product_specific')) steps.push('product_specific_config');
  return steps;
}

const STEP_LABELS: Record<WizardStepId, string> = {
  selection: 'Seleção',
  revenue_config: 'Faturamento',
  revenue_shifts: 'Turnos',
  revenue_shifts_users: 'Colaboradores',
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
  const { addTemplate, addPeriod, addEmployeeGoal, periods, employeeGoals, templates } = useGoals();
  const { kiosks } = useKiosks();
  const { user, permissions, users } = useAuth();
  const { shiftDefinitions, shiftDefsLoading, schedules, units } = useDPBootstrap();
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
  const [copySourceMonth, setCopySourceMonth] = useState('none');
  const [copiedFromMonth, setCopiedFromMonth] = useState('');

  // ── Revenue state ─────────────────────────────────────────────────────────
  const [revenueConfig, setRevenueConfig] = useState<RevenueConfig>({ targetValue: 0, upValue: 0 });
  const [revenueConfigError, setRevenueConfigError] = useState('');
  // Overrides de % por turno digitados pelo usuário (chave = shiftDefinitionId)
  const [shiftPctOverrides, setShiftPctOverrides] = useState<Record<string, string>>({});

  const { reports: revenueSalesReports, loading: revenueSalesLoading } = useShiftRevenueSalesReports(kioskId || null);

  // Mapa de shiftDefinition para lookup rápido
  const shiftDefMap = useMemo(
    () => new Map(shiftDefinitions.map((d) => [d.id, d])),
    [shiftDefinitions]
  );

  const [targetYear, targetMonth] = useMemo(() => {
    if (!month) return [0, 0];
    const [y, m] = month.split('-').map(Number);
    return [y, m];
  }, [month]);

  // Encontra a unidade DP correspondente ao quiosque selecionado (por nome)
  const dpUnitForKiosk = useMemo(() => {
    const kiosk = kiosks.find(k => k.id === kioskId);
    if (!kiosk) return null;
    return matchDPUnitForKiosk(kiosk.name, units) ?? null;
  }, [kiosks, kioskId, units]);

  // Encontra a escala do mês para a unidade DP do quiosque
  const scheduleForKiosk = useMemo(
    () => schedules.find(s =>
      s.month === targetMonth &&
      s.year === targetYear &&
      s.unitId === dpUnitForKiosk?.id
    ) ?? null,
    [schedules, targetMonth, targetYear, dpUnitForKiosk]
  );

  // Carrega os turnos reais da escala do quiosque
  const { shifts: dpShifts, loading: dpShiftsLoading } = useDPShifts(scheduleForKiosk?.id ?? null);

  // IDs dos usuários atribuídos ao quiosque selecionado
  const kioskUserIds = useMemo(() => new Set(
    users
      .filter(u => kioskId && (u.assignedKioskIds?.includes(kioskId) || u.participatesInGoals === true))
      .map(u => u.id)
  ), [users, kioskId]);

  // Filtra apenas os turnos dos colaboradores do quiosque
  const kioskShifts = useMemo(
    () => dpShifts.filter(s => kioskUserIds.has(s.userId)),
    [dpShifts, kioskUserIds]
  );

  // Grupos de colaboradores por turno — derivado dos turnos reais da escala
  const shiftGroups = useMemo(() => {
    const workShifts = kioskShifts.filter(s => s.type === 'work' && s.shiftDefinitionId);

    const byDef = new Map<string, Set<string>>();
    for (const s of workShifts) {
      if (!byDef.has(s.shiftDefinitionId!)) byDef.set(s.shiftDefinitionId!, new Set());
      byDef.get(s.shiftDefinitionId!)!.add(s.userId);
    }

    const sorted = [...byDef.entries()].sort(([aId], [bId]) => {
      const a = shiftDefMap.get(aId)?.startTime ?? '';
      const b = shiftDefMap.get(bId)?.startTime ?? '';
      return a.localeCompare(b);
    });

    return sorted.map(([defId, userIds]) => {
      const def = shiftDefMap.get(defId);
      const label = def ? `${def.name} (${def.startTime}–${def.endTime})` : '—';
      const groupUsers = [...userIds]
        .map(uid => users.find(u => u.id === uid))
        .filter((u): u is NonNullable<typeof u> => u != null);
      return { id: defId, label, users: groupUsers, def: def ?? null };
    });
  }, [kioskShifts, shiftDefMap, users]);

  // Quantidade de dias trabalhados por colaborador em cada turno (da escala real)
  const workedDaysMap = useMemo(() => {
    const map = new Map<string, number>(); // `${defId}:${userId}` → nº de dias
    for (const s of kioskShifts) {
      if (s.type !== 'work' || !s.shiftDefinitionId) continue;
      const key = `${s.shiftDefinitionId}:${s.userId}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [kioskShifts]);

  const shiftSuggestion = useMemo(() => {
    if (revenueSalesLoading || shiftGroups.length === 0 || revenueSalesReports.length === 0) return null;
    const validGroups = shiftGroups.filter(g => g.def != null) as Array<{ id: string; def: NonNullable<(typeof shiftGroups)[0]['def']> }>;
    if (validGroups.length === 0) return null;
    return computeShiftSuggestion(revenueSalesReports, validGroups);
  }, [revenueSalesReports, revenueSalesLoading, shiftGroups]);

  // Derivado puro — nunca fica desatualizado, sem useEffect
  const shifts = useMemo<ShiftDraft[]>(() => {
    if (shiftGroups.length === 0) return [];
    const equalPct = (100 / shiftGroups.length).toFixed(1);
    return shiftGroups.map(g => ({
      id: g.id,
      label: g.label,
      pct: shiftPctOverrides[g.id]
        ?? (shiftSuggestion?.[g.id] != null ? shiftSuggestion[g.id].toFixed(1) : equalPct),
    }));
  }, [shiftGroups, shiftPctOverrides, shiftSuggestion]);

  const assignments = useMemo<EmployeeAssignment[]>(() => {
    const result: EmployeeAssignment[] = [];
    for (const g of shiftGroups) {
      if (g.users.length === 0) continue;
      const totalDays = g.users.reduce((sum, u) => sum + (workedDaysMap.get(`${g.id}:${u.id}`) ?? 0), 0);
      for (const u of g.users) {
        const userDays = workedDaysMap.get(`${g.id}:${u.id}`) ?? 0;
        const pct = totalDays > 0
          ? ((userDays / totalDays) * 100).toFixed(1)
          : (100 / g.users.length).toFixed(1);
        result.push({ shiftId: g.id, employeeId: u.id, pct });
      }
    }
    return result;
  }, [shiftGroups, workedDaysMap]);

  const steps = useMemo(() => buildSteps(selectedTypes), [selectedTypes]);
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

  const pctSum = shifts.reduce((s, sh) => s + (parseFloat(sh.pct) || 0), 0);
  const pctSumOk = Math.abs(pctSum - 100) < 0.01;

  const availableSourceMonths = useMemo(() => {
    const grouped = new Map<string, GoalPeriodDoc[]>();
    periods
      .filter(period => period.kioskId === kioskId)
      .forEach(period => {
        const key = monthKeyFromDate(period.startDate?.toDate?.() ?? new Date());
        if (key === month) return;
        const bucket = grouped.get(key);
        if (bucket) bucket.push(period);
        else grouped.set(key, [period]);
      });

    return Array.from(grouped.entries())
      .map(([key, items]) => ({
        key,
        label: format(items[0]?.startDate?.toDate?.() ?? new Date(), 'MMMM yyyy', { locale: ptBR }),
        items,
      }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [periods, kioskId, month]);

  function applySourceMonth(sourceKey: string) {
    const sourceGroup = availableSourceMonths.find(item => item.key === sourceKey);
    if (!sourceGroup) {
      toast({ title: 'Mês base não encontrado', variant: 'destructive' });
      return;
    }

    const nextTypes = new Set<GoalType>();
    let sourceRevenueLoaded = false;

    setShiftPctOverrides({});
    setProductLineConfig({});
    setProductSpecificConfig({});
    setTicketConfig({ targetValue: 0 });

    for (const period of sourceGroup.items) {
      const template = templates.find(item => item.id === period.templateId);
      if (!template) continue;

      nextTypes.add(template.type);

      if (template.type === 'revenue' && !sourceRevenueLoaded) {
        sourceRevenueLoaded = true;
        setRevenueConfig({
          targetValue: period.targetValue,
          upValue: period.upValue ?? period.targetValue * 1.2,
        });
      }

      if (template.type === 'ticket') {
        setTicketConfig({ targetValue: period.targetValue });
      }

      if (template.type === 'product_line') {
        setProductLineConfig({
          lineId: template.productLineRef,
          lineName: template.productLineName,
          targetValue: period.targetValue,
          upValue: period.upValue,
        });
      }

      if (template.type === 'product_specific') {
        setProductSpecificConfig({
          productId: template.productRef,
          productName: template.productName,
          targetValue: period.targetValue,
          upValue: period.upValue,
        });
      }
    }

    if (nextTypes.size > 0) {
      setSelectedTypes(nextTypes);
      setCopiedFromMonth(sourceKey);
      toast({ title: 'Meta base carregada', description: `Configuração copiada de ${sourceGroup.label}.` });
    } else {
      toast({ title: 'Nenhuma meta aproveitável encontrada', variant: 'destructive' });
    }
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
      setStepIdx(i => i + 1);
      return;
    }
    if (currentStep === 'revenue_shifts_users') {
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

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setSaving(true);
    const { start, end } = monthToDateRange(month);
    let hasError = false;

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
        const goalShifts: GoalShift[] = shifts.map(s => ({
          id: s.id, label: s.label, fraction: (parseFloat(s.pct) || 0) / 100,
        }));
        const periodId = await addPeriod({
          templateId, kioskId,
          startDate: Timestamp.fromDate(start),
          endDate: Timestamp.fromDate(end),
          targetValue: revenueConfig.targetValue,
          upValue: revenueConfig.upValue,
          currentValue: 0, dailyProgress: {}, distributionMode: 'scheduled_days',
          shifts: goalShifts, status: 'active',
        });
        if (periodId) {
          for (const a of assignments) {
            const shift = goalShifts.find(s => s.id === a.shiftId);
            if (!shift) continue;
            const withinFraction = (parseFloat(a.pct) || 0) / 100;
            await addEmployeeGoal({
              periodId, employeeId: a.employeeId, kioskId,
              shiftId: a.shiftId, fraction: withinFraction,
              targetValue: revenueConfig.targetValue * shift.fraction * withinFraction,
              currentValue: 0, dailyProgress: {}, distributionMode: 'scheduled_days',
            });
          }
        } else hasError = true;
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
          distributionMode: 'scheduled_days',
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
          distributionMode: 'scheduled_days',
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
          distributionMode: 'scheduled_days',
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
    setCopySourceMonth('none');
    setCopiedFromMonth('');
    setRevenueConfig({ targetValue: 0, upValue: 0 });
    setRevenueConfigError('');
    setShiftPctOverrides({});
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

            <div className="space-y-2 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label>Copiar base de outro mês</Label>
                <p className="text-xs text-muted-foreground">
                  Opcional. Puxa valores, tipos de meta e distribuição de colaboradores do mês escolhido.
                </p>
              </div>
              <div className="flex gap-2">
                <Select value={copySourceMonth} onValueChange={setCopySourceMonth}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Selecione um mês-base" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não copiar</SelectItem>
                    {availableSourceMonths.map(option => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  disabled={copySourceMonth === 'none'}
                  onClick={() => applySourceMonth(copySourceMonth)}
                >
                  Carregar
                </Button>
              </div>
              {copiedFromMonth && (
                <p className="text-xs text-emerald-600">
                  Base aplicada de {availableSourceMonths.find(option => option.key === copiedFromMonth)?.label ?? copiedFromMonth}.
                </p>
              )}
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

            {revenueConfigError && <p className="text-xs text-destructive">{revenueConfigError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
              <Button onClick={handleNext}>Próximo <ChevronRight className="ml-1 h-4 w-4" /></Button>
            </DialogFooter>
          </div>
        )}

        {/* ── STEP: REVENUE SHIFTS (% por turno) ── */}
        {currentStep === 'revenue_shifts' && (
          <div className="space-y-4">
            {dpShiftsLoading || shiftDefsLoading ? (
              <p className="text-sm text-muted-foreground">Carregando escala...</p>
            ) : shiftGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum turno encontrado na escala de {month} para este quiosque. Verifique se a escala foi gerada no módulo de DP.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {shiftGroups.length} turno(s) encontrado(s) na escala de {month}. Defina a distribuição percentual da meta entre eles.
                </p>
                {revenueSalesLoading && (
                  <p className="text-xs text-muted-foreground">Carregando histórico de faturamento...</p>
                )}
                {shiftSuggestion && !revenueSalesLoading && (
                  <p className="text-xs text-muted-foreground">
                    Distribuição pré-preenchida com base nos últimos 3 meses de faturamento real desta unidade.
                  </p>
                )}
                <div className="space-y-2">
                  {shifts.map(shift => {
                    const shiftPct = parseFloat(shift.pct) || 0;
                    const shiftTarget = (shiftPct / 100) * revenueConfig.targetValue;
                    return (
                      <div key={shift.id} className="flex items-center gap-3">
                        <span className="text-sm flex-1 font-medium">{shift.label}</span>
                        <div className="relative w-24">
                          <Input
                            type="number" min="0" max="100" step="0.1" placeholder="0"
                            className="pr-8"
                            value={shift.pct}
                            onChange={e => setShiftPctOverrides(prev => ({ ...prev, [shift.id]: e.target.value }))}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                        </div>
                        <span className="text-xs text-muted-foreground w-28 text-right shrink-0">
                          = R$ {shiftTarget.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className={`text-sm font-medium ${pctSumOk ? 'text-green-600' : 'text-destructive'}`}>
                  Soma: {pctSum.toFixed(1)}%{pctSumOk ? ' ✓' : ` — faltam ${(100 - pctSum).toFixed(1)}%`}
                </div>
              </>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
              <Button disabled={!pctSumOk || shiftGroups.length === 0} onClick={handleNext}>
                Próximo <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── STEP: REVENUE SHIFTS USERS (colaboradores por turno) ── */}
        {currentStep === 'revenue_shifts_users' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Distribuição automática da meta entre os colaboradores escalados em cada turno.
            </p>
            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {shiftGroups.map(group => {
                const shift = shifts.find(s => s.id === group.id);
                const shiftPct = parseFloat(shift?.pct ?? '0') || 0;
                const shiftTarget = (shiftPct / 100) * revenueConfig.targetValue;
                const totalDaysInShift = group.users.reduce(
                  (sum, u) => sum + (workedDaysMap.get(`${group.id}:${u.id}`) ?? 0), 0
                );

                return (
                  <div key={group.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{group.label}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{shiftPct.toFixed(1)}%</Badge>
                        <span className="text-xs text-muted-foreground">
                          R$ {shiftTarget.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                    {group.users.length > 0 ? (
                      <div className="border-t pt-2 space-y-1.5">
                        {group.users.map(u => {
                          const userDays = workedDaysMap.get(`${group.id}:${u.id}`) ?? 0;
                          const userFrac = totalDaysInShift > 0
                            ? userDays / totalDaysInShift
                            : 1 / group.users.length;
                          const userPctOfTotal = shiftPct * userFrac;
                          const userTarget = (userPctOfTotal / 100) * revenueConfig.targetValue;
                          return (
                            <div key={u.id} className="flex items-center justify-between text-xs pl-1">
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                {u.username ?? u.id}
                                <Badge variant="secondary" className="px-1.5 py-0 h-4">
                                  {userDays} de {totalDaysInShift}d
                                </Badge>
                              </span>
                              <span className="tabular-nums text-muted-foreground">
                                {userPctOfTotal.toFixed(1)}% · R$ {userTarget.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground pt-1 border-t pl-1">Nenhum colaborador neste turno</p>
                    )}
                  </div>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
              {isLastStep
                ? <Button disabled={saving} onClick={handleSubmit}>{saving ? 'Salvando...' : 'Salvar'}</Button>
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
