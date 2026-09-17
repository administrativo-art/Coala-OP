"use client";

import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

import { useDP } from '@/components/dp-context';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuthenticatedApi } from '@/hooks/use-authenticated-api';
import { useToast } from '@/hooks/use-toast';
import type {
  DPVacationLegalCheck,
  DPVacationRecord,
} from '@/types';
import type { VacationCycle } from '@/lib/utils/vacation-logic';

const REJECTION_REASONS = [
  'Período fora do prazo concessivo',
  'Fracionamento sem acordo do colaborador',
  'Conflito de escala na unidade',
  'Dados do agendamento precisam de correção',
] as const;

const WEEKDAYS = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
] as const;

function fmtDate(value?: string | Date | null) {
  if (!value) return '—';
  try {
    return format(typeof value === 'string' ? parseISO(value) : value, 'dd/MM/yyyy');
  } catch {
    return String(value);
  }
}

function checkTone(status: DPVacationLegalCheck['status']) {
  if (status === 'ok') {
    return {
      box: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20',
      icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
      value: 'text-emerald-700 dark:text-emerald-300',
      glyph: CheckCircle2,
    };
  }
  if (status === 'blocked') {
    return {
      box: 'border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20',
      icon: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
      value: 'text-red-700 dark:text-red-300',
      glyph: XCircle,
    };
  }
  return {
    box: 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20',
    icon: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
    value: 'text-amber-800 dark:text-amber-300',
    glyph: AlertTriangle,
  };
}

function fallbackChecks(record: DPVacationRecord, cycle: VacationCycle): DPVacationLegalCheck[] {
  const hasRequiredFields = record.recordType === 'venda'
    ? Boolean(record.allowanceRequestedAt)
    : Boolean(record.startDate && record.endDate && record.calendarId);
  const withinConcessivePeriod = record.recordType === 'venda'
    || !record.endDate
    || parseISO(record.endDate) <= cycle.concessivePeriod.end;

  return [
    {
      code: 'date_range',
      label: 'Dados obrigatórios do lançamento',
      status: hasRequiredFields ? 'ok' : 'blocked',
      message: hasRequiredFields ? 'Preenchidos' : 'Existem dados obrigatórios pendentes',
      blocking: !hasRequiredFields,
    },
    {
      code: 'concessive_period',
      label: 'Período dentro do prazo concessivo',
      status: withinConcessivePeriod ? 'ok' : 'blocked',
      message: `Concessivo até ${fmtDate(cycle.concessivePeriod.end)}`,
      blocking: !withinConcessivePeriod,
    },
  ];
}

interface Props {
  employeeName: string;
  record: DPVacationRecord;
  cycle: VacationCycle;
  calendarName?: string;
  canApprove: boolean;
  onBack: () => void;
}

export function DPVacationDecisionPanel({
  employeeName,
  record,
  cycle,
  calendarName,
  canApprove,
  onBack,
}: Props) {
  const { updateVacation } = useDP();
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const [mode, setMode] = useState<'review' | 'reject'>('review');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [result, setResult] = useState<'approved' | 'rejected' | null>(null);

  const checks = record.workflow?.legalAnalysis.checks?.length
    ? record.workflow.legalAnalysis.checks
    : fallbackChecks(record, cycle);
  const hasBlockingIssue = checks.some(check => check.blocking && check.status === 'blocked');
  const canSubmitApproval = canApprove && !hasBlockingIssue && !busy;
  const canSubmitRejection = canApprove && reason.trim().length >= 10 && !busy;
  const recordType = record.recordType === 'gozo' ? 'Gozo' : 'Venda (abono)';
  const weeklyRest = WEEKDAYS[record.weeklyRestDay ?? 0] ?? '—';

  const fields = [
    ['Colaborador', employeeName],
    ['Ciclo', record.cycleId],
    ['Tipo', recordType],
    ['Dias', `${record.days} dias`],
    ['Início', fmtDate(record.startDate)],
    ['Fim', fmtDate(record.endDate)],
    ['Retorno', fmtDate(record.returnDate)],
    ['Calendário aplicável', calendarName ?? (record.calendarId ? 'Calendário cadastrado' : '—')],
    ['Descanso semanal', weeklyRest],
    ['Faltas injustificadas', String(record.unjustifiedAbsences ?? 0)],
  ] as const;

  async function approve() {
    if (!canSubmitApproval) return;
    setBusy('approve');
    try {
      await updateVacation({ ...record, status: 'APPROVED' });
      toast({
        title: 'Agendamento aprovado.',
        description: 'A geração do aviso de férias é a próxima ação da trilha.',
      });
      setResult('approved');
    } catch (error) {
      toast({
        title: 'Não foi possível aprovar o agendamento.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (!canSubmitRejection) return;
    setBusy('reject');
    try {
      await api(`/api/dp/vacations/${encodeURIComponent(record.id)}`, {
        method: 'PATCH',
        json: { action: 'reject', reason: reason.trim() },
        fallbackError: 'Não foi possível rejeitar o agendamento.',
      });
      toast({
        title: 'Agendamento rejeitado.',
        description: 'O motivo foi registrado na trilha de auditoria.',
      });
      setResult('rejected');
    } catch (error) {
      toast({
        title: 'Não foi possível rejeitar o agendamento.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-lg"
          onClick={onBack}
          aria-label="Voltar à ficha de férias"
          disabled={Boolean(busy)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Decisão do período · ciclo {record.cycleId}
          </p>
          <h3 className="mt-1 truncate text-[17px] font-bold tracking-tight">
            {recordType} · {record.days} dias
          </h3>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <section className="rounded-2xl border bg-muted/25 p-3.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {fields.map(([label, value]) => (
              <div key={label} className={label === 'Colaborador' || label === 'Calendário aplicável' ? 'col-span-2' : undefined}>
                <p className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground">{label}</p>
                <p className="mt-1 text-[12.5px] font-semibold text-foreground">{value}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Verificações de regra
            </p>
            <span className="text-[10.5px] font-medium text-muted-foreground">
              {checks.length} {checks.length === 1 ? 'verificação' : 'verificações'}
            </span>
          </div>
          <div className="mt-2.5 space-y-2">
            {checks.map(check => {
              const tone = checkTone(check.status);
              const Glyph = tone.glyph;
              return (
                <div key={check.code} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${tone.box}`}>
                  <span className={`mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full ${tone.icon}`}>
                    <Glyph className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-semibold text-foreground">{check.label}</p>
                    <p className={`mt-0.5 text-[10.5px] font-semibold ${tone.value}`}>{check.message}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {hasBlockingIssue && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/70 p-3 text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-[11.5px] font-semibold leading-relaxed">
              A aprovação está bloqueada até a correção das verificações impeditivas.
            </p>
          </div>
        )}

        {!canApprove && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-[11.5px] font-semibold leading-relaxed">
              Você pode consultar o período, mas precisa da permissão “Aprovar Férias” para decidir.
            </p>
          </div>
        )}

        {mode === 'reject' && (
          <section className="rounded-2xl border border-red-200 bg-red-50/60 p-3.5 dark:border-red-900/60 dark:bg-red-950/20">
            <h4 className="text-xs font-bold text-red-800 dark:text-red-300">Motivo da rejeição</h4>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              A justificativa será registrada na trilha de auditoria e devolverá o período ao RH.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {REJECTION_REASONS.map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setReason(item)}
                  className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-semibold transition-colors ${
                    reason === item
                      ? 'border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
                      : 'border-border bg-background text-muted-foreground hover:border-red-200 hover:text-foreground'
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            <Textarea
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="Descreva o motivo da rejeição (mínimo de 10 caracteres)"
              className="mt-3 min-h-24 bg-background"
              maxLength={2_000}
            />
            <p className="mt-1.5 text-right text-[10px] font-medium text-muted-foreground">
              {reason.trim().length}/2000
            </p>
          </section>
        )}
      </div>

      <div className="border-t bg-background px-5 py-3.5">
        {result ? (
          <div className={`flex flex-wrap items-center gap-2.5 rounded-xl border p-3 ${
            result === 'approved'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/25 dark:text-red-300'
          }`}>
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-current/10">
              {result === 'approved' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            </span>
            <span className="min-w-[220px] flex-1 text-xs font-extrabold">
              {result === 'approved'
                ? 'Aprovado por você · a trilha seguiu para Aviso e ciência'
                : 'Rejeitado por você · período devolvido ao RH'}
            </span>
            <Button type="button" variant="outline" size="sm" className="bg-background" onClick={onBack}>Fechar</Button>
          </div>
        ) : mode === 'review' ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-w-[190px] flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={!canSubmitApproval}
              onClick={() => void approve()}
            >
              {busy === 'approve' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Aprovar agendamento
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
              disabled={!canApprove || Boolean(busy)}
              onClick={() => setMode('reject')}
            >
              Rejeitar
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => setMode('review')}>
              Voltar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!canSubmitRejection}
              onClick={() => void reject()}
            >
              {busy === 'reject' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar rejeição
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
