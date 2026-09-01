import type {
  CltTerminationProcess,
  ProcessProjection,
  TerminationHealth,
  TerminationStep,
  TerminationStepId,
} from "./types";

const DAY_MS = 86_400_000;

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Data inválida.");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, amount: number) {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDateOnly(date);
}

export function calculateNoticeDates(communicationDate: string) {
  return {
    noticeStartDate: addCalendarDays(communicationDate, 1),
    contractEndDate: addCalendarDays(communicationDate, 30),
  };
}

export function calculateMaterialDeadline(
  contractEndDate: string,
  holidays: string[] = [],
) {
  let due = parseDateOnly(addCalendarDays(contractEndDate, 10));
  const holidaySet = new Set(holidays);
  while (
    due.getUTCDay() === 0 ||
    due.getUTCDay() === 6 ||
    holidaySet.has(formatDateOnly(due))
  ) {
    due = new Date(due.getTime() + DAY_MS);
  }
  return formatDateOnly(due);
}

const STEP_DEFINITIONS: Array<Pick<TerminationStep, "id" | "label" | "lane" | "owner" | "required">> = [
  { id: "request_validation_notice", label: "Pedido, identidade, validação e aviso-prévio", lane: "request", owner: "hr", required: true },
  { id: "uniform_return", label: "Devolução de uniformes", lane: "operational", owner: "manager", required: true },
  { id: "aso", label: "ASO demissional", lane: "aso", owner: "hr", required: true },
  { id: "accountant", label: "Processamento pela contabilidade", lane: "accountant", owner: "accountant", required: true },
  { id: "document_audit", label: "Auditoria documental", lane: "documents", owner: "hr", required: true },
  { id: "signatures", label: "Assinaturas finais", lane: "documents", owner: "employee", required: true },
  { id: "legal_obligations", label: "Pagamento e obrigações", lane: "closure", owner: "hr", required: true },
  { id: "access_revocation", label: "Bloqueio de acessos", lane: "operational", owner: "hr", required: true },
  { id: "operational", label: "Encerramento operacional", lane: "operational", owner: "manager", required: true },
  { id: "closure", label: "Fechamento do desligamento", lane: "closure", owner: "hr", required: true },
];

const EMPLOYEE_RESIGNATION_STEP_DEFINITIONS: Array<Pick<TerminationStep, "id" | "label" | "lane" | "owner" | "required">> = [
  { id: "request_received", label: "Pedido recebido", lane: "request", owner: "employee", required: true },
  { id: "letter_review", label: "Conferência da carta", lane: "request", owner: "hr", required: true },
  { id: "identity_signature", label: "Identidade e formalização", lane: "request", owner: "employee", required: true },
  { id: "notice_decision", label: "Aviso-prévio e datas", lane: "notice", owner: "hr", required: true },
  { id: "accountant", label: "Contabilidade", lane: "accountant", owner: "accountant", required: true },
  { id: "signatures", label: "Assinaturas rescisórias", lane: "documents", owner: "employee", required: true },
  { id: "termination_payment", label: "Pagamento da rescisão", lane: "payment", owner: "finance", required: true },
  { id: "employee_delivery", label: "Entrega final ao colaborador", lane: "delivery", owner: "hr", required: true },
  { id: "access_revocation", label: "Encerramentos internos e acessos", lane: "operational", owner: "hr", required: true },
  { id: "operational", label: "Encerramentos internos", lane: "operational", owner: "hr", required: true },
  { id: "closure", label: "Finalização total pelo RH", lane: "closure", owner: "hr", required: true },
  { id: "uniform_return", label: "Uniformes", lane: "operational", owner: "manager", required: false },
  { id: "aso", label: "ASO demissional", lane: "aso", owner: "hr", required: false },
];

const EMPLOYER_DISMISSAL_STEP_DEFINITIONS: Array<Pick<TerminationStep, "id" | "label" | "lane" | "owner" | "required">> = [
  { id: "request_validation_notice", label: "Definição e comunicação do desligamento", lane: "request", owner: "hr", required: true },
  { id: "accountant", label: "Contabilidade", lane: "accountant", owner: "accountant", required: true },
  { id: "document_audit", label: "Revisão dos documentos", lane: "documents", owner: "hr", required: true },
  { id: "signatures", label: "Assinaturas rescisórias", lane: "documents", owner: "employee", required: true },
  { id: "termination_payment", label: "Pagamento da rescisão", lane: "payment", owner: "finance", required: true },
  { id: "employee_delivery", label: "Conclusão com a colaboradora", lane: "delivery", owner: "hr", required: true },
  { id: "access_revocation", label: "Encerramento dos acessos", lane: "operational", owner: "hr", required: true },
  { id: "operational", label: "Encerramentos internos", lane: "operational", owner: "hr", required: true },
  { id: "closure", label: "Finalização total pelo RH", lane: "closure", owner: "hr", required: true },
  { id: "uniform_return", label: "Uniformes", lane: "operational", owner: "manager", required: false },
  { id: "aso", label: "ASO demissional", lane: "aso", owner: "hr", required: false },
];

const PJ_TERMINATION_STEP_DEFINITIONS: Array<Pick<TerminationStep, "id" | "label" | "lane" | "owner" | "required">> = [
  { id: "request_validation_notice", label: "Contrato de origem e condições do encerramento", lane: "request", owner: "hr", required: true },
  { id: "document_audit", label: "Geração e revisão do distrato", lane: "documents", owner: "hr", required: true },
  { id: "signatures", label: "Assinaturas do distrato", lane: "documents", owner: "employer", required: true },
  { id: "legal_obligations", label: "Nota fiscal e pagamento final", lane: "payment", owner: "finance", required: true },
  { id: "access_revocation", label: "Revogação de acessos", lane: "operational", owner: "hr", required: true },
  { id: "operational", label: "Devoluções e eliminação de dados", lane: "operational", owner: "hr", required: true },
  { id: "closure", label: "Fechamento do contrato PJ", lane: "closure", owner: "hr", required: true },
];

export function createInitialTerminationSteps(now: string): TerminationStep[] {
  return STEP_DEFINITIONS.map((step) => ({
    ...step,
    status: step.id === "request_validation_notice" ? "in_progress" : "pending",
    ...(step.id === "request_validation_notice" ? { startedAt: now } : {}),
  }));
}

export function createEmployeeResignationSteps(now: string): TerminationStep[] {
  return EMPLOYEE_RESIGNATION_STEP_DEFINITIONS.map((step) => ({
    ...step,
    status: step.id === "request_received"
      ? "completed"
      : ["letter_review", "uniform_return", "aso"].includes(step.id)
        ? "in_progress"
        : "pending",
    ...(step.id === "request_received" ? { startedAt: now, completedAt: now, completedBy: "employee" } : {}),
    ...(["letter_review", "uniform_return", "aso"].includes(step.id) ? { startedAt: now } : {}),
    ...(step.id === "uniform_return" ? { note: "Controle paralelo disponível desde o envio da carta." } : {}),
    ...(step.id === "aso" ? { note: "Controle paralelo disponível desde o envio da carta." } : {}),
  }));
}

export function createEmployerDismissalSteps(now: string, contractEndDate: string, paymentDueDate: string): TerminationStep[] {
  const contractReached = now.slice(0, 10) >= contractEndDate;
  return EMPLOYER_DISMISSAL_STEP_DEFINITIONS.map((step) => {
    const parallel = step.id === "uniform_return" || step.id === "aso";
    const communication = step.id === "request_validation_notice";
    return {
      ...step,
      status: communication ? "waiting_external" : parallel ? "in_progress" : step.id === "accountant" ? "blocked" : step.id === "access_revocation" ? contractReached ? "in_progress" : "blocked" : "pending",
      ...((communication || parallel || (step.id === "access_revocation" && contractReached)) ? { startedAt: now } : {}),
      ...(["accountant", "document_audit", "signatures", "termination_payment", "aso"].includes(step.id) ? { dueAt: paymentDueDate } : {}),
      ...(step.id === "uniform_return" ? { dueAt: contractEndDate, note: "Controle paralelo disponível desde a confirmação da comunicação presencial." } : {}),
      ...(step.id === "aso" ? { note: "Controle paralelo disponível desde a confirmação da comunicação presencial." } : {}),
      ...(communication ? { note: "Comunicação presencial registrada. Aguardando assinatura do comunicado oficial." } : {}),
      ...(step.id === "accountant" ? { blockedReason: "Aguardando assinatura do comunicado ou formalização da recusa." } : {}),
      ...(step.id === "access_revocation" ? { dueAt: contractEndDate, blockedReason: contractReached ? null : `Aguardando o término do contrato em ${contractEndDate}.` } : {}),
    } as TerminationStep;
  });
}

export function createPjTerminationSteps(now: string, terminationDate: string, actorId = "hr"): TerminationStep[] {
  const contractReached = now.slice(0, 10) >= terminationDate;
  return PJ_TERMINATION_STEP_DEFINITIONS.map((step) => ({
    ...step,
    status: step.id === "request_validation_notice"
      ? "completed"
      : step.id === "document_audit" || step.id === "legal_obligations" || step.id === "operational"
        ? "in_progress"
        : step.id === "access_revocation"
          ? contractReached ? "in_progress" : "blocked"
          : "pending",
    ...(step.id === "request_validation_notice" ? { startedAt: now, completedAt: now, completedBy: actorId } : {}),
    ...(["document_audit", "legal_obligations", "operational"].includes(step.id) ? { startedAt: now } : {}),
    ...(step.id === "access_revocation" ? {
      dueAt: terminationDate,
      ...(contractReached ? { startedAt: now } : { blockedReason: `Aguardando o encerramento do contrato em ${terminationDate}.` }),
    } : {}),
    ...(step.id === "document_audit" ? { note: "Preencha os dados financeiros, gere e revise o distrato." } : {}),
    ...(step.id === "legal_obligations" ? { note: "A nota fiscal e o pagamento precisam estar confirmados antes da geração final." } : {}),
    ...(step.id === "operational" ? { note: "Confirme a devolução de materiais e a eliminação dos dados após a assinatura." } : {}),
  })) as TerminationStep[];
}

function unifyRequestValidationNotice(
  process: Pick<CltTerminationProcess, "processType" | "steps" | "notice" | "createdAt" | "dismissalCommunication">,
) {
  if (process.processType === "pj_contract_termination") return process.steps;
  if (process.steps.some((step) => step.id === "request_received")) return process.steps;
  if (process.dismissalCommunication) return process.steps;
  const legacyIds = new Set<TerminationStepId>([
    "employee_request",
    "identity_signature",
    "hr_validation",
    "notice_decision",
  ]);
  const current = process.steps.find((step) => step.id === "request_validation_notice");
  const legacy = process.steps.filter((step) => legacyIds.has(step.id));
  const startedAt = [current?.startedAt, ...legacy.map((step) => step.startedAt)]
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? process.createdAt;
  const completedAt = process.notice?.decidedAt ?? current?.completedAt ?? null;
  const unified: TerminationStep = {
    id: "request_validation_notice",
    label: "Pedido, identidade, validação e aviso-prévio",
    lane: "request",
    owner: "hr",
    required: true,
    status: process.notice ? "completed" : "in_progress",
    startedAt,
    completedAt,
    completedBy: process.notice?.decidedBy ?? current?.completedBy ?? null,
  };
  const remaining = process.steps.filter(
    (step) => step.id !== "request_validation_notice" && !legacyIds.has(step.id),
  );
  return [unified, ...remaining];
}

export function patchStep(
  steps: TerminationStep[],
  stepId: TerminationStepId,
  patch: Partial<TerminationStep>,
) {
  return steps.map((step) => step.id === stepId ? { ...step, ...patch } : step);
}

export function calculateTerminationProgress(steps: TerminationStep[]) {
  const required = steps.filter((step) => step.required && step.status !== "cancelled");
  if (!required.length) return 0;
  const completed = required.filter((step) => step.status === "completed" || step.status === "waived").length;
  return Math.round((completed / required.length) * 100);
}

export function calculateTerminationHealth(
  process: Pick<CltTerminationProcess, "status" | "steps" | "lastActivityAt">,
  now = new Date(),
): TerminationHealth {
  if (process.status === "completed") return "completed";
  if (process.status === "cancelled") return "cancelled";
  const hasOperationalBlock = process.steps.some((step) => {
    if (step.status !== "blocked") return false;
    const expectedAccountantDependency = step.id === "accountant" && step.blockedReason?.startsWith("Aguardando ");
    return !expectedAccountantDependency;
  });
  if (hasOperationalBlock) return "blocked";
  const today = now.toISOString().slice(0, 10);
  const openDueDates = process.steps
    .filter((step) => !["completed", "waived", "cancelled"].includes(step.status) && step.dueAt)
    .map((step) => step.dueAt!.slice(0, 10));
  if (openDueDates.some((due) => due < today)) return "overdue";
  const attentionLimit = new Date(now.getTime() + 2 * DAY_MS).toISOString().slice(0, 10);
  if (openDueDates.some((due) => due <= attentionLimit)) return "attention";
  if (now.getTime() - new Date(process.lastActivityAt).getTime() > 3 * DAY_MS) return "attention";
  return "on_track";
}

export function summarizeTermination(steps: TerminationStep[]) {
  const active = steps.filter((step) => step.required && ["in_progress", "waiting_external", "blocked"].includes(step.status));
  if (active.length) return active.slice(0, 3).map((step) => step.label).join(" · ");
  return steps.find((step) => step.required && step.status === "pending")?.label ?? "Aguardando fechamento";
}

export function applyAccountantReadiness<T extends CltTerminationProcess>(process: T, now = new Date().toISOString()): T {
  const accountantStep = process.steps.find((step) => step.id === "accountant");
  if (!accountantStep || ["completed", "waived", "cancelled", "waiting_external"].includes(accountantStep.status)) return process;

  const noticeReady = Boolean(process.notice);
  const employeeResignation = process.processType === "clt_employee_resignation";
  const guidedEmployerDismissal = process.processType === "clt_hr_termination"
    && process.terminationReason === "Dispensa sem justa causa"
    && Boolean(process.dismissalCommunication);
  const dismissalCommunicationFormalized = ["signed", "refusal_formalized"].includes(
    process.dismissalCommunication?.officialNoticeStatus ?? "",
  );
  const asoReady = process.steps.some((step) => step.id === "aso" && step.status === "completed")
    || ["approved", "completed"].includes(String(process.asoWorkflow?.status ?? ""));
  const ready = noticeReady && (employeeResignation || (guidedEmployerDismissal && dismissalCommunicationFormalized) || (!guidedEmployerDismissal && asoReady));
  const progressedAccountant = ["sent", "documents_received", "correction_requested", "approved"].includes(process.accountant?.status ?? "");
  if (progressedAccountant) return process;

  const blockedReason = guidedEmployerDismissal && !dismissalCommunicationFormalized
    ? "Aguardando assinatura do comunicado ou formalização da recusa."
    : !noticeReady && !asoReady && !employeeResignation
    ? "Aguardando definição do aviso-prévio e conclusão do ASO."
    : !noticeReady
      ? "Aguardando definição do aviso-prévio."
      : "Aguardando conclusão e aprovação do ASO demissional.";
  const steps = patchStep(process.steps, "accountant", ready ? {
    status: "in_progress",
    startedAt: accountantStep.startedAt ?? now,
    blockedReason: null,
    note: employeeResignation
      ? "Aviso-prévio definido. Envio à contabilidade liberado."
      : guidedEmployerDismissal
        ? "Comunicado formalizado. Envio à contabilidade liberado; ASO e uniformes seguem em paralelo."
        : "Aviso-prévio definido e ASO aprovado. Envio à contabilidade liberado.",
  } : {
    status: "blocked",
    blockedReason,
    note: blockedReason,
  });

  return {
    ...process,
    steps,
    accountant: ready
      ? { ...(process.accountant ?? { status: "not_started" }), status: "ready_to_send" }
      : { ...(process.accountant ?? { status: "not_started" }), status: "not_started" },
  };
}

export function recalculateTermination<T extends CltTerminationProcess>(process: T, now = new Date()): T {
  const legacyPjSteps = process.processType === "pj_contract_termination"
    && !["completed", "cancelled"].includes(process.status)
    && process.steps.some((step) => ["aso", "uniform_return", "accountant"].includes(step.id));
  const normalizedPjSteps = legacyPjSteps
    ? createPjTerminationSteps(process.createdAt, process.notice?.contractEndDate ?? now.toISOString().slice(0, 10)).map((step) => {
      if (!["access_revocation", "operational", "closure"].includes(step.id)) return step;
      const previous = process.steps.find((candidate) => candidate.id === step.id);
      return previous ? { ...step, status: previous.status, startedAt: previous.startedAt, completedAt: previous.completedAt, completedBy: previous.completedBy, blockedReason: previous.blockedReason, note: previous.note ?? step.note } : step;
    })
    : process.steps;
  const unifiedSteps = unifyRequestValidationNotice({ ...process, steps: normalizedPjSteps });
  const hasAccessStep = unifiedSteps.some((step) => step.id === "access_revocation");
  let steps = hasAccessStep
    ? unifiedSteps
    : unifiedSteps.flatMap((step) => step.id === "closure"
      ? [{ id: "access_revocation", label: "Bloqueio de acessos", lane: "operational", owner: "hr", required: true, status: "pending" } as TerminationStep, step]
      : [step]);
  if (process.processType !== "pj_contract_termination" && !steps.some((step) => step.id === "uniform_return")) {
    const uniformStep: TerminationStep = {
      id: "uniform_return",
      label: "Devolução de uniformes",
      lane: "operational",
      owner: "manager",
      required: true,
      status: process.operational?.uniformsReturned
        ? "completed"
        : process.status === "completed"
          ? "waived"
          : "in_progress",
      ...(process.operational?.uniformsReturned ? { completedAt: process.updatedAt } : {}),
    };
    steps = steps.flatMap((step) => step.id === "request_validation_notice" ? [step, uniformStep] : [step]);
  }
  if (process.notice?.contractEndDate && now.toISOString().slice(0, 10) >= process.notice.contractEndDate) {
    steps = patchStep(steps, "access_revocation", {
      status: steps.find((step) => step.id === "access_revocation")?.status === "blocked" ? "in_progress" : steps.find((step) => step.id === "access_revocation")?.status,
      blockedReason: null,
      startedAt: steps.find((step) => step.id === "access_revocation")?.startedAt ?? now.toISOString(),
    });
  }
  const accessRevocation = process.accessRevocation ?? {
    pdv: { status: "pending" as const },
    bizneo: { status: "pending" as const },
    healthPlan: { status: "pending" as const },
    coalaOne: { status: "scheduled" as const },
  };
  let normalizedProcess = { ...process, steps, accessRevocation } as T;
  const guidedEmployeeFlow = process.processType === "clt_employee_resignation" && steps.some((step) => step.id === "request_received");
  const guidedEmployerFlow = process.processType === "clt_hr_termination"
    && process.terminationReason === "Dispensa sem justa causa"
    && Boolean(process.dismissalCommunication)
    && steps.some((step) => step.id === "termination_payment");
  if (guidedEmployeeFlow || guidedEmployerFlow) {
    const paymentStatus = process.payment?.status ?? "not_started";
    if (paymentStatus === "paid") {
      steps = patchStep(steps, "termination_payment", { status: "completed", completedAt: process.payment?.paidAt ?? now.toISOString(), completedBy: "system:inter", blockedReason: null, note: "Pagamento confirmado e comprovante disponível." });
    } else if (paymentStatus === "not_applicable") {
      steps = patchStep(steps, "termination_payment", { status: "waived", completedAt: process.accountant?.approvedAt ?? now.toISOString(), completedBy: process.accountant?.approvedBy ?? "system", blockedReason: null, note: "Sem valor líquido a pagar." });
    } else if (["awaiting_financial_authorization", "ready_to_submit", "submitting", "awaiting_bank_approval", "scheduled", "processing"].includes(paymentStatus)) {
      steps = patchStep(steps, "termination_payment", { status: "waiting_external", startedAt: process.payment?.createdAt ?? now.toISOString(), dueAt: process.payment?.dueAt ?? null, blockedReason: null });
    } else if (["configuration_required", "failed", "rejected", "approval_expired"].includes(paymentStatus)) {
      steps = patchStep(steps, "termination_payment", { status: "blocked", dueAt: process.payment?.dueAt ?? null, blockedReason: process.payment?.lastError ?? "O pagamento precisa de atenção." });
    }
    const signaturesDone = ["completed", "waived"].includes(steps.find((step) => step.id === "signatures")?.status ?? "");
    const paymentDone = ["completed", "waived"].includes(steps.find((step) => step.id === "termination_payment")?.status ?? "");
    if (signaturesDone && paymentDone && !["sent", "completed"].includes(process.employeeCompletion?.status ?? "")) {
      steps = patchStep(steps, "employee_delivery", { status: "in_progress", startedAt: now.toISOString(), blockedReason: null, note: "Assinaturas e pagamento concluídos. Pacote final pronto para envio." });
      normalizedProcess = { ...normalizedProcess, employeeCompletion: { ...(process.employeeCompletion ?? { status: "not_started" }), status: "ready" } } as T;
    }
    if (["sent", "completed"].includes(process.employeeCompletion?.status ?? "")) {
      steps = patchStep(steps, "employee_delivery", { status: "completed", completedAt: process.employeeCompletion?.completedAt ?? process.employeeCompletion?.sentAt ?? now.toISOString(), completedBy: "system:email", note: "Pacote final disponibilizado ao colaborador." });
      if (steps.find((step) => step.id === "operational")?.status === "pending") {
        steps = patchStep(steps, "operational", { status: "in_progress", startedAt: now.toISOString(), note: "Desligamento concluído com o colaborador. Finalize os controles internos." });
      }
    }
    const asoStatus = String(process.asoWorkflow?.status ?? "");
    if (["approved", "completed"].includes(asoStatus)) {
      steps = patchStep(steps, "aso", { status: "completed", completedAt: String(process.asoWorkflow?.reviewedAt ?? now.toISOString()), completedBy: String(process.asoWorkflow?.reviewedBy ?? "system"), blockedReason: null, note: "ASO demissional aprovado." });
    }
    normalizedProcess = { ...normalizedProcess, steps } as T;
  }
  const readyProcess = applyAccountantReadiness(normalizedProcess, now.toISOString());
  const progress = calculateTerminationProgress(readyProcess.steps);
  const health = calculateTerminationHealth(readyProcess, now);
  const nextDueAt = readyProcess.steps
    .filter((step) => !["completed", "waived", "cancelled"].includes(step.status) && step.dueAt)
    .map((step) => step.dueAt!)
    .sort()[0] ?? null;
  return { ...readyProcess, progress, health, nextDueAt, currentSummary: summarizeTermination(readyProcess.steps) };
}

export function buildProcessProjection(process: CltTerminationProcess, version: number, syncedAt: string): ProcessProjection {
  const title = process.processType === "pj_contract_termination"
    ? `Encerramento PJ — ${process.employeeName}`
    : process.source === "hr_manual"
    ? `Desligamento — ${process.employeeName}`
    : `Pedido de demissão — ${process.employeeName}`;
  return {
    id: `termination:${process.id}`,
    sourceType: "termination",
    sourceDatabase: "coala-rh",
    sourceCollection: "terminationProcesses",
    sourceId: process.id,
    module: "dp",
    type: process.processType,
    title,
    subjectId: process.employeeId,
    subjectName: process.employeeName,
    employerEntityId: process.employer?.entityId ?? null,
    employerName: process.employer?.legalName ?? null,
    employerCnpj: process.employer?.cnpj ?? null,
    status: process.status,
    health: process.health,
    progress: process.progress,
    currentSummary: process.currentSummary,
    nextDueAt: process.nextDueAt ?? null,
    lastActivityAt: process.lastActivityAt,
    href: `/dashboard/dp/terminations/${process.id}`,
    version,
    sourceUpdatedAt: process.updatedAt,
    syncedAt,
    visibleToUserIds: [process.employeeId],
    visibleToPermission: "dp.view",
  };
}
