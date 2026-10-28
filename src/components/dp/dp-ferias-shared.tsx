import type { ReactNode } from 'react';

import type { DPVacationWorkflow, DPVacationWorkflowOwner } from '@/types';
import { cn } from '@/lib/utils';

export type VacationPillTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

const PILL_TONE: Record<VacationPillTone, string> = {
  ok: 'bg-ds-ok-bg text-ds-ok',
  warn: 'bg-ds-warn-bg text-ds-warn',
  danger: 'bg-ds-danger-bg text-ds-danger',
  info: 'bg-ds-info-bg text-ds-info',
  neutral: 'bg-ds-neutral-bg text-ds-neutral',
};

/** Status só de leitura (docs/design/status.md). */
export function VacationPill({ tone, children, className }: { tone: VacationPillTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-[21px] w-fit items-center whitespace-nowrap rounded-ds-pill px-[9px] text-[11.5px] font-bold', PILL_TONE[tone], className)}>
      {children}
    </span>
  );
}

/** Cores fixas das etapas em toda a tela de férias. */
export const VACATION_STAGE_COLORS = {
  done: 'bg-ds-ok',
  current: 'bg-ds-info',
  external: 'bg-ds-warn',
  risk: 'bg-ds-danger',
  next: 'bg-ds-border-input',
} as const;

export function VacationStageDots({ current, waitingExternal, total = 6 }: { current: number; waitingExternal?: boolean; total?: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`Etapa ${current} de ${total}`}>
      {Array.from({ length: total }, (_, index) => {
        const step = index + 1;
        const color = step < current
          ? VACATION_STAGE_COLORS.done
          : step === current
            ? (waitingExternal ? VACATION_STAGE_COLORS.external : VACATION_STAGE_COLORS.current)
            : VACATION_STAGE_COLORS.next;
        return <span key={step} aria-hidden="true" className={cn('block h-1.5 rounded-full', step === current ? 'w-[22px]' : 'w-3.5', color)} />;
      })}
    </span>
  );
}

export function VacationLegend({ className }: { className?: string }) {
  const items: Array<[string, string]> = [
    [VACATION_STAGE_COLORS.done, 'Feito'],
    [VACATION_STAGE_COLORS.current, 'Em andamento ou agendado'],
    [VACATION_STAGE_COLORS.external, 'Esperando alguém de fora'],
    [VACATION_STAGE_COLORS.risk, 'Prazo em risco'],
    [VACATION_STAGE_COLORS.next, 'Ainda não começou'],
  ];
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] font-bold text-ds-ink-2', className)}>
      {items.map(([color, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('h-1.5 w-3.5 rounded-full', color)} />
          {label}
        </span>
      ))}
    </div>
  );
}

const WORKFLOW_OWNER_LABEL: Record<DPVacationWorkflowOwner, string> = {
  hr: 'RH',
  employee: 'Colaborador',
  accountant: 'Contador',
  finance: 'Financeiro',
  system: 'Sistema',
};

/**
 * Próxima ação e responsável da parcela, a partir do estado da trilha. `employeeName` troca o papel genérico pelo
 * nome de quem precisa assinar.
 */
export function workflowOperationalSummary(workflow: DPVacationWorkflow, employeeName?: string) {
  const employee = employeeName ? employeeName.split(' ').slice(0, 2).join(' ') : 'Colaborador';
  const currentStep = workflow.steps.find(step => step.id === workflow.currentStage);
  const fallbackOwner = WORKFLOW_OWNER_LABEL[currentStep?.owner ?? 'hr'];

  if (workflow.currentStage === 'notice') {
    if (workflow.notice.status === 'not_generated') return { owner: 'RH', action: 'Gerar o aviso de férias' };
    if (workflow.notice.status === 'generating') return { owner: 'Sistema', action: 'Gerando o aviso de férias' };
    if (workflow.notice.status === 'draft') return { owner: 'RH', action: 'Validar o aviso de férias' };
    if (workflow.notice.status === 'validated') return { owner: 'RH', action: 'Enviar o aviso para assinatura' };
    if (workflow.notice.status === 'sending') return { owner: 'Sistema', action: 'Enviando o aviso para assinatura' };
    if (workflow.notice.status === 'failed') return { owner: 'RH', action: 'Corrigir e reenviar o aviso' };
    return { owner: employee, action: 'Assinar o aviso de férias' };
  }

  if (workflow.currentStage === 'accountant') {
    if (workflow.accountant.status === 'sending') return { owner: 'Sistema', action: 'Enviando documentos à contabilidade' };
    if (workflow.accountant.status === 'failed') return { owner: 'RH', action: 'Corrigir o envio à contabilidade' };
    if (workflow.accountant.status === 'correction_requested') return { owner: 'RH', action: 'Solicitar correção ao contador' };
    if (workflow.accountant.status === 'ready_to_send') return { owner: 'RH', action: 'Enviar documentos à contabilidade' };
    return { owner: 'Contador', action: 'Enviar o recibo calculado' };
  }

  if (workflow.currentStage === 'receipt_review') {
    if (workflow.receipt.status === 'processing') return { owner: 'Sistema', action: 'Processar o recibo do contador' };
    if (workflow.receipt.status === 'correction_requested') return { owner: 'Contador', action: 'Corrigir o recibo de férias' };
    return { owner: 'RH', action: 'Conferir os valores do recibo' };
  }

  if (workflow.currentStage === 'payment') {
    if (workflow.payment.status === 'preparing') return { owner: 'Sistema', action: 'Preparando o pagamento' };
    if (workflow.payment.status === 'not_started') return { owner: 'RH', action: 'Preparar o pagamento' };
    if (workflow.payment.status === 'failed') return { owner: 'RH', action: 'Corrigir a preparação do pagamento' };
    return { owner: 'Financeiro', action: 'Autorizar o Pix no Inter' };
  }

  if (workflow.currentStage === 'receipt_signature') {
    if (workflow.receiptSignature.status === 'ready') return { owner: 'RH', action: 'Enviar o recibo para assinatura' };
    if (workflow.receiptSignature.status === 'sending') return { owner: 'Sistema', action: 'Enviando o recibo para assinatura' };
    if (workflow.receiptSignature.status === 'failed') return { owner: 'RH', action: 'Reenviar o recibo para assinatura' };
    if (workflow.receiptSignature.status === 'blocked_until_payment') return { owner: 'Financeiro', action: 'Confirmar o pagamento' };
    return { owner: employee, action: 'Assinar o recibo de férias' };
  }

  if (workflow.currentStage === 'closure') {
    return { owner: 'RH', action: 'Conferir e finalizar a parcela' };
  }

  return { owner: fallbackOwner, action: 'Revisar e aprovar o agendamento' };
}
