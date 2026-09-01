import type {
  DPVacationLegalCheck,
  DPVacationRecord,
  DPVacationStatus,
  DPVacationWorkflow,
  DPVacationWorkflowStageId,
  DPVacationWorkflowStep,
} from '@/types';

const DAY_MS = 86_400_000;

export const VACATION_WORKFLOW_STAGE_META: ReadonlyArray<{
  id: DPVacationWorkflowStageId;
  label: string;
  short: string;
  owner: DPVacationWorkflowStep['owner'];
}> = [
  { id: 'scheduling', label: 'Agendamento e análise', short: 'Agendar', owner: 'hr' },
  { id: 'notice', label: 'Aviso e ciência', short: 'Aviso', owner: 'employee' },
  { id: 'accountant', label: 'Contabilidade', short: 'Contador', owner: 'accountant' },
  { id: 'receipt_review', label: 'Auditoria do recibo', short: 'Revisão', owner: 'hr' },
  { id: 'payment', label: 'Pagamento das férias', short: 'Financeiro', owner: 'finance' },
  { id: 'receipt_signature', label: 'Assinatura do recibo', short: 'Recibo', owner: 'employee' },
  { id: 'closure', label: 'Finalização pelo RH', short: 'Finalizar', owner: 'hr' },
];

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function shiftIsoDate(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function daysBetween(left: string, right: string) {
  const leftTime = Date.parse(`${left}T00:00:00.000Z`);
  const rightTime = Date.parse(`${right}T00:00:00.000Z`);
  return Math.round((rightTime - leftTime) / DAY_MS);
}

export function vacationWorkflowDeadlines(startDate?: string | null) {
  if (!isIsoDate(startDate)) {
    return { noticeDeadline: null, paymentDeadline: null };
  }
  return {
    noticeDeadline: shiftIsoDate(startDate, -30),
    paymentDeadline: shiftIsoDate(startDate, -2),
  };
}

export function analyzeVacationScheduling(input: {
  startDate?: string | null;
  endDate?: string | null;
  asOfDate: string;
}) {
  const checks: DPVacationLegalCheck[] = [];
  const validStart = isIsoDate(input.startDate);
  const validEnd = isIsoDate(input.endDate);
  const validAsOf = isIsoDate(input.asOfDate);
  const validRange = validStart && validEnd && input.endDate! >= input.startDate!;

  checks.push({
    code: 'date_range',
    label: 'Período informado',
    status: validRange ? 'ok' : 'blocked',
    message: validRange
      ? 'As datas de início e término são coerentes.'
      : 'Informe um período de férias válido.',
    blocking: !validRange,
  });

  const noticeLeadDays = validStart && validAsOf
    ? daysBetween(input.asOfDate, input.startDate!)
    : null;
  const noticeCompliant = noticeLeadDays !== null && noticeLeadDays >= 30;
  checks.push({
    code: 'notice_lead_time',
    label: 'Comunicação com 30 dias',
    status: noticeCompliant ? 'ok' : 'warning',
    message: noticeLeadDays === null
      ? 'A antecedência será calculada quando a data de início estiver definida.'
      : noticeCompliant
        ? `Há ${noticeLeadDays} dias entre o agendamento e o início das férias.`
        : `Há ${noticeLeadDays} dias até o início. A comunicação ficará fora da antecedência de 30 dias.`,
    blocking: false,
  });

  checks.push({
    code: 'calendar_review',
    label: 'Feriado e repouso semanal',
    status: 'manual_review',
    message: 'A validação depende do calendário e do repouso semanal aplicáveis à colaboradora.',
    blocking: false,
  });
  checks.push({
    code: 'cycle_review',
    label: 'Saldo e fracionamento',
    status: 'manual_review',
    message: 'O ciclo completo deve ser conferido antes da aprovação do agendamento.',
    blocking: false,
  });

  return {
    noticeLeadDays,
    checks,
    ...vacationWorkflowDeadlines(input.startDate),
  };
}

function initialStepStatus(
  stageId: DPVacationWorkflowStageId,
  vacationStatus: DPVacationStatus,
): DPVacationWorkflowStep['status'] {
  if (vacationStatus === 'REJECTED') return 'cancelled';
  if (stageId === 'scheduling') {
    return vacationStatus === 'APPROVED' ? 'completed' : 'in_progress';
  }
  if (stageId === 'notice' && vacationStatus === 'APPROVED') return 'in_progress';
  return 'pending';
}

export function createInitialVacationWorkflow(input: {
  status: DPVacationStatus;
  startDate?: string | null;
  endDate?: string | null;
  now: string;
  asOfDate: string;
  actorId?: string | null;
}): DPVacationWorkflow {
  const legal = analyzeVacationScheduling(input);
  const currentStage: DPVacationWorkflowStageId = input.status === 'APPROVED'
    ? 'notice'
    : 'scheduling';
  const steps = VACATION_WORKFLOW_STAGE_META.map((stage): DPVacationWorkflowStep => ({
    id: stage.id,
    label: stage.label,
    owner: stage.owner,
    status: initialStepStatus(stage.id, input.status),
    dueAt: stage.id === 'notice'
      ? legal.noticeDeadline
      : stage.id === 'payment'
        ? legal.paymentDeadline
        : null,
    startedAt: stage.id === currentStage ? input.now : null,
    completedAt: stage.id === 'scheduling' && input.status === 'APPROVED' ? input.now : null,
    completedBy: stage.id === 'scheduling' && input.status === 'APPROVED'
      ? input.actorId ?? null
      : null,
  }));

  return {
    version: 1,
    status: input.status === 'REJECTED' ? 'cancelled' : 'active',
    currentStage,
    steps,
    legalAnalysis: {
      analyzedAt: input.now,
      asOfDate: input.asOfDate,
      noticeDeadline: legal.noticeDeadline,
      paymentDeadline: legal.paymentDeadline,
      noticeLeadDays: legal.noticeLeadDays,
      checks: legal.checks,
    },
    notice: { status: 'not_generated' },
    accountant: { status: 'not_started' },
    receipt: { status: 'not_received' },
    payment: { status: 'not_started', dueAt: legal.paymentDeadline },
    receiptSignature: { status: 'blocked_until_payment' },
    closure: { status: 'pending' },
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function vacationWorkflowForRecord(
  record: Pick<DPVacationRecord, 'status' | 'startDate' | 'endDate' | 'workflow'>,
  now: string,
  asOfDate: string,
) {
  return record.workflow ?? createInitialVacationWorkflow({
    status: record.status,
    startDate: record.startDate,
    endDate: record.endDate,
    now,
    asOfDate,
  });
}

export function advanceVacationWorkflowToNotice(
  workflow: DPVacationWorkflow,
  input: { now: string; actorId: string },
): DPVacationWorkflow {
  return {
    ...workflow,
    status: 'active',
    currentStage: 'notice',
    steps: workflow.steps.map((step) => {
      if (step.id === 'scheduling') {
        return {
          ...step,
          status: 'completed',
          completedAt: input.now,
          completedBy: input.actorId,
        };
      }
      if (step.id === 'notice') {
        return { ...step, status: 'in_progress', startedAt: step.startedAt ?? input.now };
      }
      return step;
    }),
    updatedAt: input.now,
  };
}

export function cancelVacationWorkflow(workflow: DPVacationWorkflow, now: string) {
  return {
    ...workflow,
    status: 'cancelled' as const,
    steps: workflow.steps.map((step) => (
      step.status === 'completed' ? step : { ...step, status: 'cancelled' as const }
    )),
    updatedAt: now,
  };
}
