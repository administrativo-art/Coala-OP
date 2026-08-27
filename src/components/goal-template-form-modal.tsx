"use client";

import { useState, useMemo } from 'react';
import { Timestamp } from 'firebase/firestore';
import { addDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useGoals } from '@/contexts/goals-context';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { canAccessUnit } from '@/lib/unit-access';
import { useDPStore } from '@/store/use-dp-store';
import { useDPShifts } from '@/hooks/use-dp-shifts';
import { useGoalMethodConfigs } from '@/hooks/use-goal-method-configs';
import { matchDPUnitForKiosk } from '@/lib/dp-kiosk-match';
import {
  applyRevenueTargetsToGoalMethod,
  calculateTieredGoalBonus,
  formatCurrencyBRL,
} from '@/lib/goal-methods';
import { useToast } from '@/hooks/use-toast';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { ProductSimulationContext } from '@/components/product-simulation-provider';
import { useContext } from 'react';
import {
  type DPUnit,
  type DPUnitGroup,
  type DPUnitOrganization,
  type DPUnitResponsibilitySource,
  type EmployeeGoal,
  type GoalLeadershipRecipient,
  type GoalParticipantRole,
  type GoalPeriod,
  type GoalPeriodDoc,
  type GoalShift,
  type GoalType,
  type User,
} from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Check, ChevronDown, ChevronRight, ChevronLeft, Plus, Search, X } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function currentDateValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function currentWeekValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const firstWeekStart = startOfWeek(new Date(year, 0, 4), { weekStartsOn: 1 });
  const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  const diffMs = currentWeekStart.getTime() - firstWeekStart.getTime();
  const week = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${year}-W${String(Math.max(week, 1)).padStart(2, '0')}`;
}

function monthToDateRange(monthStr: string): { start: Date; end: Date } {
  const [year, month] = monthStr.split('-').map(Number);
  const start = startOfMonth(new Date(year, month - 1, 1));
  return { start, end: endOfMonth(start) };
}

function dateToDateRange(dateStr: string): { start: Date; end: Date } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return { start: date, end: date };
}

function weekToDateRange(weekStr: string): { start: Date; end: Date } {
  const [yearStr, weekPart] = weekStr.split('-W');
  const year = Number(yearStr);
  const week = Number(weekPart);
  const firstWeekStart = startOfWeek(new Date(year, 0, 4), { weekStartsOn: 1 });
  const start = addDays(firstWeekStart, (week - 1) * 7);
  return { start, end: endOfWeek(start, { weekStartsOn: 1 }) };
}

function goalPeriodToDateRange(period: GoalPeriod, values: { month: string; week: string; date: string }) {
  if (period === 'daily') return dateToDateRange(values.date);
  if (period === 'weekly') return weekToDateRange(values.week);
  return monthToDateRange(values.month);
}

function goalPeriodLabel(period: GoalPeriod): string {
  if (period === 'daily') return 'Diária';
  if (period === 'weekly') return 'Semanal';
  return 'Mensal';
}

function formatDateRange(start: Date, end: Date): string {
  if (dateKey(start) === dateKey(end)) return format(start, 'dd/MM/yyyy');
  return `${format(start, 'dd/MM/yyyy')} até ${format(end, 'dd/MM/yyyy')}`;
}

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isReliefWorkerUser(user: { jobRoleName?: string; jobFunctionNames?: string[] } | undefined): boolean {
  if (!user) return false;
  const labels = [user.jobRoleName, ...(user.jobFunctionNames ?? [])].filter(Boolean).map(value => normalizeText(String(value)));
  return labels.some(label => label.includes('folguista'));
}

function resolveUnitReferenceIds(reference: string, units: DPUnit[]) {
  if (!reference) return [];
  if (units.some(unit => unit.id === reference)) return [reference];
  const matchedUnit = units.length > 0 ? matchDPUnitForKiosk(reference, units) : undefined;
  return matchedUnit ? [reference, matchedUnit.id] : [reference];
}

function sourceMatchesUser(
  sourceType: DPUnitResponsibilitySource | undefined,
  sourceId: string | undefined,
  user: User
) {
  if (!sourceType || !sourceId) return false;
  if (sourceType === 'job_role') return user.jobRoleId === sourceId;
  return user.jobFunctionIds?.includes(sourceId) === true;
}

function userOwnsResponsibility(
  entity: Pick<DPUnitGroup | DPUnitOrganization, 'responsibleUserId' | 'responsibleSourceType' | 'responsibleSourceId'>,
  user: User
) {
  if (entity.responsibleUserId) return entity.responsibleUserId === user.id;
  return sourceMatchesUser(entity.responsibleSourceType, entity.responsibleSourceId, user);
}


const GOAL_TYPE_OPTIONS: { type: GoalType; label: string; description: string }[] = [
  { type: 'revenue', label: 'Faturamento', description: 'Meta de receita por período com colaboradores' },
  { type: 'ticket', label: 'Ticket Médio', description: 'Meta global do quiosque (faturamento ÷ cupons)' },
  { type: 'product_line', label: 'Linha de Produto', description: 'Meta por categoria (milkshake, açaí, casquinha…)' },
  { type: 'product_specific', label: 'Produto Específico', description: 'Meta para um produto individual' },
];

interface RevenueParticipant {
  employeeId: string;
  label: string;
  source: 'schedule' | 'manual';
  role: GoalParticipantRole;
  scheduledDays: number;
  coveredTurns: number;
  shiftLabels: string[];
  fraction: number;
}

// Per-type config data
interface RevenueConfig {
  targetValue: number;
  upValue: number;
  topValue: number;
}
interface TicketConfig {
  targetValue: number;
}
interface ProductLineConfig {
  lineId: string;
  lineName: string;
  targetValue: number;
  upValue: number;
  topValue: number;
}
interface ProductSpecificConfig {
  productId: string;
  productName: string;
  targetValue: number;
  upValue: number;
  topValue: number;
}

// Wizard step identifiers
type WizardStepId =
  | 'selection'
  | 'revenue_config'
  | 'revenue_shifts_users'
  | 'ticket_config'
  | 'product_line_config'
  | 'product_specific_config';

function buildSteps(selectedTypes: Set<GoalType>): WizardStepId[] {
  const steps: WizardStepId[] = ['selection'];
  if (selectedTypes.has('revenue')) steps.push('revenue_config', 'revenue_shifts_users');
  if (selectedTypes.has('ticket')) steps.push('ticket_config');
  if (selectedTypes.has('product_line')) steps.push('product_line_config');
  if (selectedTypes.has('product_specific')) steps.push('product_specific_config');
  return steps;
}

const STEP_LABELS: Record<WizardStepId, string> = {
  selection: 'Seleção',
  revenue_config: 'Faturamento',
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
  const { addTemplate, addPeriod, addEmployeeGoal, periods, templates } = useGoals();
  const { kiosks } = useKiosks();
  const { activeConfigs: goalMethodConfigs } = useGoalMethodConfigs();
  const { user, permissions, users, isDefaultAdmin } = useAuth();
  const { shiftDefinitions, schedules, units, unitGroups, unitOrganizations } = useDPStore();
  const { toast } = useToast();
  const { categories } = useProductSimulationCategories();
  const simCtx = useContext(ProductSimulationContext);
  const simulations = simCtx?.simulations ?? [];

  const availableKiosks = user
    ? kiosks.filter((kiosk) => canAccessUnit(user, kiosk.id, { isDefaultAdmin }))
    : [];

  // Product lines from cost & price module
  const productLines = useMemo(() => categories.filter(c => c.type === 'line'), [categories]);

  // ── Global state ──────────────────────────────────────────────────────────
  const [stepIdx, setStepIdx] = useState(0);
  const [kioskId, setKioskId] = useState(availableKiosks[0]?.id ?? '');
  const [goalPeriod, setGoalPeriod] = useState<GoalPeriod>('monthly');
  const [month, setMonth] = useState(currentMonthValue());
  const [week, setWeek] = useState(currentWeekValue());
  const [date, setDate] = useState(currentDateValue());
  const [revenueGoalMethod, setRevenueGoalMethod] = useState('manual');
  const [selectedTypes, setSelectedTypes] = useState<Set<GoalType>>(new Set(['revenue']));
  const [copySourceMonth, setCopySourceMonth] = useState('none');
  const [copiedFromMonth, setCopiedFromMonth] = useState('');

  // ── Revenue state ─────────────────────────────────────────────────────────
  const [revenueConfig, setRevenueConfig] = useState<RevenueConfig>({ targetValue: 0, upValue: 0, topValue: 0 });
  const [revenueConfigError, setRevenueConfigError] = useState('');
  const [excludedParticipantIds, setExcludedParticipantIds] = useState<string[]>([]);
  const [manualParticipantIds, setManualParticipantIds] = useState<string[]>([]);
  const [newParticipantId, setNewParticipantId] = useState('');
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  const [participantSearch, setParticipantSearch] = useState('');

  // Mapa de shiftDefinition para lookup rápido
  const shiftDefMap = useMemo(
    () => new Map(shiftDefinitions.map((d) => [d.id, d])),
    [shiftDefinitions]
  );

  const activeDateRange = useMemo(
    () => goalPeriodToDateRange(goalPeriod, { month, week, date }),
    [goalPeriod, month, week, date]
  );

  const [targetYear, targetMonth] = useMemo(() => {
    const start = activeDateRange.start;
    return [start.getFullYear(), start.getMonth() + 1];
  }, [activeDateRange]);

  // Encontra a unidade DP correspondente ao quiosque selecionado (por nome)
  const dpUnitForKiosk = useMemo(() => {
    const kiosk = kiosks.find(k => k.id === kioskId);
    if (!kiosk) return null;
    return matchDPUnitForKiosk(kiosk.name, units) ?? null;
  }, [kiosks, kioskId, units]);

  const dpGroupForKiosk = useMemo(() => {
    if (!dpUnitForKiosk?.groupId) return null;
    return unitGroups.find(group => group.id === dpUnitForKiosk.groupId) ?? null;
  }, [dpUnitForKiosk, unitGroups]);

  const dpOrganizationForKiosk = useMemo(() => {
    const organizationId = dpUnitForKiosk?.organizationId ?? dpGroupForKiosk?.organizationId;
    if (!organizationId) return null;
    return unitOrganizations.find(organization => organization.id === organizationId) ?? null;
  }, [dpGroupForKiosk, dpUnitForKiosk, unitOrganizations]);

  const leadershipRecipients = useMemo<GoalLeadershipRecipient[]>(() => {
    if (!kioskId || !dpUnitForKiosk) return [];

    const recipients = new Map<string, GoalLeadershipRecipient>();
    const addRecipient = (
      targetUser: User,
      source: GoalLeadershipRecipient['source'],
      sourceLabel: string
    ) => {
      if (recipients.has(targetUser.id)) return;
      recipients.set(targetUser.id, {
        userId: targetUser.id,
        userName: targetUser.username ?? targetUser.email ?? targetUser.id,
        source,
        sourceLabel,
      });
    };

    for (const candidate of users) {
      if (dpGroupForKiosk && userOwnsResponsibility(dpGroupForKiosk, candidate)) {
        addRecipient(candidate, 'unit_group_responsible', `Grupo: ${dpGroupForKiosk.name}`);
      }

      if (dpOrganizationForKiosk && userOwnsResponsibility(dpOrganizationForKiosk, candidate)) {
        addRecipient(candidate, 'unit_organization_responsible', `Organização: ${dpOrganizationForKiosk.name}`);
      }
    }

    const responsibilityTargets = new Set([
      kioskId,
      dpUnitForKiosk.id,
      dpUnitForKiosk.name,
      dpGroupForKiosk?.id,
      dpGroupForKiosk?.name,
      dpOrganizationForKiosk?.id,
      dpOrganizationForKiosk?.name,
    ].filter((value): value is string => Boolean(value)));

    for (const candidate of users) {
      const responsibleRefs = new Set<string>();
      for (const reference of candidate.responsibleUnitIds ?? []) {
        resolveUnitReferenceIds(reference, units).forEach(id => responsibleRefs.add(id));
        responsibleRefs.add(reference);
      }
      if ([...responsibilityTargets].some(target => responsibleRefs.has(target))) {
        addRecipient(candidate, 'responsible_unit_ids', `Responsável por: ${dpUnitForKiosk.name}`);
      }
    }

    return Array.from(recipients.values()).sort((left, right) =>
      left.userName.localeCompare(right.userName, 'pt-BR')
    );
  }, [dpGroupForKiosk, dpOrganizationForKiosk, dpUnitForKiosk, kioskId, unitGroups, units, users]);

  const leadershipUserIds = useMemo(
    () => new Set(leadershipRecipients.map(item => item.userId)),
    [leadershipRecipients]
  );

  const getParticipantRole = useMemo(() => {
    return (participantUser: User | undefined): GoalParticipantRole => {
      if (participantUser && leadershipUserIds.has(participantUser.id)) return 'leader';
      if (isReliefWorkerUser(participantUser)) return 'relief';
      return 'fixed';
    };
  }, [leadershipUserIds]);

  // Encontra a escala do mês para a unidade DP do quiosque
  const scheduleForKiosk = useMemo(
    () => schedules.find(s =>
      s.month === targetMonth &&
      s.year === targetYear &&
      s.unitId === dpUnitForKiosk?.id
    ) ?? null,
    [schedules, targetMonth, targetYear, dpUnitForKiosk]
  );

  // Carrega os turnos reais da escala do quiosque para vincular colaboradores.
  const { shifts: dpShifts } = useDPShifts(scheduleForKiosk?.id ?? null);

  // A escala já é da unidade do quiosque; qualquer pessoa escalada nela entra como participante.
  const kioskShifts = useMemo(() => {
    const startKey = dateKey(activeDateRange.start);
    const endKey = dateKey(activeDateRange.end);
    return dpShifts.filter(s => s.date >= startKey && s.date <= endKey);
  }, [dpShifts, activeDateRange]);

  // Colaboradores do quiosque para fallback manual
  const kioskUsers = useMemo(
    () => users.filter(u => kioskId && (u.assignedKioskIds?.includes(kioskId) || u.participatesInGoals === true)),
    [users, kioskId]
  );

  const scheduledParticipants = useMemo<RevenueParticipant[]>(() => {
    const byEmployee = new Map<string, { scheduledDays: Set<string>; shiftLabels: Set<string>; coveredTurns: number }>();
    for (const shift of kioskShifts) {
      if (shift.type !== 'work') continue;
      const current = byEmployee.get(shift.userId) ?? { scheduledDays: new Set<string>(), shiftLabels: new Set<string>(), coveredTurns: 0 };
      current.scheduledDays.add(shift.date);
      current.coveredTurns += 1;
      if (shift.shiftDefinitionId) {
        const def = shiftDefMap.get(shift.shiftDefinitionId);
        current.shiftLabels.add(def ? `${def.name} (${def.startTime}–${def.endTime})` : `${shift.startTime}–${shift.endTime}`);
      } else {
        current.shiftLabels.add(`${shift.startTime}–${shift.endTime}`);
      }
      byEmployee.set(shift.userId, current);
    }

    const base = byEmployee.size > 0
      ? Array.from(byEmployee.entries()).map(([employeeId, info]) => ({
          employeeId,
          label: users.find(u => u.id === employeeId)?.username ?? employeeId,
          source: 'schedule' as const,
          role: getParticipantRole(users.find(u => u.id === employeeId)),
          scheduledDays: info.scheduledDays.size,
          coveredTurns: info.coveredTurns,
          shiftLabels: Array.from(info.shiftLabels),
          fraction: 0,
        }))
      : kioskUsers.map(user => ({
          employeeId: user.id,
          label: user.username ?? user.id,
          source: 'schedule' as const,
          role: getParticipantRole(user),
          scheduledDays: 0,
          coveredTurns: 0,
          shiftLabels: [],
          fraction: 0,
        }));

    const totalWeight = base.reduce((sum, item) => sum + Math.max(item.coveredTurns || item.scheduledDays, 1), 0);
    return base
      .map(item => ({ ...item, fraction: totalWeight > 0 ? Math.max(item.coveredTurns || item.scheduledDays, 1) / totalWeight : 0 }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [getParticipantRole, kioskShifts, kioskUsers, shiftDefMap, users]);

  const participantRows = useMemo<RevenueParticipant[]>(() => {
    const excluded = new Set(excludedParticipantIds);
    const scheduled = scheduledParticipants.filter(item => !excluded.has(item.employeeId));
    const scheduledIds = new Set(scheduled.map(item => item.employeeId));
    const manual = manualParticipantIds
      .filter(id => !scheduledIds.has(id) && !excluded.has(id))
      .map(id => ({
        employeeId: id,
        label: users.find(user => user.id === id)?.username ?? id,
        source: 'manual' as const,
        role: getParticipantRole(users.find(user => user.id === id)),
        scheduledDays: 0,
        coveredTurns: 0,
        shiftLabels: [],
        fraction: 0,
      }));

    const rows = [...scheduled, ...manual];
    const totalWeight = rows.reduce((sum, item) => sum + Math.max(item.coveredTurns || item.scheduledDays, 1), 0);
    return rows
      .map(item => ({ ...item, fraction: totalWeight > 0 ? Math.max(item.coveredTurns || item.scheduledDays, 1) / totalWeight : 0 }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [excludedParticipantIds, getParticipantRole, manualParticipantIds, scheduledParticipants, users]);

  const selectedParticipantIds = useMemo(
    () => new Set(participantRows.map(item => item.employeeId)),
    [participantRows]
  );

  const selectedGoalMethodConfig = useMemo(
    () => goalMethodConfigs.find(config => config.id === revenueGoalMethod) ?? null,
    [goalMethodConfigs, revenueGoalMethod]
  );

  const revenueGoalMethodSnapshot = useMemo(() => {
    if (!selectedGoalMethodConfig) return null;
    if (
      revenueConfig.targetValue <= 0 ||
      revenueConfig.upValue <= revenueConfig.targetValue ||
      revenueConfig.topValue <= revenueConfig.upValue
    ) {
      return null;
    }

    return applyRevenueTargetsToGoalMethod(selectedGoalMethodConfig, revenueConfig);
  }, [revenueConfig, selectedGoalMethodConfig]);

  const teamParticipantRows = useMemo(
    () => participantRows.filter(row => row.role !== 'leader'),
    [participantRows]
  );

  const reliefParticipantRows = useMemo(
    () => teamParticipantRows.filter(row => row.role === 'relief'),
    [teamParticipantRows]
  );

  const revenueMethodPreview = useMemo(
    () => calculateTieredGoalBonus(
      revenueGoalMethodSnapshot,
      revenueConfig.topValue || revenueConfig.upValue || revenueConfig.targetValue,
      teamParticipantRows.length,
      {
        fixedCollaboratorCount: teamParticipantRows.filter(row => row.role === 'fixed').length,
        reliefWorkerCount: reliefParticipantRows.length,
        reliefWorkerCoveredTurnsByPerson: reliefParticipantRows.map(row => row.coveredTurns),
        totalPeriodTurns: new Set(
          kioskShifts
            .filter(shift => shift.type === 'work')
            .map(shift => `${shift.date}:${shift.shiftDefinitionId ?? `${shift.startTime}-${shift.endTime}`}`)
        ).size,
      }
    ),
    [kioskShifts, reliefParticipantRows, revenueConfig, revenueGoalMethodSnapshot, teamParticipantRows]
  );

  const participantOptions = useMemo(
    () => kioskUsers.filter(user => !selectedParticipantIds.has(user.id) && !excludedParticipantIds.includes(user.id)),
    [kioskUsers, selectedParticipantIds, excludedParticipantIds]
  );

  const filteredParticipantOptions = useMemo(() => {
    const search = normalizeText(participantSearch.trim());
    return participantOptions
      .filter(option => {
        if (!search) return true;
        const searchable = [
          option.username,
          option.email,
          option.jobRoleName,
          ...(option.jobFunctionNames ?? []),
        ].filter(Boolean).map(value => normalizeText(String(value))).join(' ');
        return searchable.includes(search);
      })
      .sort((left, right) => (left.username ?? left.id).localeCompare(right.username ?? right.id, 'pt-BR'));
  }, [participantOptions, participantSearch]);

  const selectedNewParticipant = useMemo(
    () => participantOptions.find(option => option.id === newParticipantId) ?? null,
    [newParticipantId, participantOptions]
  );

  const dpHierarchyItems = useMemo(
    () => [
      { label: 'Organização', value: dpOrganizationForKiosk?.name },
      { label: 'Grupo', value: dpGroupForKiosk?.name },
      { label: 'Unidade', value: dpUnitForKiosk?.name },
    ].filter((item): item is { label: string; value: string } => Boolean(item.value)),
    [dpGroupForKiosk, dpOrganizationForKiosk, dpUnitForKiosk]
  );

  function removeParticipant(row: RevenueParticipant) {
    if (row.source === 'manual') {
      setManualParticipantIds(prev => prev.filter(id => id !== row.employeeId));
      return;
    }
    setExcludedParticipantIds(prev => prev.includes(row.employeeId) ? prev : [...prev, row.employeeId]);
  }

  function addParticipant() {
    if (!newParticipantId) return;
    setManualParticipantIds(prev => prev.includes(newParticipantId) ? prev : [...prev, newParticipantId]);
    setExcludedParticipantIds(prev => prev.filter(id => id !== newParticipantId));
    setNewParticipantId('');
    setParticipantSearch('');
  }

  function handleRevenueMethodChange(value: string) {
    setRevenueGoalMethod(value);
    setRevenueConfigError('');
  }

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

  const periodValueReady = goalPeriod === 'daily' ? Boolean(date) : goalPeriod === 'weekly' ? Boolean(week) : Boolean(month);

  function applySourceMonth(sourceKey: string) {
    const sourceGroup = availableSourceMonths.find(item => item.key === sourceKey);
    if (!sourceGroup) {
      toast({ title: 'Mês base não encontrado', variant: 'destructive' });
      return;
    }

    const nextTypes = new Set<GoalType>();
    let sourceRevenueLoaded = false;

    setProductLineConfig({});
    setProductSpecificConfig({});
    setTicketConfig({ targetValue: 0 });

    for (const period of sourceGroup.items) {
      const template = templates.find(item => item.id === period.templateId);
      if (!template) continue;

      nextTypes.add(template.type);

      if (template.type === 'revenue' && !sourceRevenueLoaded) {
        sourceRevenueLoaded = true;
        setRevenueGoalMethod(period.goalMethodConfigId ?? template.goalMethodConfigId ?? period.method ?? 'manual');
        setRevenueConfig({
          targetValue: period.targetValue,
          upValue: period.upValue ?? period.targetValue * 1.2,
          topValue: period.topValue ?? 0,
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
          topValue: period.topValue ?? 0,
        });
      }

      if (template.type === 'product_specific') {
        setProductSpecificConfig({
          productId: template.productRef,
          productName: template.productName,
          targetValue: period.targetValue,
          upValue: period.upValue,
          topValue: period.topValue ?? 0,
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
      if (!kioskId || !periodValueReady || selectedTypes.size === 0) return;
      setStepIdx(1);
      return;
    }
    if (currentStep === 'revenue_config') {
      if (revenueConfig.targetValue <= 0) { setRevenueConfigError('Meta alvo deve ser maior que zero'); return; }
      if (revenueConfig.upValue <= revenueConfig.targetValue) { setRevenueConfigError('Meta UP deve ser maior que a Meta alvo'); return; }
      if (revenueConfig.topValue <= revenueConfig.upValue) { setRevenueConfigError('Meta TOP deve ser maior que a Meta UP'); return; }
      setRevenueConfigError('');
      setStepIdx(i => i + 1);
      return;
    }
    if (currentStep === 'revenue_shifts_users') {
      if (participantRows.length === 0) {
        toast({ title: 'Selecione ao menos um colaborador', variant: 'destructive' });
        return;
      }
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
      if (!productLineConfig.topValue || productLineConfig.topValue <= (productLineConfig.upValue ?? 0)) { setProductLineError('Meta TOP deve ser maior que a Meta UP'); return; }
      setProductLineError('');
      setStepIdx(i => i + 1);
      return;
    }
    if (currentStep === 'product_specific_config') {
      if (!productSpecificConfig.productId) { setProductSpecificError('Selecione um produto'); return; }
      if (!productSpecificConfig.targetValue || productSpecificConfig.targetValue <= 0) { setProductSpecificError('Meta alvo deve ser maior que zero'); return; }
      if (!productSpecificConfig.upValue || productSpecificConfig.upValue <= (productSpecificConfig.targetValue ?? 0)) { setProductSpecificError('Meta UP deve ser maior que a Meta alvo'); return; }
      if (!productSpecificConfig.topValue || productSpecificConfig.topValue <= (productSpecificConfig.upValue ?? 0)) { setProductSpecificError('Meta TOP deve ser maior que a Meta UP'); return; }
      setProductSpecificError('');
      setStepIdx(i => i + 1);
    }
  }

  function handleBack() {
    setStepIdx(i => Math.max(0, i - 1));
  }

  const isLastStep = stepIdx === steps.length - 1;

  // ── Submit ────────────────────────────────────────────────────────────────

  function normalizedGoalShifts(): GoalShift[] {
    return [{ id: 'period', label: goalPeriodLabel(goalPeriod), fraction: 1 }];
  }

  async function handleSubmit() {
    setSaving(true);
    const { start, end } = activeDateRange;
    let hasError = false;

    // ── Revenue ──
    if (selectedTypes.has('revenue')) {
      const methodSnapshot = selectedGoalMethodConfig
        ? applyRevenueTargetsToGoalMethod(selectedGoalMethodConfig, revenueConfig)
        : null;
      const methodFields = methodSnapshot
        ? {
            method: methodSnapshot.type,
            goalMethodConfigId: methodSnapshot.id,
            goalMethodSnapshot: methodSnapshot,
          }
        : {
            method: 'manual' as const,
          };

      const templateId = await addTemplate({
        kioskId,
        type: 'revenue',
        period: goalPeriod,
        version: 2,
        ...methodFields,
        targetValue: revenueConfig.targetValue,
        upValue: revenueConfig.upValue,
        topValue: revenueConfig.topValue,
      });

      if (templateId) {
        const goalShifts = normalizedGoalShifts();
        const periodData = {
          templateId, kioskId,
          templateType: 'revenue',
          version: 2,
          ...methodFields,
          startDate: Timestamp.fromDate(start),
          endDate: Timestamp.fromDate(end),
          targetValue: revenueConfig.targetValue,
          upValue: revenueConfig.upValue,
          topValue: revenueConfig.topValue,
          currentValue: 0, dailyProgress: {}, distributionMode: 'scheduled_days',
          shifts: goalShifts,
          leadershipRecipients,
          status: 'active',
        } satisfies Omit<GoalPeriodDoc, 'id' | 'createdAt' | 'updatedAt'>;
        const periodId = await addPeriod(periodData);
        if (periodId) {
          for (const participant of participantRows) {
            const employeeGoalData = {
              periodId,
              employeeId: participant.employeeId,
              kioskId,
              participantSource: participant.source,
              participantRole: participant.role,
              scheduledDays: participant.scheduledDays,
              scheduledTurnCount: participant.coveredTurns,
              fraction: participant.fraction,
              targetValue: revenueConfig.targetValue * participant.fraction,
              currentValue: 0, dailyProgress: {}, distributionMode: 'scheduled_days',
            } satisfies Omit<EmployeeGoal, 'id' | 'createdAt' | 'updatedAt'>;
            await addEmployeeGoal(employeeGoalData);
          }
        } else hasError = true;
      } else hasError = true;
    }

    // ── Ticket Médio ──
    if (selectedTypes.has('ticket')) {
      const templateId = await addTemplate({
        kioskId,
        type: 'ticket',
        period: goalPeriod,
        version: 2,
        method: 'manual',
        targetValue: ticketConfig.targetValue,
        upValue: ticketConfig.targetValue, // no UP concept, same value
        topValue: ticketConfig.targetValue,
      });

      if (templateId) {
        const ok = await addPeriod({
          templateId,
          kioskId,
          templateType: 'ticket',
          version: 2,
          method: 'manual',
          startDate: Timestamp.fromDate(start),
          endDate: Timestamp.fromDate(end),
          targetValue: ticketConfig.targetValue,
          upValue: ticketConfig.targetValue,
          topValue: ticketConfig.targetValue,
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
        period: goalPeriod,
        version: 2,
        method: 'manual',
        targetValue: productLineConfig.targetValue!,
        upValue: productLineConfig.upValue!,
        topValue: productLineConfig.topValue!,
        productLineRef: productLineConfig.lineId,
        productLineName: productLineConfig.lineName,
      });

      if (templateId) {
        const ok = await addPeriod({
          templateId,
          kioskId,
          templateType: 'product_line',
          version: 2,
          method: 'manual',
          startDate: Timestamp.fromDate(start),
          endDate: Timestamp.fromDate(end),
          targetValue: productLineConfig.targetValue!,
          upValue: productLineConfig.upValue!,
          topValue: productLineConfig.topValue!,
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
        period: goalPeriod,
        version: 2,
        method: 'manual',
        targetValue: productSpecificConfig.targetValue!,
        upValue: productSpecificConfig.upValue!,
        topValue: productSpecificConfig.topValue!,
        productRef: productSpecificConfig.productId,
        productName: productSpecificConfig.productName,
      });

      if (templateId) {
        const ok = await addPeriod({
          templateId,
          kioskId,
          templateType: 'product_specific',
          version: 2,
          method: 'manual',
          startDate: Timestamp.fromDate(start),
          endDate: Timestamp.fromDate(end),
          targetValue: productSpecificConfig.targetValue!,
          upValue: productSpecificConfig.upValue!,
          topValue: productSpecificConfig.topValue!,
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
    setGoalPeriod('monthly');
    setMonth(currentMonthValue());
    setWeek(currentWeekValue());
    setDate(currentDateValue());
    setRevenueGoalMethod('manual');
    setSelectedTypes(new Set(['revenue']));
    setCopySourceMonth('none');
    setCopiedFromMonth('');
    setRevenueConfig({ targetValue: 0, upValue: 0, topValue: 0 });
    setRevenueConfigError('');
    setExcludedParticipantIds([]);
    setManualParticipantIds([]);
    setNewParticipantId('');
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
      <DialogContent className="max-h-[90vh] overflow-y-auto overflow-x-hidden sm:max-w-3xl">
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

            <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
              <div className="space-y-2">
                <Label>Período</Label>
                <Select value={goalPeriod} onValueChange={value => setGoalPeriod(value as GoalPeriod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Diária</SelectItem>
                    <SelectItem value="weekly">Semanal</SelectItem>
                    <SelectItem value="monthly">Mensal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{goalPeriod === 'daily' ? 'Data' : goalPeriod === 'weekly' ? 'Semana' : 'Mês de referência'}</Label>
                {goalPeriod === 'daily' && <Input type="date" value={date} onChange={e => setDate(e.target.value)} />}
                {goalPeriod === 'weekly' && <Input type="week" value={week} onChange={e => setWeek(e.target.value)} />}
                {goalPeriod === 'monthly' && <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />}
                {periodValueReady && (
                  <p className="text-xs text-muted-foreground">
                    Meta {goalPeriodLabel(goalPeriod).toLowerCase()}: {formatDateRange(activeDateRange.start, activeDateRange.end)}
                  </p>
                )}
              </div>
            </div>

            {goalPeriod === 'monthly' && (
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
            )}

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

            {selectedTypes.has('revenue') && (
              <div className="space-y-2 rounded-lg border p-3">
                <Label>Forma da meta de faturamento</Label>
                <Select value={revenueGoalMethod} onValueChange={handleRevenueMethodChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    {goalMethodConfigs.map(config => (
                      <SelectItem key={config.id} value={config.id}>
                        {config.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedGoalMethodConfig ? (
                  <div className="rounded-md border border-pink-100 bg-pink-50 px-3 py-2 text-xs text-pink-800">
                    <p className="font-semibold">{selectedGoalMethodConfig.name}</p>
                    <p className="mt-1">
                      {selectedGoalMethodConfig.description}
                    </p>
                    <p className="mt-1 text-pink-700">
                      Esta forma define parâmetros de premiação. Os valores de faturamento serão informados na próxima etapa.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No modo manual, o usuário informa os valores de Meta Alvo, UP e TOP sem cálculo de premiação.
                  </p>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button disabled={!kioskId || !periodValueReady || selectedTypes.size === 0} onClick={handleNext}>
                Próximo <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── STEP: REVENUE CONFIG ── */}
        {currentStep === 'revenue_config' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
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
              <div className="space-y-1.5">
                <Label>Meta TOP</Label>
                <CurrencyInput
                  value={revenueConfig.topValue}
                  onChange={v => setRevenueConfig(prev => ({ ...prev, topValue: v }))}
                  placeholder="0,00"
                />
              </div>
            </div>

            {revenueConfigError && <p className="text-xs text-destructive">{revenueConfigError}</p>}

            {selectedGoalMethodConfig && revenueMethodPreview && (
              <div className="rounded-[20px] border border-pink-100 bg-gradient-to-br from-pink-50 via-white to-slate-50 p-4 text-sm shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-pink-600">Prévia da bonificação</p>
                    <p className="mt-1 text-base font-black tracking-tight text-zinc-900">{selectedGoalMethodConfig.name}</p>
                    <p className="mt-1 max-w-[520px] text-xs font-medium leading-relaxed text-zinc-500">
                      Esta prévia usa os valores informados acima para mostrar quanto a equipe receberia ao bater as faixas.
                    </p>
                  </div>
                  <Badge variant="outline" className="rounded-full bg-white px-3 py-1 text-xs font-black">
                    {teamParticipantRows.length} colaborador(es) elegível(is)
                  </Badge>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-[14px] border border-white bg-white/90 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">Equipe</p>
                    <p className="mt-1 text-lg font-black tabular-nums text-zinc-900">R$ {formatCurrencyBRL(revenueMethodPreview.totalTeamBonus)}</p>
                    <p className="mt-1 text-[11px] font-medium text-zinc-500">soma das faixas batidas</p>
                  </div>
                  <div className="rounded-[14px] border border-white bg-white/90 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">Por colaborador</p>
                    <p className="mt-1 text-lg font-black tabular-nums text-zinc-900">R$ {formatCurrencyBRL(revenueMethodPreview.perCollaboratorBonus)}</p>
                    <p className="mt-1 text-[11px] font-medium text-zinc-500">divisão entre elegíveis</p>
                  </div>
                  <div className="rounded-[14px] border border-white bg-white/90 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">Liderança</p>
                    <p className="mt-1 text-lg font-black tabular-nums text-zinc-900">R$ {formatCurrencyBRL(revenueMethodPreview.leadershipBonus)}</p>
                    <p className="mt-1 text-[11px] font-medium text-zinc-500">calculada pela regra</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">Regras por faixa</p>
                  {revenueGoalMethodSnapshot?.tiers.map((tier, index) => {
                    const tone = tier.id === 'up'
                      ? 'border-blue-100 bg-blue-50 text-blue-700'
                      : tier.id === 'top'
                        ? 'border-violet-100 bg-violet-50 text-violet-700'
                        : 'border-pink-100 bg-pink-50 text-pink-700';
                    return (
                      <div key={tier.id} className="grid gap-2 rounded-[14px] border border-white bg-white/85 px-3 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)]">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-black ${tone}`}>
                            {index + 1}
                          </span>
                          <span className="font-black text-zinc-900">{tier.label}</span>
                        </div>
                        <div className="text-xs font-semibold leading-relaxed text-zinc-500 sm:text-right">
                          <span className="text-zinc-800">
                            R$ {formatCurrencyBRL(tier.fromAmount)}
                            {tier.toAmount ? ` a R$ ${formatCurrencyBRL(tier.toAmount)}` : ' em diante'}
                          </span>
                          <span className="mx-1 text-zinc-300">•</span>
                          Fixo R$ {formatCurrencyBRL(tier.fixedBonusAmount)}
                          <span className="mx-1 text-zinc-300">+</span>
                          {tier.excessPercent}% sobre o excedente
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" />Voltar</Button>
              <Button onClick={handleNext}>Próximo <ChevronRight className="ml-1 h-4 w-4" /></Button>
            </DialogFooter>
          </div>
        )}

        {/* ── STEP: REVENUE SHIFTS USERS (colaboradores por turno) ── */}
        {currentStep === 'revenue_shifts_users' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Colaboradores vinculados a esta meta. A escala ajuda a identificar presença, papel e cobertura do período; a meta continua sendo da equipe, sem alvo individual por colaborador.
            </p>
            <div className="max-w-full rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
              <p className="font-semibold">Organograma da unidade</p>
              {dpHierarchyItems.length > 0 && (
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {dpHierarchyItems.map(item => (
                    <div key={item.label} className="rounded-md border border-blue-100 bg-white/80 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-500">{item.label}</p>
                      <p className="mt-1 truncate text-xs font-semibold text-blue-950">{item.value}</p>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">Liderança identificada</p>
              {leadershipRecipients.length > 0 ? (
                <div className="mt-2 flex max-w-full flex-wrap gap-2">
                  {leadershipRecipients.map(recipient => (
                    <Badge key={recipient.userId} variant="outline" className="max-w-full whitespace-normal break-words border-blue-200 bg-white text-left text-blue-800">
                      {recipient.userName} · {recipient.sourceLabel}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-blue-800">
                  Nenhum responsável estruturado encontrado para esta unidade. Configure o responsável no organograma antes de usar premiação de liderança.
                </p>
              )}
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Colaboradores vinculados</p>
                  <p className="text-xs text-muted-foreground">{participantRows.length} participante(s) selecionado(s)</p>
                </div>
                <Badge variant="outline">{goalPeriodLabel(goalPeriod)}</Badge>
              </div>
              <div className="space-y-2 max-h-[34vh] overflow-y-auto pr-1">
                {participantRows.length === 0 ? (
                  <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    Nenhum colaborador selecionado.
                  </p>
                ) : participantRows.map(row => {
                  return (
                    <div key={row.employeeId} className="flex flex-col gap-3 rounded-md border bg-muted/20 px-3 py-2 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">{row.label}</span>
                          <Badge variant={row.source === 'schedule' ? 'secondary' : 'outline'} className="h-5 px-1.5 text-[10px]">
                            {row.source === 'schedule' ? 'Escala' : 'Manual'}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`h-5 px-1.5 text-[10px] ${
                              row.role === 'leader'
                                ? 'border-violet-200 bg-violet-50 text-violet-700'
                                : row.role === 'relief'
                                ? 'border-blue-200 bg-blue-50 text-blue-700'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            }`}
                          >
                            {row.role === 'leader' ? 'Líder' : row.role === 'relief' ? 'Folguista' : 'Fixa'}
                          </Badge>
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                            {row.coveredTurns > 0 ? `${row.coveredTurns} turno(s)` : row.scheduledDays > 0 ? `${row.scheduledDays} dia(s)` : 'sem escala'}
                          </Badge>
                        </div>
                        {row.shiftLabels.length > 0 && (
                          <p className="mt-1 truncate text-[11px] text-muted-foreground">{row.shiftLabels.join(' · ')}</p>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 md:shrink-0 md:justify-end">
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeParticipant(row)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row">
                <Popover
                  open={participantPickerOpen}
                  onOpenChange={(nextOpen) => {
                    setParticipantPickerOpen(nextOpen);
                    if (!nextOpen) setParticipantSearch('');
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="flex-1 justify-between font-normal">
                      <span className={selectedNewParticipant ? 'truncate' : 'truncate text-muted-foreground'}>
                        {selectedNewParticipant?.username ?? 'Buscar e adicionar colaborador'}
                      </span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start" sideOffset={4}>
                    <div className="relative mb-2">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={participantSearch}
                        onChange={(event) => setParticipantSearch(event.target.value)}
                        placeholder="Buscar por nome, cargo ou função..."
                        className="h-9 pl-8"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto pr-1">
                      {filteredParticipantOptions.length === 0 ? (
                        <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                          Nenhum colaborador disponível.
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          {filteredParticipantOptions.map(option => {
                            const isSelected = option.id === newParticipantId;
                            const roleLabel = option.jobFunctionNames?.[0] ?? option.jobRoleName ?? 'Sem cargo/função';
                            return (
                              <button
                                key={option.id}
                                type="button"
                                className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted ${isSelected ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}`}
                                onClick={() => {
                                  setNewParticipantId(option.id);
                                  setParticipantPickerOpen(false);
                                  setParticipantSearch('');
                                }}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate font-medium">{option.username ?? option.id}</span>
                                  <span className={`block truncate text-xs ${isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{roleLabel}</span>
                                </span>
                                {isSelected && <Check className="h-4 w-4 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                <Button type="button" variant="outline" onClick={addParticipant} disabled={!newParticipantId}>
                  <Plus className="mr-1.5 h-4 w-4" /> Adicionar
                </Button>
              </div>
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
            <div className="grid grid-cols-3 gap-3">
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
              <div className="space-y-1.5">
                <Label>Meta TOP (R$)</Label>
                <CurrencyInput
                  value={productLineConfig.topValue ?? 0}
                  onChange={v => setProductLineConfig(prev => ({ ...prev, topValue: v }))}
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
            <div className="grid grid-cols-3 gap-3">
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
              <div className="space-y-1.5">
                <Label>Meta TOP (R$)</Label>
                <CurrencyInput
                  value={productSpecificConfig.topValue ?? 0}
                  onChange={v => setProductSpecificConfig(prev => ({ ...prev, topValue: v }))}
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
