"use client";

import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';

import { useDP } from '@/components/dp-context';
import { useAuth } from '@/hooks/use-auth';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import type { DPVacationRecord } from '@/types';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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
import { shouldDisplayVacationWorkflow } from '@/lib/dp-vacation-workflow';

import {
  calculateVacationHealth,
  getVacationCycleHistory,
  RISK_PROGRESS_CLASS,
  CYCLE_STATUS_CONFIG,
  type VacationCycle,
  type VacationRisk,
} from '@/lib/utils/vacation-logic';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

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

// ─── Risk config ──────────────────────────────────────────────────────────────

const RISK_CONFIG: Record<VacationRisk, { label: string; text: string; bg: string }> = {
  VENCIDA:  { label: 'Vencida',   text: 'text-red-700 dark:text-red-300',      bg: 'bg-red-100 dark:bg-red-900/30'      },
  CRITICA:  { label: 'Crítica',   text: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  ATENCAO:  { label: 'Atenção',   text: 'text-yellow-700 dark:text-yellow-300', bg: 'bg-yellow-100 dark:bg-yellow-900/30' },
  EM_DIA:   { label: 'Em dia',    text: 'text-green-700 dark:text-green-300',   bg: 'bg-green-100 dark:bg-green-900/30'   },
};

// ─── Vacation record status config ────────────────────────────────────────────

const STATUS_CONFIG = {
  PENDING:  { label: 'Pendente',  bg: 'bg-amber-100 dark:bg-amber-900/30',  text: 'text-amber-700 dark:text-amber-300'  },
  PLANNED:  { label: 'Planejado', bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300' },
  APPROVED: { label: 'Aprovado',  bg: 'bg-green-100 dark:bg-green-900/30',  text: 'text-green-700 dark:text-green-300'  },
  REJECTED: { label: 'Rejeitado', bg: 'bg-red-100 dark:bg-red-900/30',      text: 'text-red-700 dark:text-red-300'      },
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

// ─── Main Profile Component ───────────────────────────────────────────────────

interface DPFeriasProfileProps {
  userId: string;
  initialRegistrationOpen?: boolean;
}

export function DPFeriasProfile({ userId, initialRegistrationOpen = false }: DPFeriasProfileProps) {
  const { users, permissions } = useAuth();
  const { deleteVacation } = useDP();
  const { vacations, calendars, vacationsLoading, vacationsError } = useDPBootstrap();
  const { toast } = useToast();
  const api = useAuthenticatedApi();

  const canEdit    = permissions.dp?.vacation?.request ?? false;
  const canApprove = permissions.dp?.vacation?.approve ?? false;

  const [scheduleOpen, setScheduleOpen] = useState(initialRegistrationOpen);
  const [editVacation, setEditVacation] = useState<DPVacationRecord | null>(null);
  const [decisionVacation, setDecisionVacation] = useState<DPVacationRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DPVacationRecord | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<{ record: DPVacationRecord; action: 'reject' | 'cancel' } | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [selectedCycleId, setSelectedCycleId] = useState<string | undefined>();
  const [selectedWorkflowVacationId, setSelectedWorkflowVacationId] = useState<string | null>(null);
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
  const workflowCycle = useMemo(
    () => concessiveCycle ?? cycles.find(cycle => cycle.records.length > 0),
    [concessiveCycle, cycles],
  );
  const cycleCounts = useMemo(() => ({
    acquisition: cycles.filter(cycle => cycle.status === 'AQUISITIVO').length,
    concessive: cycles.filter(cycle => !['AQUISITIVO', 'GOZADO', 'VENCIDO'].includes(cycle.status)).length,
    closed: cycles.filter(cycle => cycle.status === 'GOZADO').length,
    overdue: cycles.filter(cycle => cycle.status === 'VENCIDO').length,
  }), [cycles]);
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
  const selectedWorkflowVacation = workflowVacations.find(vacation => vacation.id === selectedWorkflowVacationId)
    ?? workflowVacations[0];

  React.useEffect(() => {
    if (!workflowVacations.length) {
      setSelectedWorkflowVacationId(null);
      return;
    }
    if (!workflowVacations.some(vacation => vacation.id === selectedWorkflowVacationId)) {
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/dashboard/dp/ferias" ariaLabel="Voltar à página anterior" iconOnly variant="ghost" size="icon" iconClassName="h-4 w-4" />
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarImage src={user.avatarUrl} />
            <AvatarFallback>{initials(user.username)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold truncate">{user.username}</h1>
            {admDate && (
              <p className="text-sm text-muted-foreground">
                Admissão: {fmtDate(admDate)}
              </p>
            )}
          </div>
        </div>
        {canEdit && defaultRegistrationCycle && workflowVacations.length > 0 && (
          <Button size="sm" onClick={() => openVacationEditor()}>
            <Plus className="mr-2 h-4 w-4" />
            Registrar férias
          </Button>
        )}
      </div>

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
        onCancel={handleCancel}
      />

      <section className="overflow-hidden rounded-[18px] border bg-card shadow-sm">
        <div className="border-b px-4 py-3.5">
          <p className="text-sm font-black">Ciclos e histórico</p>
          <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
            Consulte o prazo concessivo, os saldos, os lançamentos e a auditoria em um único bloco.
          </p>
        </div>

        {selectedWorkflowVacation ? (
          <details className="group border-b bg-background">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-[12px] font-black text-slate-700 marker:content-none">
              <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Histórico auditável</span>
              <span className="text-[10px] font-semibold text-slate-500 group-open:hidden">Mostrar</span>
              <span className="hidden text-[10px] font-semibold text-slate-500 group-open:inline">Ocultar</span>
            </summary>
            <div className="border-t border-slate-100">
              <DPVacationAuditTimeline
                vacationId={selectedWorkflowVacation.id}
                version={selectedWorkflowVacation.workflow?.updatedAt ?? String(selectedWorkflowVacation.updatedAt ?? '')}
                embedded
              />
            </div>
          </details>
        ) : null}

        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-3">

        {/* Left: Health Summary */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="border-0 bg-muted/25 shadow-none">
            <CardContent className="space-y-2.5 p-3">
              {health.status === 'INVALIDO' && (
                <p className="text-sm text-muted-foreground">
                  Data de admissão não cadastrada. Configure o perfil do colaborador.
                </p>
              )}

              {health.status === 'CONCESSIVO' && (() => {
                const risk = health.details.risk;
                const rcfg = RISK_CONFIG[risk];
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-muted-foreground">Período Concessivo</p>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${rcfg.bg} ${rcfg.text}`}>
                        {rcfg.label}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Prazo</span>
                        <span className="font-medium">{fmtDate(health.details.deadline)}</span>
                      </div>
                      <Progress
                        value={health.details.progress}
                        className={`h-2 ${RISK_PROGRESS_CLASS[risk]}`}
                      />
                    </div>

                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>Aquisitivo: {fmtDate(health.details.acquisitivePeriod.start)} → {fmtDate(health.details.acquisitivePeriod.end)}</p>
                    </div>

                    <Badge variant="secondary" className="text-xs">
                      {CYCLE_STATUS_CONFIG[health.cycleStatus]?.label ?? health.cycleStatus}
                    </Badge>
                  </>
                );
              })()}

              {health.status === 'AQUISITIVO' && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-muted-foreground">Período Aquisitivo</p>
                    <Badge variant="secondary" className="text-xs">Em Aquisição</Badge>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Progresso</span>
                      <span>{Math.round(health.details.progress)}%</span>
                    </div>
                    <Progress value={health.details.progress} className="h-2" />
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {fmtDate(health.details.start)} → {fmtDate(health.details.end)}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Summary stats */}
          <Card className="border-0 bg-muted/25 shadow-none">
            <CardContent className="p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ciclos</p>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-sky-500" />Em aquisição</span>
                  <span className="font-semibold tabular-nums">{cycleCounts.acquisition}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-amber-500" />Em período concessivo</span>
                  <span className="font-semibold tabular-nums">{cycleCounts.concessive}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-500" />Encerrados</span>
                  <span className="font-semibold tabular-nums">{cycleCounts.closed}</span>
                </div>
                {cycleCounts.overdue > 0 ? (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 text-red-700"><span className="h-2 w-2 rounded-full bg-red-500" />Vencidos</span>
                    <span className="font-semibold tabular-nums text-red-700">{cycleCounts.overdue}</span>
                  </div>
                ) : null}
              </div>

              <div className="my-3 border-t" />

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Férias do ciclo concessivo</p>
                {concessiveCycle ? <span className="text-[10px] font-bold text-muted-foreground">{concessiveCycle.id}</span> : null}
              </div>
              {concessiveCycle ? (
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Períodos lançados</span>
                    <span className="font-semibold tabular-nums">{concessiveCycle.records.length}</span>
                  </div>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Dias distribuídos</span>
                    <span className="font-semibold tabular-nums">{concessiveCycle.takenDays}d</span>
                  </div>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Saldo a programar</span>
                    <span className="font-semibold tabular-nums">{Math.max(0, concessiveCycle.balance)}d</span>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs font-medium text-muted-foreground">Nenhum ciclo em período concessivo.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Cycle History */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Histórico de Ciclos
            </p>
            {vacationHistoryCursor ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={vacationHistoryLoading}
                onClick={() => void loadVacationHistory(vacationHistoryCursor)}
              >
                {vacationHistoryLoading ? 'Carregando...' : 'Carregar períodos anteriores'}
              </Button>
            ) : null}
          </div>

          {vacationsLoading ? (
            <div className="space-y-3">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-32 rounded-xl border bg-muted/20 animate-pulse" />
              ))}
            </div>
          ) : cycles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2 rounded-xl border border-dashed">
              <CalendarDays className="h-8 w-8 opacity-30" />
              <p className="text-sm">Data de admissão necessária para calcular ciclos.</p>
            </div>
          ) : (
            cycles.map(cycle => (
              <CycleCard
                key={cycle.id}
                cycle={cycle}
                canEdit={canEdit}
                canApprove={canApprove}
                onAdd={openVacationEditor}
                onEdit={openVacationEdit}
                onDelete={setDeleteTarget}
                onReview={setDecisionVacation}
              />
            ))
          )}
        </div>
        </div>
      </section>

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
