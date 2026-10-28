"use client";

import React, { useMemo, useState } from 'react';
import { addDays, differenceInCalendarDays, format, parseISO, startOfDay, subDays } from 'date-fns';

import { useDP } from '@/components/dp-context';
import { useAuth } from '@/hooks/use-auth';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import type { DPVacationRecord } from '@/types';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  CalendarDays, MoreHorizontal,
  Pencil, Plus, Trash2,
} from 'lucide-react';
import { BackButton } from '@/components/navigation/back-button';
import { useToast } from '@/hooks/use-toast';
import { useAuthenticatedApi } from '@/hooks/use-authenticated-api';
import {
  DPVacationAuditTimeline,
  DPVacationWorkflowPanel,
} from '@/components/dp/dp-vacation-workflow';
import { DPVacationEditorPanel } from '@/components/dp/dp-vacation-editor-panel';
import { DPVacationDecisionPanel } from '@/components/dp/dp-vacation-decision-panel';
import {
  shouldDisplayVacationWorkflow,
  VACATION_WORKFLOW_DISPLAY_STAGE_META,
  vacationWorkflowDisplayStageId,
} from '@/lib/dp-vacation-workflow';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PageHero } from '@/components/patterns/page-hero';
import { HeroChip } from '@/components/patterns/hero-chip';
import { SidePanel } from '@/components/patterns/side-panel';
import { VacationPill, VacationStageDots, workflowOperationalSummary } from '@/components/dp/dp-ferias-shared';
import { PersonStatusBar, VacationRuleTimeline, type BandTone } from '@/components/dp/dp-ferias-person-parts';

import {
  calculateVacationHealth,
  getVacationCycleHistory,
  CYCLE_STATUS_CONFIG,
  type VacationCycle,
} from '@/lib/utils/vacation-logic';

// ─── Helpers ──────────────────────────────────────────────────────────────────


function toDate(ts: unknown): Date | undefined {
  if (!ts) return undefined;
  if (ts instanceof Date) return ts;
  if (typeof (ts as any).toDate === 'function') return (ts as any).toDate();
  if (typeof ts === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(ts) ? parseISO(ts) : new Date(ts);
  return undefined;
}

function fmtDate(d?: string | Date) {
  if (!d) return '—';
  try {
    const dt = typeof d === 'string' ? parseISO(d) : d;
    return format(dt, 'dd/MM/yyyy');
  } catch { return String(d); }
}

// ─── Vacation record status config ────────────────────────────────────────────

const STATUS_CONFIG = {
  PENDING:  { label: 'Pendente',  bg: 'bg-ds-warn-bg dark:bg-ds-warn',  text: 'text-ds-warn dark:text-ds-warn'  },
  PLANNED:  { label: 'Planejado', bg: 'bg-ds-accent-soft dark:bg-ds-accent', text: 'text-ds-accent-ink dark:text-ds-accent-ink' },
  APPROVED: { label: 'Aprovado',  bg: 'bg-ds-ok-bg dark:bg-ds-ok',  text: 'text-ds-ok dark:text-ds-ok'  },
  REJECTED: { label: 'Rejeitado', bg: 'bg-ds-danger-bg dark:bg-ds-danger',      text: 'text-ds-danger dark:text-ds-danger'      },
} as const;

// ─── Vacation Record Row ──────────────────────────────────────────────────────

interface VacationRecordRowProps {
  record: DPVacationRecord;
  canEdit: boolean;
  canApprove: boolean;
  onEdit: (r: DPVacationRecord) => void;
  onDelete: (r: DPVacationRecord) => void;
  onReview: (r: DPVacationRecord) => void;
}

function VacationRecordRow({ record, canEdit, canApprove, onEdit, onDelete, onReview }: VacationRecordRowProps) {
  const cfg = STATUS_CONFIG[record.status] ?? STATUS_CONFIG.PENDING;
  const isGozo = record.recordType === 'gozo';

  return (
    <div className="flex items-center gap-3 py-2.5 px-1 rounded-lg hover:bg-muted/30 transition-colors group">
      <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
            {cfg.label}
          </span>
          <span className="text-xs text-muted-foreground">
            {isGozo ? 'Gozo' : 'Venda'} · {record.days}d
          </span>
        </div>
        {isGozo && record.startDate && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {fmtDate(record.startDate)} → {fmtDate(record.endDate)}
          </p>
        )}
      </div>

      {canApprove && (record.status === 'PENDING' || record.status === 'PLANNED') ? (
        <Button type="button" size="sm" className="h-8 rounded-lg" onClick={() => onReview(record)}>
          Revisar e decidir
        </Button>
      ) : null}

      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && (
              <DropdownMenuItem onClick={() => onEdit(record)}>
                <Pencil className="mr-2 h-3.5 w-3.5" />Editar
              </DropdownMenuItem>
            )}
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDelete(record)} className="text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-3.5 w-3.5" />Excluir
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ─── Cycle Card ───────────────────────────────────────────────────────────────

interface CycleCardProps {
  cycle: VacationCycle;
  canEdit: boolean;
  canApprove: boolean;
  onAdd: (cycleId: string) => void;
  onEdit: (r: DPVacationRecord) => void;
  onDelete: (r: DPVacationRecord) => void;
  onReview: (r: DPVacationRecord) => void;
}

function CycleCard({ cycle, canEdit, canApprove, onAdd, onEdit, onDelete, onReview }: CycleCardProps) {
  const cfg = CYCLE_STATUS_CONFIG[cycle.status];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Ciclo {cycle.id}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Aquisitivo: {fmtDate(cycle.acquisitivePeriod.start)} → {fmtDate(cycle.acquisitivePeriod.end)}
            </p>
            <p className="text-xs text-muted-foreground">
              Concessivo: {fmtDate(cycle.concessivePeriod.start)} → {fmtDate(cycle.concessivePeriod.end)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
              {cfg.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {cycle.takenDays}/30 dias
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2 mt-2">
          <Progress
            value={Math.min(100, (cycle.takenDays / 30) * 100)}
            className="h-1.5 flex-1"
          />
          <span className="text-xs text-muted-foreground shrink-0">
            {Math.round(Math.min(100, (cycle.takenDays / 30) * 100))}%
          </span>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {cycle.records.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Nenhum registro neste ciclo.</p>
        ) : (
          <div className="divide-y">
            {cycle.records.map(r => (
              <VacationRecordRow
                key={r.id}
                record={r}
                canEdit={canEdit}
                canApprove={canApprove}
                onEdit={onEdit}
                onDelete={onDelete}
                onReview={onReview}
              />
            ))}
          </div>
        )}
        {canEdit && cycle.balance > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full text-muted-foreground hover:text-foreground gap-1.5"
            onClick={() => onAdd(cycle.id)}
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar registro
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Parcela do período concessivo ────────────────────────────────────────────

interface ParcelRowProps {
  record: DPVacationRecord;
  label: string;
  employeeName: string;
  today: Date;
  canEdit: boolean;
  canApprove: boolean;
  hasWorkflow: boolean;
  onOpenWorkflow: () => void;
  onEdit: (r: DPVacationRecord) => void;
  onDelete: (r: DPVacationRecord) => void;
  onReview: (r: DPVacationRecord) => void;
}

function ParcelRow({ record, label, employeeName, today, canEdit, canApprove, hasWorkflow, onOpenWorkflow, onEdit, onDelete, onReview }: ParcelRowProps) {
  const start = record.startDate ? parseISO(record.startDate) : null;
  const end = record.endDate ? parseISO(record.endDate) : null;
  const pending = record.status === 'PENDING' || record.status === 'PLANNED';
  const status = pending
    ? { label: 'Aguardando aprovação', tone: 'warn' as const }
    : start && end && start <= today && end >= today
      ? { label: 'Em gozo agora', tone: 'info' as const }
      : end && end < today
        ? { label: 'Gozada', tone: 'ok' as const }
        : { label: 'Agendada', tone: 'info' as const };
  const workflow = record.workflow;
  const active = workflow?.status === 'active';
  const summary = active && workflow ? workflowOperationalSummary(workflow, employeeName) : null;
  const stageIndex = active && workflow
    ? Math.max(0, VACATION_WORKFLOW_DISPLAY_STAGE_META.findIndex(stage => stage.id === vacationWorkflowDisplayStageId(workflow.currentStage)))
    : -1;
  const waitingExternal = Boolean(summary && !['RH', 'Sistema'].includes(summary.owner));

  return (
    <div className="grid grid-cols-[110px_minmax(150px,1fr)_minmax(220px,1.7fr)_auto] items-center gap-3.5 border-t border-ds-divider px-[18px] py-3">
      <span>
        <span className="block text-[13px] font-extrabold text-ds-ink">{label}</span>
        <span className="block text-[11.5px] text-ds-ink-muted">{record.days} dias</span>
      </span>
      <span>
        <span className="block font-ds-mono text-[12.5px] font-bold text-ds-ink">
          {record.recordType === 'gozo' ? `${fmtDate(record.startDate)} a ${fmtDate(record.endDate)}` : 'Venda de 1/3'}
        </span>
        <VacationPill tone={status.tone} className="mt-1">{status.label}</VacationPill>
      </span>
      <span className="min-w-0">
        {summary ? (
          <>
            <VacationStageDots current={stageIndex + 1} waitingExternal={waitingExternal} />
            <span className="mt-1 block text-[12.5px] font-extrabold text-ds-ink">
              Etapa {stageIndex + 1} de 6 · {VACATION_WORKFLOW_DISPLAY_STAGE_META[stageIndex].short}
            </span>
            <span className="block text-[11.5px] text-ds-ink-muted">{summary.action} · com {summary.owner}</span>
          </>
        ) : workflow?.status === 'completed' ? (
          <span className="text-[12px] font-semibold text-ds-ink-muted">Etapas concluídas</span>
        ) : (
          <span className="text-[12px] font-semibold text-ds-ink-muted">—</span>
        )}
      </span>
      <span className="flex items-center justify-end gap-1.5">
        {canApprove && pending ? (
          <Button type="button" variant="primary-modal" size="xs" onClick={() => onReview(record)}>Revisar e decidir</Button>
        ) : null}
        {hasWorkflow ? (
          <Button type="button" variant="ds-secondary" size="xs" onClick={onOpenWorkflow}>Ver etapas</Button>
        ) : null}
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ds-ghost" size="xs" aria-label={`Mais ações da ${label}`}>
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(record)}>
                <Pencil className="mr-2 h-3.5 w-3.5" />Editar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onDelete(record)} className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-3.5 w-3.5" />Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </span>
    </div>
  );
}

// ─── Main Profile Component ───────────────────────────────────────────────────

interface DPFeriasProfileProps {
  userId: string;
  initialWorkflowVacationId?: string;
}

export function DPFeriasProfile({
  userId,
  initialWorkflowVacationId,
}: DPFeriasProfileProps) {
  const { users, permissions } = useAuth();
  const { deleteVacation } = useDP();
  const { vacations, calendars, vacationsLoading, vacationsError } = useDPBootstrap();
  const { toast } = useToast();
  const api = useAuthenticatedApi();

  const canEdit    = permissions.dp?.vacation?.request ?? false;
  const canApprove = permissions.dp?.vacation?.approve ?? false;

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editVacation, setEditVacation] = useState<DPVacationRecord | null>(null);
  const [decisionVacation, setDecisionVacation] = useState<DPVacationRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DPVacationRecord | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<{ record: DPVacationRecord; action: 'reject' | 'cancel' } | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [selectedCycleId, setSelectedCycleId] = useState<string | undefined>();
  const [selectedWorkflowVacationId, setSelectedWorkflowVacationId] = useState<string | null>(
    initialWorkflowVacationId ?? null,
  );
  const [workflowDrawerOpen, setWorkflowDrawerOpen] = useState(Boolean(initialWorkflowVacationId));
  const [noticeBusy, setNoticeBusy] = useState<'generate' | 'validate' | 'open' | 'send' | 'sync' | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [vacationHistory, setVacationHistory] = useState<DPVacationRecord[]>([]);
  const [vacationHistoryCursor, setVacationHistoryCursor] = useState<string | null>(null);
  const [vacationHistoryLoading, setVacationHistoryLoading] = useState(false);

  const loadVacationHistory = React.useCallback(async (cursor?: string | null) => {
    setVacationHistoryLoading(true);
    try {
      const search = new URLSearchParams({ userId, limit: '50' });
      if (cursor) search.set('cursor', cursor);
      const payload = await api<{ vacations: DPVacationRecord[]; nextCursor: string | null }>(
        `/api/dp/vacations?${search}`,
        { fallbackError: 'Não foi possível carregar o histórico de férias.' },
      );
      setVacationHistory((current) => cursor ? [...current, ...payload.vacations] : payload.vacations);
      setVacationHistoryCursor(payload.nextCursor);
    } catch (error) {
      toast({
        title: 'Histórico de férias indisponível.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setVacationHistoryLoading(false);
    }
  }, [api, toast, userId]);

  React.useEffect(() => {
    setVacationHistory([]);
    setVacationHistoryCursor(null);
    void loadVacationHistory(null);
  }, [loadVacationHistory]);

  const user = users.find(u => u.id === userId);
  const admDate = toDate(user?.admissionDate);
  const userVacations = useMemo(() => {
    const records = new Map(
      vacations.filter(vacation => vacation.userId === userId).map((vacation) => [vacation.id, vacation]),
    );
    vacationHistory.forEach((vacation) => {
      const current = records.get(vacation.id);
      const currentTime = toDate(current?.updatedAt)?.getTime() ?? 0;
      const historyTime = toDate(vacation.updatedAt)?.getTime() ?? 0;
      if (!current || historyTime >= currentTime) records.set(vacation.id, vacation);
    });
    return [...records.values()];
  }, [vacationHistory, vacations, userId]);

  const health = useMemo(() =>
    calculateVacationHealth(admDate, userVacations),
    [admDate, userVacations]
  );

  const cycles = useMemo(() =>
    admDate ? getVacationCycleHistory(admDate, userVacations) : [],
    [admDate, userVacations]
  );

  const concessiveCycle = useMemo(
    () => cycles.find(cycle => cycle.status !== 'GOZADO' && cycle.status !== 'AQUISITIVO'),
    [cycles],
  );
  const concessiveNoticeLimit = useMemo(() => {
    if (!concessiveCycle || concessiveCycle.balance <= 0) return null;
    const remainingDays = Math.max(1, concessiveCycle.balance);
    const date = subDays(concessiveCycle.concessivePeriod.end, remainingDays + 29);
    return {
      date,
      remainingDays,
      daysLeft: differenceInCalendarDays(date, startOfDay(new Date())),
    };
  }, [concessiveCycle]);
  const workflowCycle = useMemo(
    () => concessiveCycle ?? cycles.find(cycle => cycle.records.length > 0),
    [concessiveCycle, cycles],
  );
  const defaultRegistrationCycle = useMemo(
    () => cycles.find(cycle => cycle.status !== 'AQUISITIVO' && cycle.balance > 0),
    [cycles],
  );
  const editorCycleId = editVacation?.cycleId ?? selectedCycleId ?? defaultRegistrationCycle?.id;
  const editorCycle = editorCycleId
    ? cycles.find(cycle => cycle.id === editorCycleId)
    : undefined;
  const decisionCycle = decisionVacation
    ? cycles.find(cycle => cycle.id === decisionVacation.cycleId)
    : undefined;

  function closeVacationEditor() {
    setScheduleOpen(false);
    setEditVacation(null);
    setSelectedCycleId(undefined);
  }

  function openVacationEditor(cycleId?: string) {
    const cycle = cycleId
      ? cycles.find(candidate => candidate.id === cycleId && candidate.balance > 0)
      : defaultRegistrationCycle;
    if (!cycle) {
      toast({
        title: 'Nenhum ciclo com saldo disponível.',
        description: 'Todos os dias de férias já foram distribuídos ou o ciclo ainda está em aquisição.',
        variant: 'destructive',
      });
      return;
    }
    setEditVacation(null);
    setSelectedCycleId(cycle.id);
    setScheduleOpen(true);
  }

  function openVacationEdit(record: DPVacationRecord) {
    setScheduleOpen(false);
    setSelectedCycleId(record.cycleId);
    setEditVacation(record);
  }

  const workflowVacations = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return userVacations
      .filter(vacation => (
        (!workflowCycle || vacation.cycleId === workflowCycle.id)
        && shouldDisplayVacationWorkflow(vacation, today)
      ))
      .sort((left, right) => {
        const leftRejected = left.status === 'REJECTED' ? 1 : 0;
        const rightRejected = right.status === 'REJECTED' ? 1 : 0;
        if (leftRejected !== rightRejected) return leftRejected - rightRejected;
        const leftUpcoming = (left.endDate ?? '') >= today ? 0 : 1;
        const rightUpcoming = (right.endDate ?? '') >= today ? 0 : 1;
        if (leftUpcoming !== rightUpcoming) return leftUpcoming - rightUpcoming;
        return leftUpcoming === 0
          ? (left.startDate ?? '').localeCompare(right.startDate ?? '')
          : (right.startDate ?? '').localeCompare(left.startDate ?? '');
      });
  }, [userVacations, workflowCycle]);
  // O painel de etapas mostra só a parcela escolhida; ao concluir, a trilha sai da lista e o painel fecha em vez de
  // abrir outro registro com as mesmas datas.
  const drawerWorkflowVacation = workflowVacations.find(vacation => vacation.id === selectedWorkflowVacationId);
  const selectedWorkflowVacation = drawerWorkflowVacation ?? workflowVacations[0];

  React.useEffect(() => {
    if (!workflowVacations.length) {
      setWorkflowDrawerOpen(false);
      setSelectedWorkflowVacationId(null);
      return;
    }
    if (!workflowVacations.some(vacation => vacation.id === selectedWorkflowVacationId)) {
      if (selectedWorkflowVacationId) setWorkflowDrawerOpen(false);
      setSelectedWorkflowVacationId(workflowVacations[0].id);
    }
  }, [selectedWorkflowVacationId, workflowVacations]);

  function handleCancel(v: DPVacationRecord) {
    setDecisionReason('');
    setDecisionTarget({ record: v, action: 'cancel' });
  }

  async function confirmDecision() {
    if (!decisionTarget || decisionReason.trim().length < 10) return;
    setDeciding(true);
    try {
      await api(`/api/dp/vacations/${encodeURIComponent(decisionTarget.record.id)}`, {
        method: 'PATCH',
        json: { action: decisionTarget.action, reason: decisionReason.trim() },
        fallbackError: decisionTarget.action === 'cancel'
          ? 'Não foi possível cancelar formalmente as férias.'
          : 'Não foi possível rejeitar o agendamento.',
      });
      toast({ title: decisionTarget.action === 'cancel' ? 'Férias canceladas formalmente.' : 'Agendamento rejeitado.' });
      await loadVacationHistory(null);
      setDecisionTarget(null);
      setDecisionReason('');
    } catch (error) {
      toast({
        title: 'A ação não foi concluída.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setDeciding(false);
    }
  }

  async function handleGenerateNotice(vacation: DPVacationRecord) {
    setNoticeBusy('generate');
    try {
      await api(`/api/dp/vacations/${encodeURIComponent(vacation.id)}`, {
        method: 'PATCH',
        json: { action: 'generate_notice' },
        fallbackError: 'Não foi possível gerar o aviso de férias.',
      });
      toast({
        title: 'Aviso gerado.',
        description: 'Abra o PDF e confira o conteúdo antes de validar.',
      });
      await loadVacationHistory(null);
    } catch (error) {
      toast({
        title: 'Não foi possível gerar o aviso.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setNoticeBusy(null);
    }
  }

  async function handleOpenNotice(vacation: DPVacationRecord) {
    const preview = window.open('', '_blank');
    setNoticeBusy('open');
    try {
      const blob = await api<Blob>(`/api/dp/vacations/${encodeURIComponent(vacation.id)}/notice`, {
        method: 'GET',
        responseType: 'blob',
        fallbackError: 'Não foi possível abrir o aviso de férias.',
      });
      const url = URL.createObjectURL(blob);
      if (preview) preview.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      preview?.close();
      toast({
        title: 'Não foi possível abrir o aviso.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setNoticeBusy(null);
    }
  }

  async function handleValidateNotice(vacation: DPVacationRecord) {
    setNoticeBusy('validate');
    try {
      await api(`/api/dp/vacations/${encodeURIComponent(vacation.id)}`, {
        method: 'PATCH',
        json: { action: 'validate_notice' },
        fallbackError: 'Não foi possível validar o aviso de férias.',
      });
      toast({
        title: 'Aviso validado.',
        description: 'O documento foi liberado para a futura etapa de envio e assinatura.',
      });
      await loadVacationHistory(null);
    } catch (error) {
      toast({
        title: 'Não foi possível validar o aviso.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setNoticeBusy(null);
    }
  }

  async function handleSendNotice(vacation: DPVacationRecord, complianceOverrideReason?: string) {
    setNoticeBusy('send');
    try {
      await api(`/api/dp/vacations/${encodeURIComponent(vacation.id)}`, {
        method: 'PATCH',
        json: { action: 'send_notice', complianceOverrideReason },
        fallbackError: 'Não foi possível enviar o aviso para assinatura.',
      });
      toast({
        title: 'Aviso enviado.',
        description: 'A empregadora e a colaboradora receberam solicitações individuais de assinatura.',
      });
      await loadVacationHistory(null);
    } catch (error) {
      toast({
        title: 'Não foi possível enviar o aviso.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setNoticeBusy(null);
    }
  }

  async function handleSyncNotice(vacation: DPVacationRecord) {
    setNoticeBusy('sync');
    try {
      await api(`/api/dp/vacations/${encodeURIComponent(vacation.id)}`, {
        method: 'PATCH',
        json: { action: 'sync_notice' },
        fallbackError: 'Não foi possível atualizar o acompanhamento.',
      });
      toast({ title: 'Acompanhamento atualizado.' });
      await loadVacationHistory(null);
    } catch (error) {
      toast({
        title: 'Não foi possível atualizar o acompanhamento.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setNoticeBusy(null);
    }
  }

  async function handleWorkflowAction(
    vacation: DPVacationRecord,
    busy: string,
    payload: Record<string, unknown>,
    successTitle: string,
  ) {
    setWorkflowBusy(busy);
    try {
      const response = await api<{ vacation?: { paymentPrepared?: boolean } }>(
        `/api/dp/vacations/${encodeURIComponent(vacation.id)}`,
        {
          method: 'PATCH',
          json: payload,
          fallbackError: 'Não foi possível avançar a trilha de férias.',
        },
      );
      toast({
        title: successTitle,
        description: payload.action === 'review_receipt'
          && payload.decision === 'approved'
          && response.vacation?.paymentPrepared === false
          ? 'O recibo foi aprovado, mas o pagamento exige ajuste no vínculo, CPF ou chave Pix da colaboradora.'
          : undefined,
      });
      await loadVacationHistory(null);
    } catch (error) {
      toast({
        title: 'Não foi possível avançar a trilha.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setWorkflowBusy(null);
    }
  }

  async function handleOpenWorkflowAsset(
    vacation: DPVacationRecord,
    kind: 'receipt-original' | 'receipt-signed' | 'payment-proof',
  ) {
    const preview = window.open('', '_blank');
    setWorkflowBusy(`open-${kind}`);
    try {
      const blob = await api<Blob>(
        `/api/dp/vacations/${encodeURIComponent(vacation.id)}/assets/${kind}`,
        {
          method: 'GET',
          responseType: 'blob',
          fallbackError: 'Não foi possível abrir o documento.',
        },
      );
      const url = URL.createObjectURL(blob);
      if (preview) preview.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      preview?.close();
      toast({
        title: 'Não foi possível abrir o documento.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setWorkflowBusy(null);
    }
  }

  async function handleOpenReceiptDocument(vacation: DPVacationRecord, documentId: string) {
    const preview = window.open('', '_blank');
    setWorkflowBusy(`open-receipt-${documentId}`);
    try {
      const blob = await api<Blob>(
        `/api/dp/vacations/${encodeURIComponent(vacation.id)}/receipt-documents/${encodeURIComponent(documentId)}`,
        {
          method: 'GET',
          responseType: 'blob',
          fallbackError: 'Não foi possível abrir o arquivo recebido.',
        },
      );
      const url = URL.createObjectURL(blob);
      if (preview) preview.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      preview?.close();
      toast({
        title: 'Não foi possível abrir o arquivo.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setWorkflowBusy(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteVacation(deleteTarget.id);
      toast({ title: 'Registro excluído.' });
    } catch {
      toast({ title: 'Erro ao excluir.', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
        <p className="text-sm">Colaborador não encontrado.</p>
        <BackButton fallbackHref="/dashboard/dp/ferias" label="Voltar" variant="ghost" size="sm" />
      </div>
    );
  }

  if (vacationsLoading && vacations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm text-muted-foreground">Carregando férias...</p>
      </div>
    );
  }

  if (vacationsError && vacations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm text-destructive">Erro ao carregar férias: {vacationsError}</p>
        <BackButton fallbackHref="/dashboard/dp/ferias" label="Voltar" variant="ghost" size="sm" />
      </div>
    );
  }

  const today = startOfDay(new Date());
  const shownConcessive = concessiveCycle
    ?? cycles.find(cycle => cycle.status === 'GOZADO' && cycle.concessivePeriod.end >= today);
  const acquisitiveCycle = cycles.find(cycle => cycle.status === 'AQUISITIVO');
  const pastCycles = cycles.filter(cycle => cycle !== shownConcessive && cycle.status !== 'AQUISITIVO');
  const enjoyments = userVacations.filter(record => (
    record.recordType === 'gozo' && record.status !== 'REJECTED' && record.startDate && record.endDate
  ));
  const onVacation = enjoyments.find(record => parseISO(record.startDate!) <= today && parseISO(record.endDate!) >= today);
  const nextVacation = enjoyments
    .filter(record => parseISO(record.startDate!) > today)
    .sort((left, right) => left.startDate!.localeCompare(right.startDate!))[0];
  const nowText = onVacation
    ? `De férias de ${fmtDate(onVacation.startDate)} a ${fmtDate(onVacation.endDate)} · retorna em ${fmtDate(onVacation.returnDate)}.`
    : nextVacation
      ? `Trabalhando. Próximas férias a partir de ${fmtDate(nextVacation.startDate)}.`
      : 'Trabalhando. Nenhuma férias marcada.';
  const openTrails = userVacations
    .filter(record => record.workflow?.status === 'active' && record.status !== 'REJECTED')
    .map(record => ({ record, summary: workflowOperationalSummary(record.workflow!, user.username) }));
  const hrTrail = openTrails.find(trail => trail.summary.owner === 'RH');
  const externalTrail = openTrails.find(trail => !['RH', 'Sistema'].includes(trail.summary.owner));
  // Sem ação pendente a faixa mostra só "Hoje": saldo, prazo e próximo direito já estão nos chips do cabeçalho.
  let todo: { text: string; tone: BandTone } | null = null;
  if (hrTrail) {
    todo = { text: `${hrTrail.summary.action} · férias de ${fmtDate(hrTrail.record.startDate)}.`, tone: 'info' };
  } else if (externalTrail) {
    todo = { text: `Aguardando ${externalTrail.summary.owner}: ${externalTrail.summary.action.toLowerCase()} · férias de ${fmtDate(externalTrail.record.startDate)}.`, tone: 'warn' };
  } else if (concessiveCycle && concessiveCycle.balance > 0 && concessiveNoticeLimit) {
    todo = {
      text: `Agendar ${concessiveCycle.balance} dias até ${fmtDate(concessiveCycle.concessivePeriod.end)}. Para dar o aviso a tempo, marque até ${fmtDate(concessiveNoticeLimit.date)}.`,
      tone: concessiveNoticeLimit.daysLeft <= 60 ? 'danger' : 'warn',
    };
  }
  const nextEntitlement = acquisitiveCycle ? addDays(acquisitiveCycle.acquisitivePeriod.end, 1) : null;
  const canSchedule = canEdit && Boolean(defaultRegistrationCycle);
  const scheduleHint = defaultRegistrationCycle
    ? undefined
    : nextEntitlement ? `Sem saldo agora · o próximo direito libera em ${fmtDate(nextEntitlement)}` : 'Sem saldo para agendar';
  const concessiveRecords = (shownConcessive?.records ?? [])
    .filter(record => record.status !== 'REJECTED')
    .sort((left, right) => (left.startDate ?? '').localeCompare(right.startDate ?? ''));
  const concessiveDaysLeft = shownConcessive ? differenceInCalendarDays(shownConcessive.concessivePeriod.end, today) : 0;
  const concessiveUrgent = Boolean(shownConcessive && shownConcessive.balance > 0 && concessiveDaysLeft <= 120);
  const enjoyedDays = concessiveRecords
    .filter(record => record.recordType === 'gozo' && record.endDate && parseISO(record.endDate) < today)
    .reduce((total, record) => total + record.days, 0);
  const acquisitiveProgress = acquisitiveCycle
    ? Math.max(0, Math.min(100, Math.round(
        differenceInCalendarDays(today, acquisitiveCycle.acquisitivePeriod.start)
        / Math.max(1, differenceInCalendarDays(acquisitiveCycle.acquisitivePeriod.end, acquisitiveCycle.acquisitivePeriod.start)) * 100,
      )))
    : 0;
  const workflowIds = new Set(workflowVacations.map(vacation => vacation.id));
  const openWorkflow = (vacationId: string) => {
    setSelectedWorkflowVacationId(vacationId);
    setWorkflowDrawerOpen(true);
  };
  let parcelNumber = 0;
  const parcelLabels = new Map(concessiveRecords.map(record => [
    record.id,
    record.recordType === 'gozo' ? `Parcela ${++parcelNumber}` : 'Abono pecuniário',
  ]));
  const documentGroups = concessiveRecords
    .filter(record => record.recordType === 'gozo' && record.workflow)
    .slice()
    .reverse()
    .map(record => {
      const workflow = record.workflow!;
      const notice = workflow.notice.status === 'signed'
        ? { detail: 'Assinado', tone: 'ok' as const }
        : workflow.notice.status === 'sent' ? { detail: 'Aguardando assinatura', tone: 'warn' as const } : { detail: 'Ainda não assinado', tone: 'neutral' as const };
      const receipt = workflow.receiptSignature.status === 'signed'
        ? { detail: 'Assinado', tone: 'ok' as const }
        : workflow.receiptSignature.status === 'sent' ? { detail: 'Aguardando assinatura', tone: 'warn' as const } : { detail: 'Assina depois do pagamento', tone: 'neutral' as const };
      return { record, notice, receipt };
    });

  return (
    <div className="space-y-4">
      <div>
        <BackButton fallbackHref="/dashboard/dp/ferias" label="Férias" variant="outline" size="sm" />
      </div>
      <PageHero
        kicker="Férias · Colaborador"
        title={user.username}
        leading={(
          <Avatar className="h-14 w-14 shrink-0 ring-2 ring-white/15">
            <AvatarImage src={user.avatarUrl || undefined} alt={user.username} className="object-cover" />
            <AvatarFallback className="bg-white/10 text-[16px] font-extrabold text-ds-on-dark">
              {user.username.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('')}
            </AvatarFallback>
          </Avatar>
        )}
        subtitle={[user.jobRoleName, admDate ? `admissão em ${fmtDate(admDate)}` : null].filter(Boolean).join(' · ')}
        actions={canEdit ? (
          <span title={scheduleHint}>
            <Button type="button" variant="primary-page" size="md" disabled={!canSchedule} onClick={() => openVacationEditor()}>
              <Plus className="mr-2 h-4 w-4" />
              Agendar férias
            </Button>
          </span>
        ) : null}
        chips={(
          <>
            <HeroChip value={shownConcessive ? `${Math.max(0, shownConcessive.balance)}d` : '—'} label="saldo a agendar" />
            <HeroChip value={shownConcessive ? fmtDate(shownConcessive.concessivePeriod.end) : '—'} label="conceder até" tone={concessiveUrgent ? 'danger' : 'neutral'} />
            {nextEntitlement ? <HeroChip value={fmtDate(nextEntitlement)} label="próximo direito" /> : null}
          </>
        )}
      />

      {health.status === 'INVALIDO' ? (
        <p className="rounded-ds-card border border-ds-alert-border bg-ds-alert-bg px-4 py-3 text-[13px] font-semibold text-ds-alert-ink">
          Data de admissão não cadastrada. Configure o perfil do colaborador para calcular os períodos de férias.
        </p>
      ) : (
        <PersonStatusBar today={nowText} todayTone={onVacation ? 'info' : 'neutral'} action={todo} />
      )}

      {shownConcessive ? <VacationRuleTimeline cycle={shownConcessive} today={today} /> : null}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
          <section aria-label="Período concessivo" className="rounded-ds-card-lg border border-ds-border bg-ds-surface">
            <div className="flex flex-wrap items-start gap-3 px-[18px] pb-3 pt-4">
              <div className="min-w-0 flex-1">
                <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Período concessivo · as férias que precisam ser concedidas</p>
                <p className="mt-1 font-ds-mono text-[15px] font-bold text-ds-ink">
                  {shownConcessive ? `${fmtDate(shownConcessive.acquisitivePeriod.start)} – ${fmtDate(shownConcessive.acquisitivePeriod.end)}` : '—'}
                </p>
              </div>
              {shownConcessive ? (
                <div className="text-right">
                  <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Conceder até</p>
                  <p className={cn('mt-1 font-ds-mono text-[13px] font-bold', concessiveUrgent ? 'text-ds-danger' : 'text-ds-ink')}>
                    {fmtDate(shownConcessive.concessivePeriod.end)} · {concessiveDaysLeft < 0 ? 'vencido' : `em ${concessiveDaysLeft} dias`}
                  </p>
                </div>
              ) : null}
            </div>
            {shownConcessive ? (
              <>
                <div className="px-[18px] pb-3">
                  <div className="flex h-[26px] gap-[3px]">
                    {concessiveRecords.map(record => {
                      const enjoyed = Boolean(record.endDate && parseISO(record.endDate) < today);
                      return (
                        <span
                          key={record.id}
                          className={cn('grid place-items-center overflow-hidden whitespace-nowrap rounded-[7px] text-[11px] font-extrabold text-white', enjoyed ? 'bg-ds-ok' : 'bg-ds-info')}
                          style={{ flex: `${record.days} 1 0` }}
                        >
                          {(parcelLabels.get(record.id) ?? '').replace('Parcela ', 'P')} · {record.days}d
                        </span>
                      );
                    })}
                    {shownConcessive.balance > 0 || concessiveRecords.length === 0 ? (
                      <span className="grid place-items-center overflow-hidden whitespace-nowrap rounded-[7px] bg-ds-neutral-bg text-[11px] font-extrabold text-ds-ink-2" style={{ flex: `${Math.max(1, shownConcessive.balance)} 1 0` }}>
                        Saldo · {Math.max(0, shownConcessive.balance)}d
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-[12px] font-semibold text-ds-ink-muted">
                    30 dias de direito · {enjoyedDays} gozados · {Math.max(0, shownConcessive.takenDays - enjoyedDays)} agendados · {Math.max(0, shownConcessive.balance)} de saldo
                  </p>
                </div>
                {concessiveRecords.length === 0 ? (
                  <p className="border-t border-ds-divider px-[18px] py-3 text-[13px] text-ds-ink-muted">Nenhuma parcela agendada. Use Agendar férias no topo.</p>
                ) : concessiveRecords.map(record => (
                  <ParcelRow
                    key={record.id}
                    record={record}
                    label={parcelLabels.get(record.id) ?? 'Parcela'}
                    employeeName={user.username}
                    today={today}
                    canEdit={canEdit}
                    canApprove={canApprove}
                    hasWorkflow={workflowIds.has(record.id)}
                    onOpenWorkflow={() => openWorkflow(record.id)}
                    onEdit={openVacationEdit}
                    onDelete={setDeleteTarget}
                    onReview={setDecisionVacation}
                  />
                ))}
              </>
            ) : (
              <p className="px-[18px] pb-4 text-[13px] text-ds-ink-muted">Ainda não há período concessivo: o primeiro período aquisitivo não completou.</p>
            )}
          </section>

          <section aria-label="Período aquisitivo" className="flex flex-wrap items-center gap-4 rounded-ds-card-lg border border-ds-border bg-ds-surface px-[18px] py-4">
            <div className="min-w-0 flex-[1_1_260px]">
              <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Período aquisitivo · ganhando o próximo direito</p>
              <p className="mt-1 font-ds-mono text-[15px] font-bold text-ds-ink">
                {acquisitiveCycle ? `${fmtDate(acquisitiveCycle.acquisitivePeriod.start)} – ${fmtDate(acquisitiveCycle.acquisitivePeriod.end)}` : '—'}
              </p>
            </div>
            <div className="min-w-0 flex-[1_1_260px]">
              <span className="block h-2 overflow-hidden rounded-full bg-ds-neutral-bg">
                <span className="block h-full rounded-full bg-ds-info" style={{ width: `${acquisitiveProgress}%` }} />
              </span>
              <p className="mt-1.5 text-[12px] font-semibold text-ds-ink-muted">
                {acquisitiveCycle
                  ? `${acquisitiveProgress}% do período · completa em ${fmtDate(acquisitiveCycle.acquisitivePeriod.end)} · 30 dias previstos, agendáveis depois disso`
                  : 'Sem período em aquisição'}
              </p>
            </div>
          </section>

          <section aria-label="Períodos anteriores" className="rounded-ds-card-lg border border-ds-border bg-ds-surface">
            <div className="flex flex-wrap items-center gap-2 px-[18px] pb-2 pt-3.5">
              <h2 className="text-[14px] font-extrabold text-ds-ink">Períodos anteriores</h2>
              <span className="text-[12px] text-ds-ink-muted">
                {pastCycles.length ? `${pastCycles.length} desde ${admDate ? fmtDate(admDate) : 'a admissão'}` : 'Nenhum período anterior'}
              </span>
              {vacationHistoryCursor ? (
                <Button type="button" variant="ds-secondary" size="xs" className="ml-auto" disabled={vacationHistoryLoading} onClick={() => void loadVacationHistory(vacationHistoryCursor)}>
                  {vacationHistoryLoading ? 'Carregando…' : 'Carregar períodos mais antigos'}
                </Button>
              ) : null}
            </div>
            {vacationsLoading ? (
              <p className="px-[18px] pb-4 text-[13px] text-ds-ink-muted">Carregando períodos…</p>
            ) : pastCycles.map(cycle => (
              <details key={cycle.id} className="group border-t border-ds-divider">
                <summary className="grid cursor-pointer list-none grid-cols-[minmax(200px,1fr)_100px_150px_minmax(150px,auto)_16px] items-center gap-3 px-[18px] py-3 marker:content-none hover:bg-ds-muted">
                  <span className="font-ds-mono text-[12.5px] font-bold text-ds-ink">{fmtDate(cycle.acquisitivePeriod.start)} – {fmtDate(cycle.acquisitivePeriod.end)}</span>
                  <span className="text-[13px] font-bold text-ds-ink-2">{cycle.takenDays} dias</span>
                  <span className="font-ds-mono text-[12.5px] font-bold text-ds-ink-2">até {fmtDate(cycle.concessivePeriod.end)}</span>
                  <VacationPill tone={cycle.status === 'GOZADO' ? 'ok' : cycle.status === 'VENCIDO' ? 'danger' : 'warn'}>
                    {CYCLE_STATUS_CONFIG[cycle.status].label}
                  </VacationPill>
                  <span aria-hidden="true" className="text-ds-ink-faint transition-transform group-open:rotate-90">›</span>
                </summary>
                <div className="px-3 pb-3">
                  <CycleCard
                    cycle={cycle}
                    canEdit={canEdit}
                    canApprove={canApprove}
                    onAdd={openVacationEditor}
                    onEdit={openVacationEdit}
                    onDelete={setDeleteTarget}
                    onReview={setDecisionVacation}
                  />
                </div>
              </details>
            ))}
          </section>
        </div>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <section aria-label="Documentos de férias" className="rounded-ds-card-lg border border-ds-border bg-ds-surface">
            <div className="px-4 pb-2 pt-3.5">
              <h2 className="text-[14px] font-extrabold text-ds-ink">Documentos de férias</h2>
              <p className="mt-0.5 text-[12px] text-ds-ink-muted">Por parcela do período concessivo, mais recente primeiro</p>
            </div>
            {documentGroups.length === 0 ? (
              <p className="border-t border-ds-divider px-4 py-3 text-[12.5px] text-ds-ink-muted">Nenhum documento ainda.</p>
            ) : documentGroups.map(({ record, notice, receipt }) => (
              <div key={record.id} className="border-t border-ds-divider px-4 py-2.5">
                <p className="text-[12.5px] font-extrabold text-ds-ink">{parcelLabels.get(record.id)} · {fmtDate(record.startDate)} a {fmtDate(record.endDate)}</p>
                <div className="mt-1.5 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-[12.5px] font-bold text-ds-ink-2">Aviso de férias</span>
                    <VacationPill tone={notice.tone}>{notice.detail}</VacationPill>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-[12.5px] font-bold text-ds-ink-2">Recibo de férias</span>
                    <VacationPill tone={receipt.tone}>{receipt.detail}</VacationPill>
                  </div>
                </div>
              </div>
            ))}
          </section>
          {selectedWorkflowVacation ? (
            <details className="rounded-ds-card-lg border border-ds-border bg-ds-surface">
              <summary className="cursor-pointer list-none px-4 py-3.5 text-[14px] font-extrabold text-ds-ink marker:content-none">Histórico auditável</summary>
              <div className="border-t border-ds-divider">
                <DPVacationAuditTimeline
                  vacationId={selectedWorkflowVacation.id}
                  version={selectedWorkflowVacation.workflow?.updatedAt ?? String(selectedWorkflowVacation.updatedAt ?? '')}
                  embedded
                />
              </div>
            </details>
          ) : null}
        </aside>
      </div>

      <SidePanel
        open={workflowDrawerOpen && Boolean(drawerWorkflowVacation)}
        onOpenChange={setWorkflowDrawerOpen}
        kicker={drawerWorkflowVacation ? `Férias · ${parcelLabels.get(drawerWorkflowVacation.id) ?? 'Parcela'}` : 'Férias'}
        title={user.username}
        subtitle={drawerWorkflowVacation ? `${fmtDate(drawerWorkflowVacation.startDate)} a ${fmtDate(drawerWorkflowVacation.endDate)} · ${drawerWorkflowVacation.days} dias` : undefined}
        className="w-[860px]"
      >
        <DPVacationWorkflowPanel
          records={workflowVacations}
          registrationCycle={defaultRegistrationCycle}
          selectedId={selectedWorkflowVacationId}
          canEdit={canEdit}
          canApprove={canApprove}
          onRegister={() => openVacationEditor()}
          onSelect={setSelectedWorkflowVacationId}
          onEdit={openVacationEdit}
          onApprove={setDecisionVacation}
          onGenerateNotice={handleGenerateNotice}
          onValidateNotice={handleValidateNotice}
          onOpenNotice={handleOpenNotice}
          onSendNotice={handleSendNotice}
          onSyncNotice={handleSyncNotice}
          noticeBusy={noticeBusy}
          workflowBusy={workflowBusy}
          onSendAccountant={(vacation) => handleWorkflowAction(vacation, 'accountant', { action: 'send_accountant' }, 'Solicitação enviada à contabilidade.')}
          onSelectReceiptDocument={(vacation, documentId) => handleWorkflowAction(
            vacation,
            `select-receipt-${documentId}`,
            { action: 'select_receipt_document', documentId },
            'Recibo principal confirmado pelo RH.',
          )}
          onDiscardReceiptDocument={(vacation, documentId) => handleWorkflowAction(
            vacation,
            `discard-receipt-${documentId}`,
            { action: 'discard_receipt_document', documentId },
            'Arquivo de recibo descartado.',
          )}
          onReviewReceipt={(vacation, review) => handleWorkflowAction(
            vacation,
            review.decision === 'approved' ? 'approve-receipt' : 'correct-receipt',
            { action: 'review_receipt', ...review },
            review.decision === 'approved' ? 'Recibo aprovado.' : 'Correção solicitada à contabilidade.',
          )}
          onPreparePayment={(vacation) => handleWorkflowAction(vacation, 'prepare-payment', { action: 'prepare_payment' }, 'Pagamento preparado para o Financeiro.')}
          onSyncPayment={(vacation) => handleWorkflowAction(vacation, 'sync-payment', { action: 'sync_payment' }, 'Situação do pagamento atualizada.')}
          onRetryReceiptSignature={(vacation) => handleWorkflowAction(vacation, 'retry-receipt-signature', { action: 'retry_receipt_signature' }, 'Recibo enviado para assinatura.')}
          onSyncReceiptSignature={(vacation) => handleWorkflowAction(vacation, 'sync-receipt-signature', { action: 'sync_receipt_signature' }, 'Assinatura do recibo atualizada.')}
          onFinalizeWorkflow={(vacation) => handleWorkflowAction(vacation, 'finalize', { action: 'finalize_workflow' }, 'Trilha de férias finalizada.')}
          onOpenWorkflowAsset={handleOpenWorkflowAsset}
          onOpenReceiptDocument={handleOpenReceiptDocument}
          onCancel={handleCancel}
        />
      </SidePanel>

      <Sheet
        open={Boolean(decisionVacation && decisionCycle)}
        onOpenChange={open => { if (!open) setDecisionVacation(null); }}
      >
        <SheetContent
          side="right"
          className="flex w-[560px] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]"
          style={{ height: '100dvh', minHeight: '100dvh', maxHeight: '100dvh' }}
        >
          {decisionVacation && decisionCycle ? (
            <DPVacationDecisionPanel
              key={decisionVacation.id}
              employeeName={user.username}
              record={decisionVacation}
              cycle={decisionCycle}
              calendarName={calendars.find(calendar => calendar.id === decisionVacation.calendarId)?.name}
              canApprove={canApprove}
              onBack={() => setDecisionVacation(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet
        open={Boolean(canEdit && (scheduleOpen || editVacation) && editorCycle)}
        onOpenChange={open => { if (!open) closeVacationEditor(); }}
      >
        <SheetContent
          side="right"
          className="flex w-[560px] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]"
          style={{ height: '100dvh', minHeight: '100dvh', maxHeight: '100dvh' }}
        >
          {editorCycle ? (
            <DPVacationEditorPanel
              key={`${editorCycle.id}:${editVacation?.id ?? 'new'}`}
              employeeName={user.username}
              userId={userId}
              cycle={editorCycle}
              calendars={calendars}
              record={editVacation ?? undefined}
              onBack={closeVacationEditor}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir registro?</AlertDialogTitle>
            <AlertDialogDescription>
              O registro de {deleteTarget?.days} dias será excluído permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!decisionTarget}
        onOpenChange={(open) => {
          if (!open && !deciding) {
            setDecisionTarget(null);
            setDecisionReason('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {decisionTarget?.action === 'cancel' ? 'Cancelar férias formalmente?' : 'Rejeitar agendamento?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              A justificativa ficará registrada na trilha de auditoria. Férias com pagamento já preparado ou confirmado não podem ser canceladas por esta ação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={decisionReason}
            onChange={(event) => setDecisionReason(event.target.value)}
            placeholder="Informe o motivo (mínimo de 10 caracteres)"
            className="min-h-24"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deciding}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDecision}
              disabled={deciding || decisionReason.trim().length < 10}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deciding ? 'Registrando...' : 'Confirmar com justificativa'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
