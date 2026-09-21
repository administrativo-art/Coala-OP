"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { differenceInCalendarDays, format, startOfDay, subDays } from 'date-fns';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  FileCheck2,
  FileText,
  History,
  ExternalLink,
  Landmark,
  Loader2,
  LockKeyhole,
  Plus,
  ReceiptText,
  ShieldCheck,
  Upload,
  UserRoundCheck,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  VACATION_WORKFLOW_STAGE_META,
  vacationWorkflowForRecord,
} from '@/lib/dp-vacation-workflow';
import { useAuthenticatedApi } from '@/hooks/use-authenticated-api';
import type {
  DPVacationEvent,
  DPVacationRecord,
  DPVacationSignatureParticipant,
  DPVacationWorkflow,
  DPVacationWorkflowStageId,
  DPVacationWorkflowStep,
} from '@/types';
import type { VacationCycle } from '@/lib/utils/vacation-logic';

type Props = {
  records: DPVacationRecord[];
  registrationCycle?: VacationCycle;
  selectedId: string | null;
  canEdit: boolean;
  canApprove: boolean;
  onRegister: () => void;
  onSelect: (id: string) => void;
  onEdit: (record: DPVacationRecord) => void;
  onApprove: (record: DPVacationRecord) => void;
  onGenerateNotice: (record: DPVacationRecord) => void;
  onValidateNotice: (record: DPVacationRecord) => void;
  onOpenNotice: (record: DPVacationRecord) => void;
  onSendNotice: (record: DPVacationRecord, complianceOverrideReason?: string) => void;
  onSyncNotice: (record: DPVacationRecord) => void;
  noticeBusy: 'generate' | 'validate' | 'open' | 'send' | 'sync' | null;
  workflowBusy: string | null;
  onSendAccountant: (record: DPVacationRecord) => void;
  onReviewReceipt: (record: DPVacationRecord, review: {
    decision: 'approved' | 'correction_required';
    values?: { grossAmount: number; discountAmount: number; netAmount: number; paymentDate?: string | null };
    notes?: string;
    reason?: string;
    overrideReason?: string;
  }) => void;
  onPreparePayment: (record: DPVacationRecord) => void;
  onSyncPayment: (record: DPVacationRecord) => void;
  onRetryReceiptSignature: (record: DPVacationRecord) => void;
  onSyncReceiptSignature: (record: DPVacationRecord) => void;
  onFinalizeWorkflow: (record: DPVacationRecord) => void;
  onCancel: (record: DPVacationRecord) => void;
  onOpenWorkflowAsset: (record: DPVacationRecord, kind: 'receipt-original' | 'receipt-signed' | 'payment-proof') => void;
};

const TERMINAL_STEP_STATUSES = new Set(['completed', 'cancelled']);

function todayInBelem() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Belem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function formatMoney(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function paymentStatusLabel(status: DPVacationWorkflow['payment']['status']) {
  if (status === 'not_started') return 'Ainda não preparado';
  if (status === 'preparing') return 'Preparando';
  if (status === 'awaiting_financial_authorization') return 'Aguardando autorização do Financeiro';
  if (status === 'ready_to_submit') return 'Autorizado; aguardando envio ao banco';
  if (status === 'awaiting_bank_approval') return 'Aguardando aprovação no banco';
  if (status === 'scheduled') return 'Agendado';
  if (status === 'processing') return 'Processando';
  if (status === 'paid') return 'Pago';
  return 'Ajuste necessário';
}

function emailStatusLabel(status?: DPVacationWorkflow['accountant']['emailStatus'] | null) {
  if (status === 'delivered') return 'e-mail entregue';
  if (status === 'accepted') return 'envio aceito';
  if (status === 'delayed') return 'entrega atrasada';
  if (['bounced', 'failed', 'complained', 'suppressed'].includes(status ?? '')) return 'falha na entrega';
  return status === 'pending' ? 'envio pendente' : 'acompanhamento pendente';
}

function participantInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function participantStatusLabel(status: NonNullable<DPVacationWorkflow['notice']['participants']>[number]['status']) {
  if (status === 'signed') return 'Assinado';
  if (status === 'viewed') return 'Documento aberto';
  if (status === 'delivery_failed') return 'Falha na entrega';
  if (status === 'rejected') return 'Recusado';
  return 'Convite enviado';
}

function signatureEventDate(value?: string | null, completed = false) {
  if (!value) return completed ? 'Concluído' : 'Pendente';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return completed ? 'Concluído' : 'Pendente';
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Belem',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SignatureParticipantCard({
  participant,
  tone,
}: {
  participant: DPVacationSignatureParticipant;
  tone: 'violet' | 'sky';
}) {
  const failed = participant.status === 'delivery_failed' || participant.status === 'rejected';
  const signed = participant.status === 'signed' || Boolean(participant.signedAt);
  const viewed = signed || participant.status === 'viewed' || Boolean(participant.viewedAt);
  const delivered = viewed || Boolean(participant.emailDeliveredAt);
  const invited = true;
  const accent = tone === 'violet'
    ? 'text-violet-700 bg-violet-50 border-violet-100'
    : 'text-sky-700 bg-sky-50 border-sky-100';
  const statusClasses = failed
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : signed
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : viewed
        ? 'border-sky-200 bg-sky-50 text-sky-700'
        : 'border-amber-200 bg-amber-50 text-amber-700';
  const summary = failed
    ? participant.status === 'rejected' ? 'Documento recusado pelo colaborador.' : 'Não foi possível entregar o convite.'
    : signed
      ? 'Assinatura concluída. O documento está pronto para a próxima etapa.'
      : viewed
        ? 'Documento aberto. Aguardando a assinatura do colaborador.'
        : delivered
          ? 'Convite entregue. Aguardando o colaborador abrir o documento.'
          : 'Convite enviado. Aguardando confirmação de entrega.';
  const milestones = [
    {
      label: 'Convite enviado',
      detail: signatureEventDate(participant.invitedAt ?? participant.emailSentAt, invited),
      done: invited,
      icon: UserRoundCheck,
    },
    {
      label: 'E-mail entregue',
      detail: signatureEventDate(participant.emailDeliveredAt, delivered),
      done: delivered,
      icon: CheckCircle2,
    },
    {
      label: 'Documento aberto',
      detail: signatureEventDate(participant.viewedAt, viewed),
      done: viewed,
      icon: FileText,
    },
    {
      label: 'Assinatura concluída',
      detail: signatureEventDate(participant.signedAt, signed),
      done: signed,
      icon: ShieldCheck,
    },
  ];

  return (
    <div className={`overflow-hidden rounded-2xl border bg-white ${failed ? 'border-rose-200' : signed ? 'border-emerald-200' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
        <Avatar className="h-10 w-10 shrink-0 ring-2 ring-white shadow-sm">
          <AvatarImage src={participant.avatarUrl ?? undefined} />
          <AvatarFallback>{participantInitials(participant.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className={`text-[9px] font-black uppercase tracking-[0.1em] ${tone === 'violet' ? 'text-violet-700' : 'text-sky-700'}`}>
            {participant.party === 'employee' ? 'Colaborador(a)' : 'Empregadora'}
          </p>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2">
            <p className="truncate text-[12.5px] font-black text-slate-950">{participant.name}</p>
            <p className="truncate text-[10.5px] font-semibold text-slate-500">{participant.email}</p>
          </div>
        </div>
        <Badge variant="outline" className={`rounded-full px-2.5 py-1 text-[9.5px] font-black ${statusClasses}`}>
          {participantStatusLabel(participant.status)}
        </Badge>
      </div>

      <div className={`border-y px-4 py-2 text-[10.5px] font-bold ${accent}`}>
        {summary}
      </div>

      <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
        {milestones.map((milestone) => {
          const Icon = milestone.icon;
          return (
            <div
              key={milestone.label}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${
                milestone.done
                  ? 'border-emerald-100 bg-emerald-50/65'
                  : failed
                    ? 'border-rose-100 bg-rose-50/60'
                    : 'border-slate-200 bg-slate-50'
              }`}
            >
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                milestone.done ? 'bg-emerald-600 text-white' : failed ? 'bg-rose-100 text-rose-600' : 'bg-white text-slate-400 ring-1 ring-slate-200'
              }`}>
                {milestone.done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[10.5px] font-black text-slate-900">{milestone.label}</span>
                <span className={`mt-0.5 block text-[9.5px] font-semibold ${milestone.done ? 'text-emerald-700' : failed ? 'text-rose-700' : 'text-slate-500'}`}>
                  {milestone.detail}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      {participant.deliveryFailureReason ? (
        <div className="border-t border-rose-100 bg-rose-50 px-4 py-2.5 text-[10.5px] font-bold text-rose-700">
          Motivo da falha: {participant.deliveryFailureReason}
        </div>
      ) : null}
    </div>
  );
}

function stepStateLabel(step: DPVacationWorkflowStep) {
  if (step.status === 'completed') return 'Concluída';
  if (step.status === 'in_progress') return 'Etapa atual';
  if (step.status === 'waiting_external') return 'Aguardando terceiro';
  if (step.status === 'blocked') return 'Bloqueada';
  if (step.status === 'cancelled') return 'Cancelada';
  return 'A seguir';
}

function stepClasses(step: DPVacationWorkflowStep) {
  if (step.status === 'completed') return 'border-b-emerald-500 bg-emerald-50 text-emerald-800';
  if (step.status === 'in_progress' || step.status === 'waiting_external') {
    return 'border-b-[#df2f78] bg-pink-50 text-pink-800';
  }
  if (step.status === 'blocked') return 'border-b-amber-400 bg-amber-50 text-amber-800';
  return 'border-b-stone-200 bg-[#faf9f6] text-stone-500';
}

function nextAction(workflow: DPVacationWorkflow) {
  if (workflow.status === 'cancelled') return {
    owner: 'RH',
    title: 'Trilha cancelada',
    description: 'O registro foi encerrado formalmente; consulte o motivo no histórico auditável.',
  };
  if (workflow.status === 'completed') return {
    owner: 'RH',
    title: 'Trilha concluída',
    description: 'Aviso, recibo, pagamento e assinaturas foram conferidos e encerrados.',
  };
  const step = workflow.steps.find((candidate) => candidate.id === workflow.currentStage)
    ?? workflow.steps.find((candidate) => !TERMINAL_STEP_STATUSES.has(candidate.status));
  if (!step) return { owner: 'RH', title: 'Trilha concluída', description: 'Todos os marcos foram concluídos.' };
  if (step.id === 'scheduling') return {
    owner: 'RH',
    title: 'Revisar e aprovar o agendamento',
    description: 'Confira a análise inicial e aprove o período para liberar a geração do aviso.',
  };
  if (step.id === 'notice' && workflow.notice.status === 'not_generated') return {
    owner: 'RH',
    title: 'Gerar e validar o aviso de férias',
    description: 'O aviso precisa ser conferido pelo RH antes de ser enviado ao colaborador.',
  };
  if (step.id === 'notice' && workflow.notice.status === 'generating') return {
    owner: 'Sistema',
    title: 'Gerando o aviso de férias',
    description: 'O PDF está sendo montado e preservado para a conferência do RH.',
  };
  if (step.id === 'notice' && workflow.notice.status === 'failed') return {
    owner: 'RH',
    title: 'Tentar gerar o aviso novamente',
    description: 'A tentativa anterior não terminou. Revise o cadastro da colaboradora e gere novamente.',
  };
  if (step.id === 'notice' && workflow.notice.status === 'draft') return {
    owner: 'RH',
    title: 'Abrir e validar o aviso de férias',
    description: 'Confira o arquivo exato que será enviado. O envio permanece bloqueado até a validação.',
  };
  if (step.id === 'notice' && workflow.notice.status === 'validated') return {
    owner: 'RH',
    title: 'Enviar o aviso validado',
    description: 'O documento está validado e pronto para a etapa de assinatura do colaborador.',
  };
  if (step.id === 'notice') return {
    owner: 'Colaborador',
    title: 'Aguardando ciência do aviso',
    description: 'Depois da assinatura, o aviso será encaminhado automaticamente ao contador.',
  };
  if (step.id === 'accountant') return {
    owner: ['ready_to_send', 'correction_requested', 'failed'].includes(workflow.accountant.status)
      ? 'RH'
      : workflow.accountant.status === 'sending'
        ? 'Sistema'
        : 'Contador',
    title: workflow.accountant.status === 'failed'
      ? 'Reenviar a solicitação à contabilidade'
      : workflow.accountant.status === 'correction_requested'
        ? 'Enviar a solicitação de correção ao contador'
        : workflow.accountant.status === 'ready_to_send'
          ? 'Enviar a solicitação à contabilidade'
          : workflow.accountant.status === 'sending'
            ? 'Enviando a solicitação à contabilidade'
            : 'Aguardando o recibo original',
    description: workflow.accountant.status === 'failed'
      ? 'O envio anterior não terminou. Confira o contato e tente novamente.'
      : ['ready_to_send', 'correction_requested'].includes(workflow.accountant.status)
        ? 'O contador receberá o aviso assinado e o link exclusivo para devolver o recibo original.'
        : workflow.accountant.status === 'sending'
          ? 'A solicitação está sendo preparada e enviada ao contato da contabilidade.'
          : 'O contador deve anexar o recibo pelo link exclusivo enviado por e-mail.',
  };
  if (step.id === 'receipt_review') return {
    owner: workflow.receipt.status === 'processing' ? 'Sistema' : 'RH',
    title: workflow.receipt.status === 'processing' ? 'Processar o recibo original' : 'Auditar o recibo recebido',
    description: workflow.receipt.status === 'processing'
      ? 'O arquivo já foi preservado e está sendo preparado para a auditoria.'
      : 'Compare o PDF original com os dados extraídos antes da aprovação.',
  };
  if (step.id === 'payment') return {
    owner: ['not_started', 'failed'].includes(workflow.payment.status)
      ? 'RH'
      : workflow.payment.status === 'preparing'
        ? 'Sistema'
        : 'Financeiro',
    title: workflow.payment.status === 'not_started'
      ? 'Preparar o pagamento'
      : workflow.payment.status === 'preparing'
        ? 'Preparando o pagamento'
        : workflow.payment.status === 'failed'
          ? 'Corrigir a preparação do pagamento'
          : 'Aguardando autorização e confirmação do Financeiro',
    description: workflow.payment.status === 'failed'
      ? 'Confira o vínculo, CPF e chave Pix da colaboradora antes de tentar novamente.'
      : workflow.payment.status === 'not_started'
        ? 'O recibo aprovado será enviado ao Financeiro para autorização e processamento.'
        : workflow.payment.status === 'preparing'
          ? 'A solicitação financeira está sendo criada e vinculada à trilha.'
      : 'O recibo somente será liberado para assinatura depois da confirmação bancária.',
  };
  if (step.id === 'receipt_signature') return {
    owner: ['ready', 'failed'].includes(workflow.receiptSignature.status)
      ? 'RH'
      : workflow.receiptSignature.status === 'sending'
        ? 'Sistema'
        : 'Colaborador',
    title: workflow.receiptSignature.status === 'ready'
      ? 'Enviar o recibo para assinatura'
      : workflow.receiptSignature.status === 'sending'
        ? 'Enviando o recibo para assinatura'
        : workflow.receiptSignature.status === 'failed'
          ? 'Reenviar o recibo para assinatura'
          : workflow.receiptSignature.status === 'blocked_until_payment'
            ? 'Aguardando confirmação do pagamento'
            : 'Aguardando assinatura do recibo',
    description: workflow.receiptSignature.status === 'failed'
      ? 'A tentativa anterior não terminou. O RH pode reenviar somente esta assinatura.'
      : workflow.receiptSignature.status === 'ready'
        ? 'O pagamento foi confirmado e o recibo pode ser enviado ao colaborador.'
        : workflow.receiptSignature.status === 'sending'
          ? 'O convite de assinatura está sendo preparado para o colaborador.'
      : 'A trilha permanece ativa até a assinatura do recibo após o pagamento.',
  };
  return {
    owner: 'RH',
    title: 'Conferir e finalizar a trilha',
    description: 'Valide o conjunto documental antes do encerramento definitivo.',
  };
}

function Substep({
  done,
  active,
  label,
  detail,
}: {
  done: boolean;
  active?: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div className={`flex gap-2.5 rounded-xl border px-3 py-2.5 ${
      done
        ? 'border-emerald-200 bg-emerald-50'
        : active
          ? 'border-pink-200 bg-pink-50'
          : 'border-slate-200 bg-slate-50'
    }`}>
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
        done ? 'bg-emerald-600 text-white' : active ? 'bg-pink-600 text-white' : 'bg-white text-slate-400 ring-1 ring-slate-200'
      }`}>
        {done ? <Check className="h-3 w-3" /> : active ? <Clock3 className="h-3 w-3" /> : <Circle className="h-2.5 w-2.5" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[11.5px] font-black text-slate-900">{label}</span>
        <span className="mt-0.5 block text-[10.5px] font-semibold text-slate-500">{detail}</span>
      </span>
    </div>
  );
}

const STAGE_OWNER_LABEL: Record<(typeof VACATION_WORKFLOW_STAGE_META)[number]['owner'], string> = {
  hr: 'RH',
  employee: 'Colaborador',
  accountant: 'Contador',
  finance: 'Financeiro',
  system: 'Sistema',
};

function EmptyWorkflow({
  canEdit,
  onRegister,
  cycle,
}: {
  canEdit: boolean;
  onRegister: () => void;
  cycle?: VacationCycle;
}) {
  const balance = Math.max(0, cycle?.balance ?? 0);
  const noticeDeadline = cycle
    ? subDays(cycle.concessivePeriod.end, Math.max(1, balance) + 29)
    : null;
  const noticeDaysLeft = noticeDeadline
    ? differenceInCalendarDays(noticeDeadline, startOfDay(new Date()))
    : null;

  if (!cycle || balance <= 0) {
    return (
      <section className="rounded-[18px] border border-[#e9edf4] bg-card p-[18px]">
        <Badge variant="outline" className="rounded-full bg-slate-50 text-[10px] font-black uppercase tracking-[0.1em] text-slate-700">
          Ficha informativa
        </Badge>
        <h2 className="mt-2 text-lg font-black tracking-tight">Nenhum ciclo disponível para registro</h2>
        <p className="mt-1 max-w-2xl text-[12.5px] font-semibold leading-relaxed text-muted-foreground">
          Consulte abaixo o período aquisitivo, os ciclos anteriores e o histórico. O registro será liberado quando houver saldo em período concessivo.
        </p>
      </section>
    );
  }

  const steps = [
    {
      title: 'Registrar o período',
      description: 'Datas, calendário aplicável, descanso semanal e faltas. O sistema calcula o retorno e confere prazo e antecedência do aviso.',
      meta: 'Você está aqui',
    },
    {
      title: 'Aprovar o agendamento',
      description: 'O período entra como Pendente. Em “Revisar e decidir” o RH aprova ou rejeita com motivo registrado.',
      meta: 'Requer permissão Aprovar Férias',
    },
    {
      title: 'Seguir a trilha',
      description: 'Aviso e ciência, contabilidade, auditoria do recibo, pagamento, assinatura e finalização.',
      meta: '7 etapas · RH, colaborador, contador e financeiro',
    },
  ];

  return (
    <section className="rounded-[18px] border border-[#e9edf4] bg-card p-[18px]">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-[260px] flex-1">
          <Badge className="rounded-full bg-pink-100 text-[10px] font-black uppercase tracking-[0.1em] text-pink-800 hover:bg-pink-100">
            Passo 1 de 3 · registro
          </Badge>
          <h2 className="mt-2 text-lg font-black tracking-tight">
            Lançar o período de férias{cycle ? ` do ciclo ${cycle.id}` : ''}
          </h2>
          <p className="mt-1 max-w-2xl text-[12.5px] font-semibold leading-relaxed text-muted-foreground">
            A trilha só existe depois do lançamento: é o registro do gozo (e da venda, se houver) que cria a etapa de agendamento e abre a aprovação.
          </p>
          {cycle ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline" className="h-7 rounded-[9px] border-slate-200 bg-slate-50 px-2.5 text-[11px] font-extrabold text-slate-700">
                Saldo do ciclo: {balance}d a agendar
              </Badge>
              <Badge variant="outline" className="h-7 rounded-[9px] border-slate-200 bg-slate-50 px-2.5 text-[11px] font-extrabold text-slate-700">
                Concessivo até {format(cycle.concessivePeriod.end, 'dd/MM/yyyy')}
              </Badge>
              {noticeDeadline ? (
                <Badge
                  variant="outline"
                  className={`h-7 rounded-[9px] px-2.5 text-[11px] font-extrabold ${
                    (noticeDaysLeft ?? 0) <= 30
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : (noticeDaysLeft ?? 0) <= 90
                        ? 'border-amber-300 bg-amber-50 text-amber-800'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  }`}
                >
                  Avisar até {format(noticeDeadline, 'dd/MM/yyyy')} · {noticeDaysLeft} dias
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
        {canEdit ? (
          <Button type="button" className="h-11 rounded-xl bg-[#db2777] px-5 shadow-[0_12px_24px_-16px_rgba(219,39,119,.9)] hover:bg-[#be185d]" onClick={onRegister}>
            <Plus className="mr-2 h-4 w-4" />
            Registrar férias
          </Button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2.5 md:grid-cols-3">
        {steps.map((step, index) => (
          <div key={step.title} className={`rounded-[14px] border p-3.5 ${index === 0 ? 'border-pink-200 bg-pink-50/60' : 'bg-muted/20'}`}>
            <div className="flex items-center gap-2">
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-black ${index === 0 ? 'bg-pink-600 text-white' : 'bg-muted text-muted-foreground'}`}>{index + 1}</span>
              <p className="text-[12.5px] font-black">{step.title}</p>
            </div>
            <p className="mt-2 text-[11.5px] font-semibold leading-relaxed text-muted-foreground">{step.description}</p>
            <p className={`mt-2 text-[10.5px] font-extrabold ${index === 0 ? 'text-pink-800' : 'text-muted-foreground'}`}>{step.meta}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t pt-3.5">
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">As 7 etapas que vêm depois da aprovação</p>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-7">
          {VACATION_WORKFLOW_STAGE_META.map((stage, index) => (
            <div key={stage.id} className="rounded-xl border border-[#eef1f6] bg-[#fcfcfd] p-2.5">
              <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-muted text-[9.5px] font-black text-muted-foreground">{index + 1}</span>
              <p className="mt-1.5 truncate text-[11px] font-extrabold text-muted-foreground">{stage.label}</p>
              <p className="mt-1 truncate text-[9.5px] font-semibold text-muted-foreground/75">{STAGE_OWNER_LABEL[stage.owner]}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function DPVacationAuditTimeline({
  vacationId,
  version,
  embedded = false,
}: {
  vacationId: string;
  version: string;
  embedded?: boolean;
}) {
  const api = useAuthenticatedApi();
  const [events, setEvents] = useState<DPVacationEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextCursor?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const search = new URLSearchParams({ limit: '20' });
      if (nextCursor) search.set('cursor', nextCursor);
      const payload = await api<{ events: DPVacationEvent[]; nextCursor: string | null }>(
        `/api/dp/vacations/${encodeURIComponent(vacationId)}/events?${search}`,
        { fallbackError: 'Não foi possível carregar o histórico das férias.' },
      );
      setEvents((current) => nextCursor ? [...current, ...payload.events] : payload.events);
      setCursor(payload.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o histórico.');
    } finally {
      setLoading(false);
    }
  }, [api, vacationId]);

  useEffect(() => {
    setEvents([]);
    setCursor(null);
    void load(null);
  }, [load, version]);

  return (
    <div className={embedded ? 'overflow-hidden bg-white' : 'overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-600" />
            <p className="text-[13px] font-black">Histórico auditável</p>
          </div>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">Ações humanas e automáticas, em ordem cronológica.</p>
        </div>
        <Badge variant="outline" className="rounded-full text-[9px] font-black">{events.length} evento(s)</Badge>
      </div>
      {error ? <p className="px-4 py-3 text-[10.5px] font-semibold text-rose-700">{error}</p> : null}
      <div className="divide-y divide-slate-100 px-4">
        {events.map((event) => (
          <div key={event.id} className="grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:gap-4">
            <div>
              <p className="text-[11px] font-black text-slate-900">{event.message}</p>
              <p className="mt-0.5 text-[9.5px] font-semibold text-slate-500">
                {event.actorName}{typeof event.data?.reason === 'string' ? ` · Motivo: ${event.data.reason}` : ''}
              </p>
            </div>
            <time className="font-mono text-[9.5px] font-semibold text-slate-500">
              {new Date(event.at).toLocaleString('pt-BR', { timeZone: 'America/Belem' })}
            </time>
          </div>
        ))}
        {!loading && events.length === 0 && !error ? (
          <p className="py-4 text-center text-[10.5px] font-semibold text-slate-500">Nenhum evento registrado.</p>
        ) : null}
      </div>
      {loading || cursor ? (
        <div className="border-t border-slate-100 px-4 py-3">
          <Button variant="outline" size="sm" className="rounded-xl" disabled={loading || !cursor} onClick={() => void load(cursor)}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
            {loading ? 'Carregando histórico' : 'Carregar eventos anteriores'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function DPVacationWorkflowPanel({
  records,
  registrationCycle,
  selectedId,
  canEdit,
  canApprove,
  onRegister,
  onSelect,
  onEdit,
  onApprove,
  onGenerateNotice,
  onValidateNotice,
  onOpenNotice,
  onSendNotice,
  onSyncNotice,
  noticeBusy,
  workflowBusy,
  onSendAccountant,
  onReviewReceipt,
  onPreparePayment,
  onSyncPayment,
  onRetryReceiptSignature,
  onSyncReceiptSignature,
  onFinalizeWorkflow,
  onCancel,
  onOpenWorkflowAsset,
}: Props) {
  const record = records.find((candidate) => candidate.id === selectedId) ?? records[0] ?? null;
  const asOfDate = todayInBelem();
  const now = `${asOfDate}T12:00:00.000-03:00`;
  const workflow = useMemo(
    () => record ? vacationWorkflowForRecord(record, now, asOfDate) : null,
    [asOfDate, now, record],
  );

  const analysis = workflow?.receipt.analysis?.extractedFields;
  const [receiptValues, setReceiptValues] = useState({
    grossAmount: '',
    discountAmount: '',
    netAmount: '',
    paymentDate: '',
  });
  const [receiptNotes, setReceiptNotes] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [receiptOverrideReason, setReceiptOverrideReason] = useState('');
  const [noticeExceptionReason, setNoticeExceptionReason] = useState('');
  const [stageSelection, setStageSelection] = useState<{
    recordId: string;
    stage: DPVacationWorkflowStageId;
  } | null>(null);

  useEffect(() => {
    const reviewed = workflow?.receipt.reviewedValues;
    const extracted = workflow?.receipt.analysis?.extractedFields;
    setReceiptValues({
      grossAmount: String(reviewed?.grossAmount ?? extracted?.amountGross ?? ''),
      discountAmount: String(reviewed?.discountAmount ?? extracted?.amountDiscounts ?? ''),
      netAmount: String(reviewed?.netAmount ?? extracted?.amountNet ?? ''),
      paymentDate: reviewed?.paymentDate ?? extracted?.paymentDate ?? '',
    });
    setReceiptNotes(workflow?.receipt.reviewNotes ?? '');
    setCorrectionReason(workflow?.receipt.correctionReason ?? '');
    setReceiptOverrideReason('');
    setNoticeExceptionReason(workflow?.legalAnalysis.noticeExceptionReason ?? '');
  }, [
    record?.id,
    workflow?.receipt.originalDocumentId,
    workflow?.receipt.status,
    workflow?.receipt.reviewedValues,
    workflow?.receipt.reviewNotes,
    workflow?.receipt.correctionReason,
    workflow?.receipt.analysis?.extractedFields,
  ]);

  if (!record || !workflow) {
    return <EmptyWorkflow canEdit={canEdit} onRegister={onRegister} cycle={registrationCycle} />;
  }

  const action = nextAction(workflow);
  const selectedStage = stageSelection?.recordId === record.id
    ? stageSelection.stage
    : workflow.currentStage;
  const selectedStageMeta = VACATION_WORKFLOW_STAGE_META.find(meta => meta.id === selectedStage)!;
  const selectedStep = workflow.steps.find(step => step.id === selectedStage)!;
  const viewingCurrentStage = selectedStage === workflow.currentStage;
  const notice = workflow.notice;
  const noticeGenerated = ['draft', 'validated', 'sent', 'signed'].includes(notice.status);
  const noticeValidated = ['validated', 'sent', 'signed'].includes(notice.status);
  const noticeSigned = notice.status === 'signed';
  const accountantRequested = ['sent', 'receipt_received', 'completed'].includes(workflow.accountant.status);
  const receiptReceived = ['processing', 'review_pending', 'approved'].includes(workflow.receipt.status);
  const receiptApproved = workflow.receipt.status === 'approved';
  const paymentPaid = workflow.payment.status === 'paid';
  const receiptSigned = workflow.receiptSignature.status === 'signed';
  const receiptValuesValid = [receiptValues.grossAmount, receiptValues.discountAmount, receiptValues.netAmount]
    .every((value) => value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0)
    && Number(receiptValues.netAmount) > 0
    && Math.abs(
      Number(receiptValues.grossAmount)
      - Number(receiptValues.discountAmount)
      - Number(receiptValues.netAmount),
    ) <= 0.01;
  const receiptNeedsOverride = Boolean(
    workflow.receipt.analysis?.issues.length
    || workflow.receipt.analysis?.documentTypeCode !== 'VACATION_RECEIPT'
    || workflow.receipt.analysis?.employeeMatchStatus !== 'MATCH'
    || !analysis?.employeeName
    || !analysis?.cnpj
    || !analysis?.acquisitionPeriodStart
    || !analysis?.acquisitionPeriodEnd
    || !analysis?.vacationStartDate
    || analysis.vacationStartDate !== record.startDate
    || !analysis?.vacationEndDate
    || analysis.vacationEndDate !== record.endDate
    || analysis?.numberOfDays == null
    || Number(analysis.numberOfDays) !== Number(record.days)
    || analysis?.amountGross == null
    || analysis?.amountDiscounts == null
    || analysis?.amountNet == null
    || analysis?.signatureDetected === false,
  );

  return (
    <section className="space-y-4 text-slate-950">
      <div className="rounded-[18px] border border-[#e2ded6] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.09em] text-[#df2f78]">Trilha de férias</p>
            <h2 className="mt-1 text-base font-black tracking-[-0.01em]">
              Ciclo {record.cycleId} · {record.days} dias
            </h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {formatDate(record.startDate)} → {formatDate(record.endDate)} · retorno em {formatDate(record.returnDate)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {records.length > 1 ? (
              <Select value={record.id} onValueChange={onSelect}>
                <SelectTrigger className="h-9 w-[220px] rounded-xl text-xs font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {records.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {formatDate(candidate.startDate)} · {candidate.days} dias
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {canEdit && ['not_generated', 'failed'].includes(workflow.notice.status) ? (
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => onEdit(record)}>
                Editar período
              </Button>
            ) : null}
            {canApprove && workflow.status === 'active' && record.status === 'APPROVED' && !workflow.payment.paymentRequestId ? (
              <Button variant="outline" size="sm" className="rounded-xl border-rose-200 text-rose-700" onClick={() => onCancel(record)}>
                Cancelar formalmente
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
          {VACATION_WORKFLOW_STAGE_META.map((meta, index) => {
            const step = workflow.steps.find((candidate) => candidate.id === meta.id)!;
            const selected = selectedStage === meta.id;
            return (
              <button
                key={meta.id}
                type="button"
                aria-pressed={selected}
                aria-label={`Ver etapa ${index + 1}: ${meta.label}`}
                onClick={() => setStageSelection({ recordId: record.id, stage: meta.id })}
                className={`min-w-[124px] flex-1 rounded-[13px] border-b-[3px] px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#df2f78]/50 ${stepClasses(step)} ${selected ? 'ring-2 ring-[#df2f78]/35 shadow-sm' : 'opacity-80 hover:opacity-100'}`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[9px] font-bold opacity-70">0{index + 1}</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${step.status === 'completed' ? 'bg-emerald-500' : step.status === 'in_progress' || step.status === 'waiting_external' ? 'bg-[#df2f78]' : 'bg-stone-300'}`} />
                </span>
                <span className="mt-1 block text-[12px] font-black leading-snug">{meta.short}</span>
                <span className="mt-0.5 block text-[9.5px] font-bold opacity-70">{stepStateLabel(step)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {viewingCurrentStage ? (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-[9.5px] font-black uppercase tracking-[0.08em] text-amber-700">O que falta para avançar</p>
            <p className="mt-1 text-[13px] font-black text-amber-900">{action.title}</p>
            <p className="mt-1 text-[11.5px] font-semibold text-amber-700">{action.description}</p>
          </div>
          <Badge variant="outline" className="rounded-full border-amber-200 bg-white text-[10px] font-black text-amber-800">
            Responsável: {action.owner}
          </Badge>
          {workflow.currentStage === 'scheduling' && canApprove && record.status !== 'APPROVED' ? (
            <Button size="sm" className="rounded-xl bg-[#df2f78] hover:bg-[#c82569]" onClick={() => onApprove(record)}>
              Aprovar agendamento
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          {selectedStep.status === 'completed' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <LockKeyhole className="h-4 w-4 shrink-0 text-slate-500" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">Visualizando {selectedStageMeta.label}</p>
            <p className="mt-0.5 text-[11.5px] font-semibold text-slate-600">
              {selectedStep.status === 'completed'
                ? 'Etapa concluída. Os dados permanecem disponíveis para consulta.'
                : 'Etapa futura em modo de consulta; as ações serão liberadas quando o processo chegar aqui.'}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => setStageSelection({ recordId: record.id, stage: workflow.currentStage })}
          >
            Voltar à etapa atual
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {selectedStage === 'scheduling' ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#df2f78]" />
              <p className="text-[13px] font-black">Análise inicial do agendamento</p>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">
              Impedimentos legais bloqueiam a aprovação. Exceção de antecedência exige justificativa formal no envio.
            </p>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-2">
            {workflow.legalAnalysis.checks.map((check) => (
              <div key={check.code} className={`rounded-xl border px-3 py-2.5 ${
                check.status === 'ok'
                  ? 'border-emerald-200 bg-emerald-50'
                  : check.status === 'blocked'
                    ? 'border-rose-200 bg-rose-50'
                    : check.status === 'warning'
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-slate-200 bg-slate-50'
              }`}>
                <p className="text-[11px] font-black text-slate-900">{check.label}</p>
                <p className="mt-1 text-[10.5px] font-semibold text-slate-600">{check.message}</p>
              </div>
            ))}
          </div>
        </div>
        ) : null}

        {selectedStage === 'notice' ? (
        <div className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
          <div className="border-b border-violet-100 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-violet-600" />
              <p className="text-[13px] font-black">Aviso de férias</p>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">
              O documento só poderá ser enviado depois de gerado e validado pelo RH.
            </p>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-3">
            <Substep done={noticeGenerated} active={!noticeGenerated && workflow.currentStage === 'notice'} label="Gerar aviso" detail={noticeGenerated ? 'Documento gerado' : 'Aguardando geração'} />
            <Substep done={noticeValidated} active={noticeGenerated && !noticeValidated} label="Validar aviso" detail={noticeValidated ? 'Conteúdo aprovado' : 'Conferência obrigatória'} />
            <Substep done={noticeSigned} active={noticeValidated && !noticeSigned} label="Enviar e assinar" detail={noticeSigned ? 'Ciência registrada' : 'Somente após validação'} />
          </div>
          {workflow.currentStage === 'notice' || noticeGenerated ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-violet-100 px-4 py-3">
              {canApprove && ['not_generated', 'failed', 'draft'].includes(notice.status) ? (
                <Button
                  size="sm"
                  className="rounded-xl bg-violet-600 hover:bg-violet-700"
                  disabled={noticeBusy !== null}
                  onClick={() => onGenerateNotice(record)}
                >
                  {noticeBusy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  {['failed', 'draft'].includes(notice.status) ? 'Gerar novamente' : 'Gerar aviso'}
                </Button>
              ) : null}
              {noticeGenerated ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  disabled={noticeBusy !== null}
                  onClick={() => onOpenNotice(record)}
                >
                  {noticeBusy === 'open' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Abrir aviso
                </Button>
              ) : null}
              {canApprove && notice.status === 'draft' ? (
                <Button
                  size="sm"
                  className="rounded-xl bg-[#df2f78] hover:bg-[#c82569]"
                  disabled={noticeBusy !== null}
                  onClick={() => onValidateNotice(record)}
                >
                  {noticeBusy === 'validate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Validar aviso
                </Button>
              ) : null}
              {canApprove && notice.status === 'validated' ? (
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  {(workflow.legalAnalysis.noticeLeadDays ?? -1) < 30 ? (
                    <Input
                      className="min-w-[260px] flex-1"
                      placeholder="Justificativa obrigatória para envio fora dos 30 dias"
                      value={noticeExceptionReason}
                      onChange={(event) => setNoticeExceptionReason(event.target.value)}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    className="rounded-xl bg-[#df2f78] hover:bg-[#c82569]"
                    disabled={noticeBusy !== null || ((workflow.legalAnalysis.noticeLeadDays ?? -1) < 30 && noticeExceptionReason.trim().length < 10)}
                    onClick={() => onSendNotice(record, noticeExceptionReason.trim() || undefined)}
                  >
                    {noticeBusy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />}
                    Enviar para assinatura
                  </Button>
                </div>
              ) : null}
              {['sent', 'signed'].includes(notice.status) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  disabled={noticeBusy !== null || notice.status === 'signed'}
                  onClick={() => onSyncNotice(record)}
                >
                  {noticeBusy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
                  {notice.status === 'signed' ? 'Assinaturas concluídas' : 'Atualizar acompanhamento'}
                </Button>
              ) : null}
              {notice.status === 'generating' ? (
                <span className="inline-flex items-center gap-2 text-[10.5px] font-bold text-violet-700">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Geração em andamento
                </span>
              ) : null}
              {notice.status === 'failed' ? (
                <span className="text-[10.5px] font-bold text-rose-700">
                  A geração falhou. Nenhum documento foi liberado para envio.
                </span>
              ) : null}
              {notice.status === 'sending' ? (
                <span className="inline-flex items-center gap-2 text-[10.5px] font-bold text-violet-700">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Enviando ao Autentique
                </span>
              ) : null}
              {notice.sendErrorCode ? (
                <span className="text-[10.5px] font-bold text-rose-700">
                  O envio anterior falhou. O aviso continua validado e pode ser reenviado.
                </span>
              ) : null}
            </div>
          ) : null}
          {notice.participants?.length ? (
            <div className="space-y-3 border-t border-violet-100 bg-violet-50/40 p-4">
              {notice.participants.map((participant) => (
                <SignatureParticipantCard
                  key={participant.providerSignatureId}
                  participant={participant}
                  tone="violet"
                />
              ))}
            </div>
          ) : null}
        </div>
        ) : null}

        {selectedStage === 'accountant' || selectedStage === 'receipt_review' ? (
        <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
          <div className="border-b border-emerald-100 px-4 py-3.5">
            <div className="flex items-center gap-2">
              {selectedStage === 'accountant' ? <Upload className="h-4 w-4 text-emerald-600" /> : <FileCheck2 className="h-4 w-4 text-emerald-600" />}
              <p className="text-[13px] font-black">
                {selectedStage === 'accountant' ? 'Contabilidade e recebimento' : 'Auditoria do recibo'}
              </p>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">
              {selectedStage === 'accountant'
                ? 'Acompanhe a solicitação e o recebimento do arquivo original enviado pelo contador.'
                : 'Compare o arquivo original preservado com os dados processados antes de aprovar.'}
            </p>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-2">
            {selectedStage === 'accountant' ? (
              <>
                <Substep done={accountantRequested} active={noticeSigned && !accountantRequested} label="Solicitar ao contador" detail={accountantRequested ? 'Solicitação enviada' : noticeSigned ? 'Aviso assinado disponível' : 'Após ciência do aviso'} />
                <Substep done={receiptReceived} active={workflow.receipt.status === 'processing'} label="Recibo original" detail={receiptReceived ? 'Original preservado' : 'Aguardando upload'} />
              </>
            ) : (
              <Substep done={receiptApproved} active={workflow.receipt.status === 'review_pending'} label="Auditoria do RH" detail={receiptApproved ? 'Recibo aprovado' : receiptReceived ? 'Original + extração' : 'Aguardando o recibo original'} />
            )}
          </div>
          {selectedStage === 'receipt_review' ? (
          <div className="mx-4 mb-4 grid gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
            {[
              { icon: ReceiptText, label: 'Original do contador', detail: 'PDF imutável e hash' },
              { icon: FileCheck2, label: 'Dados extraídos', detail: 'Comparação campo a campo' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2">
                <item.icon className="h-4 w-4 text-slate-400" />
                <span><span className="block text-[10.5px] font-black text-slate-800">{item.label}</span><span className="block text-[9.5px] font-semibold text-slate-500">{item.detail}</span></span>
              </div>
            ))}
          </div>
          ) : null}
          <div className="border-t border-emerald-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {selectedStage === 'accountant' && noticeSigned && canApprove && ['ready_to_send', 'failed', 'correction_requested'].includes(workflow.accountant.status) ? (
                <Button
                  size="sm"
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700"
                  disabled={workflowBusy !== null}
                  onClick={() => onSendAccountant(record)}
                >
                  {workflowBusy === 'accountant' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {workflow.accountant.status === 'failed' ? 'Tentar envio novamente' : 'Enviar à contabilidade'}
                </Button>
              ) : null}
              {workflow.receipt.originalStoragePath ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  disabled={workflowBusy !== null}
                  onClick={() => onOpenWorkflowAsset(record, 'receipt-original')}
                >
                  {workflowBusy === 'open-receipt-original' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Abrir recibo original
                </Button>
              ) : null}
              {selectedStage === 'accountant' && workflow.accountant.recipientEmail ? (
                <span className="text-[10.5px] font-semibold text-slate-500">
                  Contabilidade: {workflow.accountant.recipientEmail} · {emailStatusLabel(workflow.accountant.emailStatus)}
                </span>
              ) : null}
            </div>
            {selectedStage === 'accountant' && workflow.accountant.lastError ? (
              <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10.5px] font-semibold text-rose-700">
                {workflow.accountant.lastError}
              </p>
            ) : null}
          </div>

          {selectedStage === 'receipt_review' && workflow.receipt.status === 'processing' ? (
            <div className="border-t border-emerald-100 px-4 py-4 text-[11px] font-semibold text-emerald-700">
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Processando o recibo original para auditoria.</span>
            </div>
          ) : null}

          {selectedStage === 'receipt_review' && workflow.receipt.status === 'review_pending' ? (
            <div className="space-y-4 border-t border-emerald-100 bg-emerald-50/30 p-4">
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">Leitura automática</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[10.5px]">
                    <dt className="font-semibold text-slate-500">Colaborador</dt><dd className="text-right font-black">{analysis?.employeeName ?? 'Não identificado'}</dd>
                    <dt className="font-semibold text-slate-500">Período</dt><dd className="text-right font-black">{formatDate(analysis?.vacationStartDate)} → {formatDate(analysis?.vacationEndDate)}</dd>
                    <dt className="font-semibold text-slate-500">Bruto</dt><dd className="text-right font-black">{formatMoney(analysis?.amountGross)}</dd>
                    <dt className="font-semibold text-slate-500">Descontos</dt><dd className="text-right font-black">{formatMoney(analysis?.amountDiscounts)}</dd>
                    <dt className="font-semibold text-slate-500">Líquido</dt><dd className="text-right font-black">{formatMoney(analysis?.amountNet)}</dd>
                    <dt className="font-semibold text-slate-500">Assinatura no original</dt><dd className="text-right font-black">{analysis?.signatureDetected == null ? 'Não identificado' : analysis.signatureDetected ? 'Sim' : 'Não'}</dd>
                  </dl>
                  {workflow.receipt.analysis?.warnings.length || workflow.receipt.analysis?.issues.length ? (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-800">
                      {[...(workflow.receipt.analysis?.issues ?? []), ...(workflow.receipt.analysis?.warnings ?? [])].join(' · ')}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-emerald-200 bg-white p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.08em] text-emerald-700">Valores conferidos pelo RH</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1 text-[10px] font-bold text-slate-600">Bruto<Input type="number" min="0" step="0.01" value={receiptValues.grossAmount} onChange={(event) => setReceiptValues((current) => ({ ...current, grossAmount: event.target.value }))} /></label>
                    <label className="space-y-1 text-[10px] font-bold text-slate-600">Descontos<Input type="number" min="0" step="0.01" value={receiptValues.discountAmount} onChange={(event) => setReceiptValues((current) => ({ ...current, discountAmount: event.target.value }))} /></label>
                    <label className="space-y-1 text-[10px] font-bold text-slate-600">Líquido<Input type="number" min="0.01" step="0.01" value={receiptValues.netAmount} onChange={(event) => setReceiptValues((current) => ({ ...current, netAmount: event.target.value }))} /></label>
                    <label className="space-y-1 text-[10px] font-bold text-slate-600">Data indicada<Input type="date" value={receiptValues.paymentDate} onChange={(event) => setReceiptValues((current) => ({ ...current, paymentDate: event.target.value }))} /></label>
                  </div>
                  <Textarea className="mt-2 min-h-16" placeholder="Observação da auditoria (opcional)" value={receiptNotes} onChange={(event) => setReceiptNotes(event.target.value)} />
                  <Textarea
                    className="mt-2 min-h-16"
                    placeholder={receiptNeedsOverride
                      ? 'Justificativa obrigatória para aprovar divergências documentais'
                      : 'Justificativa de exceção (somente se necessária)'}
                    value={receiptOverrideReason}
                    onChange={(event) => setReceiptOverrideReason(event.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2 lg:grid-cols-[1fr_auto_auto]">
                <Input
                  placeholder="Descreva o que o contador precisa corrigir"
                  value={correctionReason}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                />
                <Button
                  variant="outline"
                  className="rounded-xl border-amber-300 text-amber-800"
                  disabled={!canApprove || workflowBusy !== null || !correctionReason.trim()}
                  onClick={() => onReviewReceipt(record, {
                    decision: 'correction_required',
                    reason: correctionReason.trim(),
                    notes: receiptNotes.trim() || undefined,
                  })}
                >
                  {workflowBusy === 'correct-receipt' ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                  Solicitar correção
                </Button>
                <Button
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700"
                  disabled={!canApprove || workflowBusy !== null
                    || !receiptValuesValid
                    || (receiptNeedsOverride && receiptOverrideReason.trim().length < 10)}
                  onClick={() => onReviewReceipt(record, {
                    decision: 'approved',
                    values: {
                      grossAmount: Number(receiptValues.grossAmount),
                      discountAmount: Number(receiptValues.discountAmount),
                      netAmount: Number(receiptValues.netAmount),
                      paymentDate: receiptValues.paymentDate || null,
                    },
                    notes: receiptNotes.trim() || undefined,
                    overrideReason: receiptOverrideReason.trim() || undefined,
                  })}
                >
                  {workflowBusy === 'approve-receipt' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Aprovar e enviar ao Financeiro
                </Button>
              </div>
            </div>
          ) : null}
          {selectedStage === 'receipt_review' && !receiptReceived ? (
            <div className="mx-4 mb-4 flex gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-[10.5px] font-semibold text-slate-500">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
              A auditoria será liberada assim que o contador enviar o recibo original.
            </div>
          ) : null}
          {selectedStage === 'receipt_review' && receiptApproved ? (
            <div className="mx-4 mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
              <p className="text-[11px] font-black text-emerald-900">Recibo aprovado pelo RH</p>
              <p className="mt-1 text-[10.5px] font-semibold text-emerald-700">
                {formatMoney(workflow.receipt.reviewedValues?.netAmount ?? analysis?.amountNet)} líquidos · dados conferidos e enviados ao Financeiro.
              </p>
            </div>
          ) : null}
        </div>
        ) : null}

        {selectedStage === 'payment' || selectedStage === 'receipt_signature' || selectedStage === 'closure' ? (
        <div className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm">
          <div className="border-b border-sky-100 px-4 py-3.5">
            <div className="flex items-center gap-2">
              {selectedStage === 'payment' ? <Landmark className="h-4 w-4 text-sky-600" /> : selectedStage === 'receipt_signature' ? <UserRoundCheck className="h-4 w-4 text-sky-600" /> : <CheckCircle2 className="h-4 w-4 text-sky-600" />}
              <p className="text-[13px] font-black">
                {selectedStage === 'payment' ? 'Pagamento das férias' : selectedStage === 'receipt_signature' ? 'Assinatura do recibo' : 'Finalização pelo RH'}
              </p>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">
              {selectedStage === 'payment'
                ? `Prazo de pagamento: ${formatDate(workflow.payment.dueAt)}. A autorização bancária permanece com o Financeiro.`
                : selectedStage === 'receipt_signature'
                  ? 'O recibo só é liberado para assinatura depois da confirmação do pagamento.'
                  : 'Confira o conjunto documental e encerre formalmente a trilha de férias.'}
            </p>
          </div>
          <div className="p-4">
            {selectedStage === 'payment' ? (
              <Substep done={paymentPaid} active={!paymentPaid && workflow.currentStage === 'payment'} label="Financeiro" detail={paymentPaid ? 'Pagamento confirmado' : 'Autorizar e acompanhar'} />
            ) : selectedStage === 'receipt_signature' ? (
              <Substep done={receiptSigned} active={paymentPaid && !receiptSigned} label="Assinar recibo" detail={receiptSigned ? 'Assinatura concluída' : 'Bloqueado até o pagamento'} />
            ) : (
              <Substep done={workflow.closure.status === 'completed'} active={workflow.closure.status === 'ready'} label="Finalizar no RH" detail={workflow.closure.status === 'completed' ? 'Trilha encerrada' : 'Após assinatura do recibo'} />
            )}
          </div>
          {selectedStage === 'payment' && workflow.receipt.status === 'approved' ? (
            <div className="mx-4 mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-black text-sky-950">{paymentStatusLabel(workflow.payment.status)}</p>
                  <p className="mt-0.5 text-[10px] font-semibold text-sky-700">
                    {formatMoney(workflow.payment.amount)} · prazo legal {formatDate(workflow.payment.dueAt)}
                    {workflow.payment.scheduledFor ? ` · programado para ${formatDate(workflow.payment.scheduledFor)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canApprove && ['not_started', 'failed'].includes(workflow.payment.status) ? (
                    <Button
                      size="sm"
                      className="rounded-xl bg-sky-700 hover:bg-sky-800"
                      disabled={workflowBusy !== null}
                      onClick={() => onPreparePayment(record)}
                    >
                      {workflowBusy === 'prepare-payment' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}
                      {workflow.payment.status === 'failed' ? 'Tentar preparar novamente' : 'Preparar pagamento'}
                    </Button>
                  ) : null}
                  {workflow.payment.paymentRequestId && !paymentPaid ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      disabled={workflowBusy !== null}
                      onClick={() => onSyncPayment(record)}
                    >
                      {workflowBusy === 'sync-payment' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
                      Atualizar pagamento
                    </Button>
                  ) : null}
                </div>
              </div>
              {workflow.payment.lastError ? <p className="mt-2 text-[10px] font-semibold text-rose-700">{workflow.payment.lastError}</p> : null}
              {workflow.payment.proofStoragePath ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 rounded-xl"
                  disabled={workflowBusy !== null}
                  onClick={() => onOpenWorkflowAsset(record, 'payment-proof')}
                >
                  {workflowBusy === 'open-payment-proof' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Abrir comprovante do pagamento
                </Button>
              ) : null}
            </div>
          ) : null}
          {selectedStage === 'payment' && workflow.receipt.status !== 'approved' ? (
            <div className="mx-4 mb-4 flex gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10.5px] font-semibold text-slate-500">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
              O pagamento será preparado depois que o RH aprovar a auditoria do recibo.
            </div>
          ) : null}
          {selectedStage === 'receipt_signature' && !paymentPaid ? (
            <div className="mx-4 mb-4 flex gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10.5px] font-semibold text-slate-500">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
              O recibo permanece indisponível para assinatura enquanto o pagamento não estiver confirmado.
            </div>
          ) : null}
          {selectedStage === 'receipt_signature' && paymentPaid ? (
            <div className="mx-4 mb-4 flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[10.5px] font-semibold text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              Pagamento confirmado. O recibo pode seguir para assinatura do colaborador.
            </div>
          ) : null}
          {selectedStage === 'receipt_signature' && paymentPaid ? (
            <div className="mx-4 mb-4 flex flex-wrap items-center gap-2 border-t border-sky-100 pt-3">
              {canApprove && ['ready', 'failed'].includes(workflow.receiptSignature.status) ? (
                <Button
                  size="sm"
                  className="rounded-xl bg-[#df2f78] hover:bg-[#c82569]"
                  disabled={workflowBusy !== null}
                  onClick={() => onRetryReceiptSignature(record)}
                >
                  {workflowBusy === 'retry-receipt-signature' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />}
                  {workflow.receiptSignature.status === 'failed' ? 'Reenviar recibo' : 'Enviar recibo para assinatura'}
                </Button>
              ) : null}
              {workflow.receiptSignature.status === 'sent' ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    disabled={workflowBusy !== null}
                    onClick={() => onSyncReceiptSignature(record)}
                  >
                    {workflowBusy === 'sync-receipt-signature' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
                    Atualizar assinatura
                  </Button>
                  {canApprove ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      disabled={workflowBusy !== null}
                      onClick={() => onRetryReceiptSignature(record)}
                    >
                      {workflowBusy === 'retry-receipt-signature' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />}
                      Reenviar convite
                    </Button>
                  ) : null}
                </>
              ) : null}
              {receiptSigned ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  disabled={workflowBusy !== null}
                  onClick={() => onOpenWorkflowAsset(record, 'receipt-signed')}
                >
                  {workflowBusy === 'open-receipt-signed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Abrir recibo assinado
                </Button>
              ) : null}
              {workflow.receiptSignature.lastError ? (
                <span className="text-[10.5px] font-semibold text-rose-700">{workflow.receiptSignature.lastError}</span>
              ) : null}
            </div>
          ) : null}
          {selectedStage === 'receipt_signature' && workflow.receiptSignature.participants?.length ? (
            <div className="space-y-3 border-t border-sky-100 bg-sky-50/40 p-4">
              {workflow.receiptSignature.participants.map((participant) => (
                <SignatureParticipantCard
                  key={participant.providerSignatureId}
                  participant={participant}
                  tone="sky"
                />
              ))}
            </div>
          ) : null}
          {selectedStage === 'closure' ? (
            <div className="mx-4 mb-4 rounded-xl border border-sky-200 bg-sky-50 px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black text-sky-950">
                    {workflow.closure.status === 'completed' ? 'Trilha encerrada' : workflow.closure.status === 'ready' ? 'Pronta para finalização' : 'Aguardando assinatura do recibo'}
                  </p>
                  <p className="mt-1 text-[10.5px] font-semibold text-sky-700">
                    {workflow.closure.status === 'completed'
                      ? 'Todos os documentos, pagamentos e assinaturas foram conferidos.'
                      : 'A finalização preserva o histórico e encerra o processo no RH.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      { label: 'Aviso', done: noticeSigned },
                      { label: 'Pagamento', done: paymentPaid },
                      { label: 'Recibo', done: receiptSigned },
                    ].map(item => (
                      <Badge
                        key={item.label}
                        variant="outline"
                        className={item.done
                          ? 'rounded-full border-emerald-200 bg-white text-[9.5px] font-black text-emerald-700'
                          : 'rounded-full border-slate-200 bg-white text-[9.5px] font-black text-slate-500'}
                      >
                        {item.label}: {item.done ? 'concluído' : 'pendente'}
                      </Badge>
                    ))}
                  </div>
                </div>
                {canApprove && workflow.closure.status === 'ready' ? (
                  <Button
                    size="sm"
                    className="rounded-xl bg-emerald-600 hover:bg-emerald-700"
                    disabled={workflowBusy !== null}
                    onClick={() => onFinalizeWorkflow(record)}
                  >
                    {workflowBusy === 'finalize' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Finalizar trilha
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        ) : null}
      </div>

    </section>
  );
}
