"use client";

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  format, parseISO, isAfter, startOfDay,
} from 'date-fns';

import { useAuth } from '@/hooks/use-auth';
import { useDP } from '@/components/dp-context';
import { useDPBootstrap } from '@/hooks/use-dp-bootstrap';
import { useToast } from '@/hooks/use-toast';
import type { DPVacationRecord } from '@/types';
import {
  Sheet, SheetContent,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
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
import { ExternalLink, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { DPVacationDecisionPanel } from './dp-vacation-decision-panel';
import { DPVacationEditorPanel } from './dp-vacation-editor-panel';
import {
  getVacationCycleHistory,
  getCycleRisk,
  getCycleProgress,
  RISK_HEX,
  VACATION_STATUS_HEX,
  type VacationCycle,
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

function fmt(d?: string | Date) {
  if (!d) return '—';
  try {
    const dt = typeof d === 'string' ? parseISO(d) : d;
    return format(dt, 'dd/MM/yyyy');
  } catch { return String(d); }
}

const DONE = { fg: '#15803D', bg: 'rgba(34,197,94,0.14)', label: 'Concluído' };
const SCHEDULED = { fg: '#7C3AED', bg: 'rgba(139,92,246,0.14)', label: 'Agendada' };
const AWAITING_APPROVAL = { fg: '#A16207', bg: 'rgba(234,179,8,0.16)', label: 'Aguardando aprovação' };
const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'] as const;

interface Props {
  userId: string | null;
  canEdit: boolean;
  canApprove: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DPFeriasDrawer({ userId, canEdit, canApprove, onOpenChange }: Props) {
  const { users } = useAuth();
  const { vacations, units, calendars } = useDPBootstrap();

  const user = userId ? users.find(u => u.id === userId) : undefined;
  const unitName = user?.unitIds?.[0]
    ? units.find(u => u.id === user.unitIds![0])?.name ?? ''
    : '';

  return (
    <Sheet open={!!userId} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[560px] max-w-[95vw] flex-col gap-0 p-0 sm:max-w-[560px]"
      >
        {user && (
          <DrawerBody
            key={user.id}
            user={user}
            unitName={unitName}
            vacations={vacations.filter(v => v.userId === user.id)}
            calendars={calendars}
            canEdit={canEdit}
            canApprove={canApprove}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Drawer body ──────────────────────────────────────────────────────────────

interface DrawerBodyProps {
  user: ReturnType<typeof useAuth>['users'][number];
  unitName: string;
  vacations: DPVacationRecord[];
  calendars: ReturnType<typeof useDPBootstrap>['calendars'];
  canEdit: boolean;
  canApprove: boolean;
}

function DrawerBody({ user, unitName, vacations, calendars, canEdit, canApprove }: DrawerBodyProps) {
  const router = useRouter();
  const { deleteVacation } = useDP();
  const { toast } = useToast();
  const today = startOfDay(new Date());
  const admDate = toDate(user.admissionDate);
  const [decision, setDecision] = useState<{ recordId: string; cycleId: string } | null>(null);
  const [editor, setEditor] = useState<{ cycleId: string; recordId?: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DPVacationRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const cycles = useMemo(
    () => (admDate ? getVacationCycleHistory(admDate, vacations) : []),
    [admDate, vacations],
  );
  const calendarNames = useMemo(
    () => new Map(calendars.map(calendar => [calendar.id, calendar.name])),
    [calendars],
  );

  // Concessive cycles only (exclude the still-accumulating aquisitivo one).
  const concessive = useMemo(
    () => cycles.filter(c => c.status !== 'AQUISITIVO'),
    [cycles],
  );
  const openCycles = useMemo(
    () => concessive
      .filter(c => c.status !== 'GOZADO' && c.status !== 'AGENDADO' && c.status !== 'AGUARDANDO_APROVACAO')
      .sort((a, b) => a.concessivePeriod.end.getTime() - b.concessivePeriod.end.getTime()),
    [concessive],
  );

  const multiOpen = openCycles.length > 1;
  const noCycles = concessive.length === 0;
  const decisionRecord = decision
    ? vacations.find(record => record.id === decision.recordId)
    : undefined;
  const decisionCycle = decision
    ? concessive.find(cycle => cycle.id === decision.cycleId)
    : undefined;
  const editorCycle = editor
    ? concessive.find(cycle => cycle.id === editor.cycleId)
    : undefined;
  const editorRecord = editor?.recordId
    ? vacations.find(record => record.id === editor.recordId)
    : undefined;

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteVacation(deleteTarget.id);
      toast({ title: 'Registro de férias excluído.' });
      setDeleteTarget(null);
    } catch (error) {
      toast({
        title: 'Não foi possível excluir o registro.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  }

  if (editorCycle && (!editor?.recordId || editorRecord)) {
    return (
      <DPVacationEditorPanel
        employeeName={user.username}
        userId={user.id}
        cycle={editorCycle}
        calendars={calendars}
        record={editorRecord}
        onBack={() => setEditor(null)}
      />
    );
  }

  if (decisionRecord && decisionCycle) {
    return (
      <DPVacationDecisionPanel
        employeeName={user.username}
        record={decisionRecord}
        cycle={decisionCycle}
        calendarName={calendars.find(calendar => calendar.id === decisionRecord.calendarId)?.name}
        canApprove={canApprove}
        onBack={() => setDecision(null)}
      />
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-[22px] py-5">
        <span
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
          style={{ background: user.color || '#8B5CF6' }}
        >
          {initials(user.username)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-bold">{user.username}</h3>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {[user.jobRoleName, unitName].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-[22px] py-[18px]">
        {multiOpen && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-3">
            <span className="flex-shrink-0 text-sm text-amber-600 dark:text-amber-400">⚠</span>
            <p className="text-xs leading-relaxed">
              {openCycles.length} ciclos concessivos em aberto ao mesmo tempo. O mais urgente é o{' '}
              <b>Ciclo {openCycles[0].id}</b>, vencido/vencendo em {fmt(openCycles[0].concessivePeriod.end)}.
            </p>
          </div>
        )}

        {noCycles && (
          <p className="text-xs text-muted-foreground">
            Ainda em período aquisitivo — nenhum ciclo concessivo aberto.
          </p>
        )}

        {concessive.map(cycle => (
          <CycleBlock
            key={cycle.id}
            cycle={cycle}
            records={vacations.filter(record => record.cycleId === cycle.id)}
            calendarNames={calendarNames}
            canEdit={canEdit}
            canApprove={canApprove}
            today={today}
            onReview={record => setDecision({ recordId: record.id, cycleId: cycle.id })}
            onRegister={() => setEditor({ cycleId: cycle.id })}
            onEdit={record => setEditor({ cycleId: cycle.id, recordId: record.id })}
            onDelete={setDeleteTarget}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="border-t px-[22px] py-3">
        <button
          onClick={() => router.push(`/dashboard/dp/ferias/${user.id}`)}
          className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
        >
          Ver perfil completo <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir período lançado?</AlertDialogTitle>
            <AlertDialogDescription>
              O período será removido antes da comunicação formal. A exclusão e o conteúdo anterior permanecerão registrados na auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={event => { event.preventDefault(); void confirmDelete(); }}>
              {deleting ? 'Excluindo...' : 'Excluir período'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── One cycle ────────────────────────────────────────────────────────────────

function CycleBlock({
  cycle, records, calendarNames, canEdit, canApprove, today, onReview, onRegister, onEdit, onDelete,
}: {
  cycle: VacationCycle;
  records: DPVacationRecord[];
  calendarNames: ReadonlyMap<string, string>;
  canEdit: boolean;
  canApprove: boolean;
  today: Date;
  onReview: (record: DPVacationRecord) => void;
  onRegister: () => void;
  onEdit: (record: DPVacationRecord) => void;
  onDelete: (record: DPVacationRecord) => void;
}) {
  const done = cycle.status === 'GOZADO';
  const scheduled = cycle.status === 'AGENDADO';
  const awaitingApproval = cycle.status === 'AGUARDANDO_APROVACAO';
  const risk = getCycleRisk(cycle, today);
  const progress = Math.round(getCycleProgress(cycle, today));
  const rc = done ? DONE : scheduled ? SCHEDULED : awaitingApproval ? AWAITING_APPROVAL : RISK_HEX[risk];

  const active = records.filter(r => r.status !== 'REJECTED');
  const gozoDays = active.filter(r => r.recordType === 'gozo').reduce((t, r) => t + r.days, 0);
  const sold = active.filter(r => r.recordType === 'venda').reduce((t, r) => t + r.days, 0);
  const balance = Math.max(0, cycle.balance);

  const gozoSummary = done
    ? `${gozoDays}d gozados`
    : scheduled
      ? `${gozoDays}d programados`
      : awaitingApproval
        ? `${gozoDays}d lançados`
        : `${gozoDays}d de gozo`;
  const summaryLine = gozoSummary
    + (sold ? ` · ${sold}d vendidos` : '')
    + (awaitingApproval ? ' · aprovação pendente' : balance ? ` · ${balance}d em aberto` : ' · completo');

  return (
    <div
      className="rounded-xl border border-l-[3px] p-4"
      style={{ borderLeftColor: rc.fg }}
    >
      <div className="flex items-start gap-3">
        {!done ? (
          <div
            className="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-full"
            style={{ background: `conic-gradient(from -90deg, ${rc.fg} ${progress * 3.6}deg, hsl(var(--secondary)) 0deg)` }}
          >
            <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-card">
              <span className="text-[11px] font-extrabold">{progress}%</span>
            </div>
          </div>
        ) : (
          <div className="flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-full bg-green-500/15 text-[22px] text-green-700 dark:text-green-400">
            ✓
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-[15px] font-bold">Ciclo {cycle.id}</h4>
            <span
              className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
              style={{ background: rc.bg, color: rc.fg }}
            >
              {rc.label}
            </span>
          </div>
          <div className="mt-1 text-[11.5px] text-muted-foreground">
            Concessivo {fmt(cycle.concessivePeriod.start)} → {fmt(cycle.concessivePeriod.end)}
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">{summaryLine}</div>
        </div>
      </div>

      {records.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {records.map(r => (
            <RecordRow
              key={r.id}
              record={r}
              concessiveEnd={cycle.concessivePeriod.end}
              calendarName={r.calendarId ? calendarNames.get(r.calendarId) : undefined}
              canEdit={canEdit}
              canApprove={canApprove}
              onReview={() => onReview(r)}
              onEdit={() => onEdit(r)}
              onDelete={() => onDelete(r)}
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[11.5px] text-muted-foreground">Nenhum período lançado neste ciclo ainda.</p>
      )}

      {balance > 0 && canEdit && (
        <Button type="button" size="sm" className="mt-3 w-full rounded-[10px]" onClick={onRegister}>
          <Plus className="mr-2 h-4 w-4" />
          Registrar neste ciclo
        </Button>
      )}
    </div>
  );
}

// ─── One record row ───────────────────────────────────────────────────────────

function RecordRow({
  record,
  concessiveEnd,
  calendarName,
  canEdit,
  canApprove,
  onReview,
  onEdit,
  onDelete,
}: {
  record: DPVacationRecord;
  concessiveEnd: Date;
  calendarName?: string;
  canEdit: boolean;
  canApprove: boolean;
  onReview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isVenda = record.recordType === 'venda';
  const awaitingDecision = record.status === 'PENDING' || record.status === 'PLANNED';
  const canEditRecord = canEdit && awaitingDecision;
  const canDeleteRecord = canApprove && (!record.workflow || ['not_generated', 'failed'].includes(record.workflow.notice.status));
  const s = VACATION_STATUS_HEX[record.status] ?? VACATION_STATUS_HEX.PENDING;
  const withinConcessivePeriod = isVenda || !record.endDate ? true : !isAfter(parseISO(record.endDate), concessiveEnd);
  const noticeLeadDays = record.workflow?.legalAnalysis.noticeLeadDays;
  const noticeCompliance = record.workflow?.legalAnalysis.noticeCompliance;
  const noticeOnTime = noticeCompliance === 'compliant'
    || (noticeCompliance !== 'exception' && noticeLeadDays != null && noticeLeadDays >= 30);
  const noticeLate = noticeCompliance === 'exception'
    || (noticeLeadDays != null && noticeLeadDays < 30);
  const noticeBadge = noticeOnTime
    ? { fg: '#15803D', bg: 'rgba(34,197,94,0.14)', label: 'Aviso no prazo' }
    : noticeLate
      ? { fg: '#DC2626', bg: 'rgba(239,68,68,0.13)', label: 'Aviso fora do prazo' }
      : { fg: '#475569', bg: 'rgba(148,163,184,0.16)', label: 'Aviso pendente' };
  const deadlineBadge = withinConcessivePeriod
    ? { fg: '#15803D', bg: 'rgba(34,197,94,0.14)', label: 'No prazo' }
    : { fg: '#DC2626', bg: 'rgba(239,68,68,0.13)', label: 'Fora do prazo' };
  const detail = isVenda
    ? [
        'Abono pecuniário',
        record.allowanceRequestedAt ? `pedido em ${fmt(record.allowanceRequestedAt)}` : null,
      ].filter(Boolean).join(' · ')
    : [
        `${fmt(record.startDate)} → ${fmt(record.endDate)}`,
        record.calendarId ? `calendário ${calendarName ?? 'cadastrado'}` : null,
        `descanso semanal ${WEEKDAYS[record.weeklyRestDay ?? 0] ?? 'não informado'}`,
        record.returnDate ? `retorno ${fmt(record.returnDate)}` : null,
        noticeLeadDays != null ? `aviso ${noticeLeadDays} dias antes` : null,
        record.workflow?.payment.paidAt ? `pago em ${fmt(record.workflow.payment.paidAt)}` : null,
      ].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-wrap items-start gap-2.5 rounded-[10px] bg-muted px-3 py-2.5">
      <div
        className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg text-xs font-extrabold"
        style={
          isVenda
            ? { background: 'rgba(59,130,246,0.14)', color: '#1D4ED8' }
            : { background: 'rgba(139,92,246,0.14)', color: '#7C3AED' }
        }
      >
        {isVenda ? '$' : 'G'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12.5px] font-semibold">{isVenda ? 'Venda (abono)' : 'Gozo'}</span>
          <span className="text-[11.5px] font-bold">{record.days}d</span>
          <span
            className="rounded-full px-2 py-px text-[10.5px] font-semibold"
            style={{ background: s.bg, color: s.fg }}
          >
            {s.label}
          </span>
          {!isVenda && (
            <span
              className="rounded-full px-2 py-px text-[10.5px] font-semibold"
              style={{ background: deadlineBadge.bg, color: deadlineBadge.fg }}
            >
              {deadlineBadge.label}
            </span>
          )}
          {!isVenda && (
            <span
              className="rounded-full px-2 py-px text-[10.5px] font-semibold"
              style={{ background: noticeBadge.bg, color: noticeBadge.fg }}
            >
              {noticeBadge.label}
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {detail}
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {awaitingDecision && (
          canApprove ? (
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg bg-slate-950 px-3 text-[11.5px] text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-300"
              onClick={onReview}
            >
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              Revisar e decidir
            </Button>
          ) : (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              Sem permissão para decidir
            </span>
          )
        )}
        {canEditRecord && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={onEdit}
            aria-label="Editar período lançado"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
        {canDeleteRecord && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-lg border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
            onClick={onDelete}
            aria-label="Excluir período lançado"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
