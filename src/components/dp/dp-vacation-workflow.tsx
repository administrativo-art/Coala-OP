"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  FileCheck2,
  FileText,
  ExternalLink,
  Landmark,
  Loader2,
  LockKeyhole,
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
import type {
  DPVacationRecord,
  DPVacationWorkflow,
  DPVacationWorkflowStep,
} from '@/types';

type Props = {
  records: DPVacationRecord[];
  selectedId: string | null;
  canEdit: boolean;
  canApprove: boolean;
  onSelect: (id: string) => void;
  onEdit: (record: DPVacationRecord) => void;
  onApprove: (record: DPVacationRecord) => void;
  onGenerateNotice: (record: DPVacationRecord) => void;
  onValidateNotice: (record: DPVacationRecord) => void;
  onOpenNotice: (record: DPVacationRecord) => void;
  onSendNotice: (record: DPVacationRecord) => void;
  onSyncNotice: (record: DPVacationRecord) => void;
  noticeBusy: 'generate' | 'validate' | 'open' | 'send' | 'sync' | null;
  workflowBusy: string | null;
  onSendAccountant: (record: DPVacationRecord) => void;
  onReviewReceipt: (record: DPVacationRecord, review: {
    decision: 'approved' | 'correction_required';
    values?: { grossAmount: number; discountAmount: number; netAmount: number; paymentDate?: string | null };
    notes?: string;
    reason?: string;
  }) => void;
  onPreparePayment: (record: DPVacationRecord) => void;
  onSyncPayment: (record: DPVacationRecord) => void;
  onRetryReceiptSignature: (record: DPVacationRecord) => void;
  onSyncReceiptSignature: (record: DPVacationRecord) => void;
  onFinalizeWorkflow: (record: DPVacationRecord) => void;
  onOpenWorkflowAsset: (record: DPVacationRecord, kind: 'receipt-original' | 'receipt-signed') => void;
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
    owner: workflow.accountant.status === 'failed' ? 'RH' : 'Contador',
    title: workflow.accountant.status === 'failed' ? 'Reenviar a solicitação à contabilidade' : 'Aguardando o recibo original',
    description: workflow.accountant.status === 'failed'
      ? 'O envio anterior não terminou. Confira o contato e tente novamente.'
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
    owner: workflow.payment.status === 'failed' ? 'RH' : 'Financeiro',
    title: workflow.payment.status === 'failed' ? 'Corrigir a preparação do pagamento' : 'Autorizar e confirmar o pagamento',
    description: workflow.payment.status === 'failed'
      ? 'Confira o vínculo, CPF e chave Pix da colaboradora antes de tentar novamente.'
      : 'O recibo somente será liberado para assinatura depois da confirmação bancária.',
  };
  if (step.id === 'receipt_signature') return {
    owner: workflow.receiptSignature.status === 'failed' ? 'RH' : 'Colaborador',
    title: workflow.receiptSignature.status === 'failed' ? 'Reenviar o recibo para assinatura' : 'Assinar o recibo de férias',
    description: workflow.receiptSignature.status === 'failed'
      ? 'A tentativa anterior não terminou. O RH pode reenviar somente esta assinatura.'
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

function EmptyWorkflow() {
  return (
    <section className="rounded-[18px] border border-dashed border-stone-300 bg-[#faf9f6] p-6 text-center">
      <FileCheck2 className="mx-auto h-8 w-8 text-stone-300" />
      <p className="mt-3 text-sm font-black text-stone-700">Nenhum período de gozo registrado</p>
      <p className="mt-1 text-xs font-semibold text-stone-500">
        Registre as férias para iniciar a análise, o aviso, o recibo e o pagamento em uma única trilha.
      </p>
    </section>
  );
}

export function DPVacationWorkflowPanel({
  records,
  selectedId,
  canEdit,
  canApprove,
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
  }, [
    record?.id,
    workflow?.receipt.originalDocumentId,
    workflow?.receipt.status,
    workflow?.receipt.reviewedValues,
    workflow?.receipt.reviewNotes,
    workflow?.receipt.correctionReason,
    workflow?.receipt.analysis?.extractedFields,
  ]);

  if (!record || !workflow) return <EmptyWorkflow />;

  const action = nextAction(workflow);
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
    && Number(receiptValues.netAmount) > 0;

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
          </div>
        </div>

        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
          {VACATION_WORKFLOW_STAGE_META.map((meta, index) => {
            const step = workflow.steps.find((candidate) => candidate.id === meta.id)!;
            return (
              <div key={meta.id} className={`min-w-[124px] flex-1 rounded-[13px] border-b-[3px] px-3 py-2.5 ${stepClasses(step)}`}>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[9px] font-bold opacity-70">0{index + 1}</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${step.status === 'completed' ? 'bg-emerald-500' : step.status === 'in_progress' || step.status === 'waiting_external' ? 'bg-[#df2f78]' : 'bg-stone-300'}`} />
                </span>
                <span className="mt-1 block text-[12px] font-black leading-snug">{meta.short}</span>
                <span className="mt-0.5 block text-[9.5px] font-bold opacity-70">{stepStateLabel(step)}</span>
              </div>
            );
          })}
        </div>
      </div>

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

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#df2f78]" />
              <p className="text-[13px] font-black">Análise inicial do agendamento</p>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">
              O alerta de 30 dias é informativo e não impede a continuidade.
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
              {canApprove && ['not_generated', 'failed'].includes(notice.status) ? (
                <Button
                  size="sm"
                  className="rounded-xl bg-violet-600 hover:bg-violet-700"
                  disabled={noticeBusy !== null}
                  onClick={() => onGenerateNotice(record)}
                >
                  {noticeBusy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  {notice.status === 'failed' ? 'Gerar novamente' : 'Gerar aviso'}
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
                <Button
                  size="sm"
                  className="rounded-xl bg-[#df2f78] hover:bg-[#c82569]"
                  disabled={noticeBusy !== null}
                  onClick={() => onSendNotice(record)}
                >
                  {noticeBusy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />}
                  Enviar para assinatura
                </Button>
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
            <div className="grid gap-3 border-t border-violet-100 bg-violet-50/40 p-4 lg:grid-cols-2">
              {notice.participants.map((participant) => (
                <div key={participant.providerSignatureId} className={`rounded-xl border bg-white p-3 ${
                  participant.status === 'delivery_failed' || participant.status === 'rejected'
                    ? 'border-rose-200'
                    : participant.status === 'signed'
                      ? 'border-emerald-200'
                      : 'border-slate-200'
                }`}>
                  <div className="flex items-start gap-3">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarImage src={participant.avatarUrl ?? undefined} />
                      <AvatarFallback>{participantInitials(participant.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-black uppercase tracking-[0.08em] text-violet-700">
                        {participant.party === 'employee' ? 'Colaborador(a)' : 'Empregadora'}
                      </p>
                      <p className="truncate text-[11.5px] font-black text-slate-900">{participant.name}</p>
                      <p className="truncate text-[10px] font-semibold text-slate-500">{participant.email}</p>
                    </div>
                    <Badge variant="outline" className="rounded-full text-[9px] font-black">
                      {participantStatusLabel(participant.status)}
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-1 text-[9.5px] font-semibold text-slate-500 sm:grid-cols-2">
                    <span>E-mail entregue: {participant.emailDeliveredAt ? 'Sim' : 'Pendente'}</span>
                    <span>Documento aberto: {participant.viewedAt ? 'Sim' : 'Pendente'}</span>
                    <span>Assinatura: {participant.signedAt ? 'Concluída' : 'Pendente'}</span>
                    {participant.deliveryFailureReason ? (
                      <span className="text-rose-700 sm:col-span-2">Motivo: {participant.deliveryFailureReason}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
          <div className="border-b border-emerald-100 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-emerald-600" />
              <p className="text-[13px] font-black">Contador e auditoria do recibo</p>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">
              O arquivo original será preservado e exibido ao lado dos dados processados.
            </p>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-3">
            <Substep done={accountantRequested} active={noticeSigned && !accountantRequested} label="Solicitar ao contador" detail={accountantRequested ? 'Solicitação enviada' : noticeSigned ? 'Aviso assinado disponível' : 'Após ciência do aviso'} />
            <Substep done={receiptReceived} active={workflow.receipt.status === 'processing'} label="Recibo original" detail={receiptReceived ? 'Original preservado' : 'Aguardando upload'} />
            <Substep done={receiptApproved} active={workflow.receipt.status === 'review_pending'} label="Auditoria do RH" detail={receiptApproved ? 'Recibo aprovado' : 'Original + extração'} />
          </div>
          <div className="mx-4 mb-4 grid gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
            {[
              { icon: ReceiptText, label: 'Original do contador', detail: 'PDF imutável e hash' },
              { icon: FileCheck2, label: 'Dados extraídos', detail: 'Comparação campo a campo' },
              { icon: UserRoundCheck, label: 'Versão assinada', detail: 'Gerada após o pagamento' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2">
                <item.icon className="h-4 w-4 text-slate-400" />
                <span><span className="block text-[10.5px] font-black text-slate-800">{item.label}</span><span className="block text-[9.5px] font-semibold text-slate-500">{item.detail}</span></span>
              </div>
            ))}
          </div>
          <div className="border-t border-emerald-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {noticeSigned && canApprove && ['ready_to_send', 'failed', 'correction_requested'].includes(workflow.accountant.status) ? (
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
              {workflow.accountant.recipientEmail ? (
                <span className="text-[10.5px] font-semibold text-slate-500">
                  Contabilidade: {workflow.accountant.recipientEmail} · {emailStatusLabel(workflow.accountant.emailStatus)}
                </span>
              ) : null}
            </div>
            {workflow.accountant.lastError ? (
              <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10.5px] font-semibold text-rose-700">
                {workflow.accountant.lastError}
              </p>
            ) : null}
          </div>

          {workflow.receipt.status === 'processing' ? (
            <div className="border-t border-emerald-100 px-4 py-4 text-[11px] font-semibold text-emerald-700">
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Processando o recibo original para auditoria.</span>
            </div>
          ) : null}

          {workflow.receipt.status === 'review_pending' ? (
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
                  disabled={workflowBusy !== null || !correctionReason.trim()}
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
                  disabled={workflowBusy !== null || !receiptValuesValid}
                  onClick={() => onReviewReceipt(record, {
                    decision: 'approved',
                    values: {
                      grossAmount: Number(receiptValues.grossAmount),
                      discountAmount: Number(receiptValues.discountAmount),
                      netAmount: Number(receiptValues.netAmount),
                      paymentDate: receiptValues.paymentDate || null,
                    },
                    notes: receiptNotes.trim() || undefined,
                  })}
                >
                  {workflowBusy === 'approve-receipt' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Aprovar e enviar ao Financeiro
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm">
          <div className="border-b border-sky-100 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-sky-600" />
              <p className="text-[13px] font-black">Pagamento, assinatura e fechamento</p>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">
              Prazo de pagamento: {formatDate(workflow.payment.dueAt)}. A autorização bancária permanece com o Financeiro.
            </p>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-3">
            <Substep done={paymentPaid} active={workflow.payment.status !== 'not_started' && !paymentPaid} label="Financeiro" detail={paymentPaid ? 'Pagamento confirmado' : 'Autorizar e acompanhar'} />
            <Substep done={receiptSigned} active={paymentPaid && !receiptSigned} label="Assinar recibo" detail={receiptSigned ? 'Assinatura concluída' : 'Bloqueado até o pagamento'} />
            <Substep done={workflow.closure.status === 'completed'} active={workflow.closure.status === 'ready'} label="Finalizar no RH" detail={workflow.closure.status === 'completed' ? 'Trilha encerrada' : 'Após assinatura do recibo'} />
          </div>
          {workflow.receipt.status === 'approved' ? (
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
                      Preparar novamente
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
            </div>
          ) : null}
          {!paymentPaid ? (
            <div className="mx-4 mb-4 flex gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10.5px] font-semibold text-slate-500">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
              O recibo permanece indisponível para assinatura enquanto o pagamento não estiver confirmado.
            </div>
          ) : (
            <div className="mx-4 mb-4 flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[10.5px] font-semibold text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              Pagamento confirmado. O recibo pode seguir para assinatura do colaborador.
            </div>
          )}
          {paymentPaid ? (
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
              {canApprove && workflow.closure.status === 'ready' ? (
                <Button
                  size="sm"
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700"
                  disabled={workflowBusy !== null}
                  onClick={() => onFinalizeWorkflow(record)}
                >
                  {workflowBusy === 'finalize' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Finalizar trilha no RH
                </Button>
              ) : null}
              {workflow.receiptSignature.lastError ? (
                <span className="text-[10.5px] font-semibold text-rose-700">{workflow.receiptSignature.lastError}</span>
              ) : null}
            </div>
          ) : null}
          {workflow.receiptSignature.participants?.length ? (
            <div className="grid gap-3 border-t border-sky-100 bg-sky-50/40 p-4">
              {workflow.receiptSignature.participants.map((participant) => (
                <div key={participant.providerSignatureId} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarImage src={participant.avatarUrl ?? undefined} />
                      <AvatarFallback>{participantInitials(participant.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-black uppercase tracking-[0.08em] text-sky-700">Colaborador(a)</p>
                      <p className="truncate text-[11.5px] font-black text-slate-900">{participant.name}</p>
                      <p className="truncate text-[10px] font-semibold text-slate-500">{participant.email}</p>
                    </div>
                    <Badge variant="outline" className="rounded-full text-[9px] font-black">{participantStatusLabel(participant.status)}</Badge>
                  </div>
                  <div className="mt-3 grid gap-1 text-[9.5px] font-semibold text-slate-500 sm:grid-cols-3">
                    <span>E-mail entregue: {participant.emailDeliveredAt ? 'Sim' : 'Pendente'}</span>
                    <span>Documento aberto: {participant.viewedAt ? 'Sim' : 'Pendente'}</span>
                    <span>Assinatura: {participant.signedAt ? 'Concluída' : 'Pendente'}</span>
                    {participant.deliveryFailureReason ? <span className="text-rose-700 sm:col-span-3">Motivo: {participant.deliveryFailureReason}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
