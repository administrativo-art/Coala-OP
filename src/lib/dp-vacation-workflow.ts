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

export function vacationEntitlementDays(unjustifiedAbsences: number) {
  if (!Number.isInteger(unjustifiedAbsences) || unjustifiedAbsences < 0) return 0;
  if (unjustifiedAbsences <= 5) return 30;
  if (unjustifiedAbsences <= 14) return 24;
  if (unjustifiedAbsences <= 23) return 18;
  if (unjustifiedAbsences <= 32) return 12;
  return 0;
}

function weekday(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function dateAfter(value: string, days: number) {
  return shiftIsoDate(value, days);
}

type ComplianceCycleRecord = {
  recordType: DPVacationRecord['recordType'];
  startDate?: string | null;
  endDate?: string | null;
  days: number;
  status?: DPVacationStatus;
  employeeAgreedToSplit?: boolean;
  allowanceRequestedAt?: string | null;
};

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
  recordType?: DPVacationRecord['recordType'];
  startDate?: string | null;
  endDate?: string | null;
  asOfDate: string;
  calendarConfigured?: boolean;
  holidays?: string[];
  weeklyRestDay?: number | null;
  cycleRecords?: ComplianceCycleRecord[];
  entitledDays?: number;
  employeeAgreedToSplit?: boolean;
  acquisitionPeriodEnd?: string | null;
  concessiveDeadline?: string | null;
  allowanceRequestedAt?: string | null;
}) {
  const checks: DPVacationLegalCheck[] = [];
  const isAllowance = input.recordType === 'venda';
  const validStart = isIsoDate(input.startDate);
  const validEnd = isIsoDate(input.endDate);
  const validAsOf = isIsoDate(input.asOfDate);
  const validRange = isAllowance || (validStart && validEnd && input.endDate! >= input.startDate!);

  checks.push({
    code: 'date_range',
    label: 'Período informado',
    status: validRange ? 'ok' : 'blocked',
    message: validRange
      ? isAllowance ? 'O abono não exige datas de gozo.' : 'As datas de início e término são coerentes.'
      : 'Informe um período de férias válido.',
    blocking: !validRange,
  });

  const noticeLeadDays = !isAllowance && validStart && validAsOf
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

  const weeklyRestDay = input.weeklyRestDay;
  const calendarReady = isAllowance || (input.calendarConfigured === true
    && Number.isInteger(weeklyRestDay)
    && weeklyRestDay! >= 0
    && weeklyRestDay! <= 6);
  const blockedByCalendar = !isAllowance && validStart && calendarReady
    ? [1, 2].some((offset) => {
        const date = dateAfter(input.startDate!, offset);
        return input.holidays?.includes(date) || weekday(date) === weeklyRestDay;
      })
    : false;
  checks.push({
    code: 'calendar_review',
    label: 'Feriado e repouso semanal',
    status: !calendarReady ? 'blocked' : blockedByCalendar ? 'blocked' : 'ok',
    message: isAllowance
      ? 'Validação de calendário não se aplica ao abono.'
      : !calendarReady
      ? 'Selecione o calendário e informe o repouso semanal aplicáveis.'
      : blockedByCalendar
        ? 'O início está nos dois dias anteriores a feriado ou repouso semanal.'
        : 'O início respeita o calendário e o repouso semanal informados.',
    blocking: !calendarReady || blockedByCalendar,
  });

  const cycleRecords = (input.cycleRecords ?? []).filter((record) => record.status !== 'REJECTED');
  const enjoyment = cycleRecords.filter((record) => record.recordType === 'gozo');
  const allocatedDays = cycleRecords.reduce((total, record) => total + Number(record.days || 0), 0);
  const entitledDays = input.entitledDays ?? 30;
  const hasTooManyPeriods = enjoyment.length > 3;
  const hasShortPeriod = enjoyment.some((record) => Number(record.days) < 5);
  const hasLongPeriod = enjoyment.some((record) => Number(record.days) >= 14);
  const cycleIsFullyAllocated = entitledDays > 0 && allocatedDays >= entitledDays;
  const splitBlocked = hasTooManyPeriods || hasShortPeriod || (cycleIsFullyAllocated && !hasLongPeriod);
  checks.push({
    code: 'cycle_review',
    label: 'Saldo e fracionamento',
    status: splitBlocked ? 'blocked' : cycleIsFullyAllocated || hasLongPeriod ? 'ok' : 'warning',
    message: hasTooManyPeriods
      ? 'O ciclo não pode ter mais de três períodos de gozo.'
      : hasShortPeriod
        ? 'Cada período fracionado deve ter pelo menos cinco dias.'
        : cycleIsFullyAllocated && !hasLongPeriod
          ? 'Ao concluir o ciclo, pelo menos um período precisa ter 14 dias ou mais.'
          : hasLongPeriod
            ? 'O fracionamento possui período mínimo de 14 dias.'
            : 'Reserve ao menos um período de 14 dias antes de concluir o ciclo.',
    blocking: splitBlocked,
  });

  const needsAgreement = enjoyment.length > 1;
  const agreementRecorded = input.employeeAgreedToSplit === true
    || enjoyment.some((record) => record.employeeAgreedToSplit === true);
  const agreementBlocked = needsAgreement && !agreementRecorded;
  checks.push({
    code: 'employee_agreement',
    label: 'Concordância no fracionamento',
    status: agreementBlocked ? 'blocked' : 'ok',
    message: agreementBlocked
      ? 'Registre a concordância da colaboradora para o fracionamento.'
      : needsAgreement
        ? 'Concordância da colaboradora registrada.'
        : 'O período ainda não caracteriza fracionamento.',
    blocking: agreementBlocked,
  });

  const entitlementBlocked = entitledDays <= 0 || allocatedDays > entitledDays;
  checks.push({
    code: 'entitlement',
    label: 'Direito e saldo do ciclo',
    status: entitlementBlocked ? 'blocked' : 'ok',
    message: entitledDays <= 0
      ? 'As faltas injustificadas informadas eliminam o direito a férias neste ciclo.'
      : entitlementBlocked
        ? `Os lançamentos ultrapassam o direito calculado de ${entitledDays} dias.`
        : `${allocatedDays} de ${entitledDays} dias alocados no ciclo.`,
    blocking: entitlementBlocked,
  });

  const concessiveReady = isIsoDate(input.acquisitionPeriodEnd) && isIsoDate(input.concessiveDeadline);
  const outsideConcessivePeriod = !isAllowance && validRange && concessiveReady
    ? input.startDate! <= input.acquisitionPeriodEnd! || input.endDate! > input.concessiveDeadline!
    : false;
  checks.push({
    code: 'concessive_period',
    label: 'Período concessivo',
    status: !concessiveReady ? 'blocked' : outsideConcessivePeriod ? 'blocked' : 'ok',
    message: !concessiveReady
      ? 'Não foi possível validar o período aquisitivo e concessivo.'
      : isAllowance
        ? 'Período aquisitivo validado para o abono.'
      : outsideConcessivePeriod
        ? 'O gozo informado está fora do período concessivo deste ciclo.'
        : 'O gozo está dentro do período concessivo.',
    blocking: !concessiveReady || outsideConcessivePeriod,
  });

  const allowanceRecords = cycleRecords.filter((record) => record.recordType === 'venda');
  const allowanceDays = allowanceRecords.reduce((total, record) => total + Number(record.days || 0), 0);
  const allowanceDeadline = isIsoDate(input.acquisitionPeriodEnd)
    ? shiftIsoDate(input.acquisitionPeriodEnd!, -15)
    : null;
  const allowanceRequested = allowanceRecords.length === 0
    || (allowanceDeadline !== null && allowanceRecords.every((record) => {
      const requestedAt = record.allowanceRequestedAt ?? input.allowanceRequestedAt;
      return isIsoDate(requestedAt) && requestedAt <= allowanceDeadline;
    }));
  const allowanceBlocked = allowanceDays > Math.floor(Math.max(0, entitledDays) / 3) || !allowanceRequested;
  checks.push({
    code: 'allowance_deadline',
    label: 'Abono pecuniário',
    status: allowanceBlocked ? 'blocked' : 'ok',
    message: allowanceDays === 0
      ? 'Nenhum abono registrado neste ciclo.'
      : !allowanceRequested
        ? 'A solicitação do abono foi registrada após o prazo legal.'
        : `Abono de ${allowanceDays} dias dentro do limite e do prazo informados.`,
    blocking: allowanceBlocked,
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
  compliance?: Omit<Parameters<typeof analyzeVacationScheduling>[0], 'startDate' | 'endDate' | 'asOfDate'>;
}): DPVacationWorkflow {
  const legal = analyzeVacationScheduling({ ...input, ...input.compliance });
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
      noticeReferenceAt: null,
      noticeCompliance: 'pending',
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
  if (record.workflow) return record.workflow;
  const fallback = createInitialVacationWorkflow({
    status: record.status,
    startDate: record.startDate,
    endDate: record.endDate,
    now,
    asOfDate,
  });
  return {
    ...fallback,
    legalAnalysis: {
      ...fallback.legalAnalysis,
      checks: fallback.legalAnalysis.checks.map((check) => (
        ['date_range', 'notice_lead_time'].includes(check.code)
          ? check
          : {
              ...check,
              status: 'manual_review' as const,
              message: 'A validação completa será executada no servidor ao aprovar o agendamento.',
              blocking: false,
            }
      )),
    },
  };
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
