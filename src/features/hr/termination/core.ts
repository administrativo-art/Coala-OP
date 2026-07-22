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
  { id: "employee_request", label: "Pedido e carta", lane: "request", owner: "employee", required: true },
  { id: "identity_signature", label: "Confirmação de identidade", lane: "request", owner: "employee", required: true },
  { id: "hr_validation", label: "Validação da manifestação", lane: "request", owner: "hr", required: true },
  { id: "notice_decision", label: "Definição do aviso-prévio", lane: "notice", owner: "employer", required: true },
  { id: "aso", label: "ASO demissional", lane: "aso", owner: "hr", required: true },
  { id: "accountant", label: "Processamento pela contabilidade", lane: "accountant", owner: "accountant", required: true },
  { id: "document_audit", label: "Auditoria documental", lane: "documents", owner: "hr", required: true },
  { id: "signatures", label: "Assinaturas finais", lane: "documents", owner: "employee", required: true },
  { id: "legal_obligations", label: "Pagamento e obrigações", lane: "closure", owner: "hr", required: true },
  { id: "operational", label: "Encerramento operacional", lane: "operational", owner: "manager", required: true },
  { id: "closure", label: "Fechamento do desligamento", lane: "closure", owner: "hr", required: true },
];

export function createInitialTerminationSteps(now: string): TerminationStep[] {
  return STEP_DEFINITIONS.map((step) => ({
    ...step,
    status: step.id === "employee_request" ? "completed" : step.id === "identity_signature" ? "in_progress" : "pending",
    ...(step.id === "employee_request" ? { startedAt: now, completedAt: now } : {}),
    ...(step.id === "identity_signature" ? { startedAt: now } : {}),
  }));
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
  if (process.steps.some((step) => step.status === "blocked")) return "blocked";
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
  const active = steps.filter((step) => ["in_progress", "waiting_external", "blocked"].includes(step.status));
  if (active.length) return active.slice(0, 3).map((step) => step.label).join(" · ");
  return steps.find((step) => step.status === "pending")?.label ?? "Aguardando fechamento";
}

export function recalculateTermination<T extends CltTerminationProcess>(process: T, now = new Date()): T {
  const progress = calculateTerminationProgress(process.steps);
  const health = calculateTerminationHealth(process, now);
  const nextDueAt = process.steps
    .filter((step) => !["completed", "waived", "cancelled"].includes(step.status) && step.dueAt)
    .map((step) => step.dueAt!)
    .sort()[0] ?? null;
  return { ...process, progress, health, nextDueAt, currentSummary: summarizeTermination(process.steps) };
}

export function buildProcessProjection(process: CltTerminationProcess, version: number, syncedAt: string): ProcessProjection {
  return {
    id: `termination:${process.id}`,
    sourceType: "termination",
    sourceDatabase: "coala-rh",
    sourceCollection: "terminationProcesses",
    sourceId: process.id,
    module: "dp",
    type: process.processType,
    title: `Pedido de demissão — ${process.employeeName}`,
    subjectId: process.employeeId,
    subjectName: process.employeeName,
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
