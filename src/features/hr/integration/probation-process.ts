import { addCalendarDays, buildProbationSchedule, DEFAULT_PROBATION_CONFIG, type ProbationConfig, type ProbationSchedule } from "./probation";

export type ProbationRuntimeConfig = ProbationConfig & {
  alertsBeforeDays: number[];
  extensionTermRequired: boolean;
  extensionDocumentTemplateId?: string;
  evaluator: { strategy: string; referenceId?: string; fallback?: string };
  effectivenessRule: "manual" | "approved_evaluations" | "automatic_at_end";
  evaluationFormId?: string;
};
export type ProbationEvaluation = { id: "first" | "second"; label: string; windowStartDate: string; windowEndDate: string; status: "scheduled" | "available" | "overdue" | "completed"; completedAt: string | null; completedBy: string | null; result: "approved" | "rejected" | "review" | null; notes: string | null };
export type ProbationProcessState = { status: "awaiting_admission" | "active" | "decision_pending" | "effective" | "terminated"; admissionDate: string | null; config: ProbationRuntimeConfig; schedule: ProbationSchedule | null; evaluations: ProbationEvaluation[]; alerts: Array<{ id: string; evaluationId: string; dueDate: string; status: "scheduled" | "due" | "sent"; sentAt: string | null }>; extensionTerm: { required: boolean; generatedDocumentId: string | null; signedAt: string | null }; decision: { result: "effective" | "terminated" | null; decidedAt: string | null; decidedBy: string | null; notes: string | null }; updatedAt: string };

export const DEFAULT_PROBATION_RUNTIME_CONFIG: ProbationRuntimeConfig = { ...DEFAULT_PROBATION_CONFIG, alertsBeforeDays: [10, 5, 1], extensionTermRequired: false, evaluator: { strategy: "direct_manager", fallback: "hr_pool" }, effectivenessRule: "manual" };

export function probationIsReleasedAfterFormalization(process: {
  status?: string | null;
  currentStage?: string | null;
  completedAt?: string | null;
  formalizationCompletedAt?: string | null;
}) {
  if (process.status === "cancelled") return false;
  return process.status === "completed"
    || process.currentStage === "done"
    || Boolean(process.completedAt)
    || Boolean(process.formalizationCompletedAt);
}

export function createProbationProcess(admissionDate: string | null, input: Partial<ProbationRuntimeConfig> | undefined, now: string): ProbationProcessState {
  const config: ProbationRuntimeConfig = { ...DEFAULT_PROBATION_RUNTIME_CONFIG, ...input, extensionTermRequired: false, evaluator: { ...DEFAULT_PROBATION_RUNTIME_CONFIG.evaluator, ...(input?.evaluator ?? {}) }, alertsBeforeDays: Array.from(new Set(input?.alertsBeforeDays ?? DEFAULT_PROBATION_RUNTIME_CONFIG.alertsBeforeDays)).sort((a, b) => b - a) };
  if (!admissionDate) return { status: "awaiting_admission", admissionDate: null, config, schedule: null, evaluations: [], alerts: [], extensionTerm: { required: config.extensionTermRequired && config.secondPeriodDays > 0, generatedDocumentId: null, signedAt: null }, decision: { result: null, decidedAt: null, decidedBy: null, notes: null }, updatedAt: now };
  const schedule = buildProbationSchedule(admissionDate, config);
  const periods = [{ id: "first" as const, label: "Avaliação do primeiro período", period: schedule.firstPeriod }, ...(schedule.secondPeriod ? [{ id: "second" as const, label: "Avaliação da prorrogação", period: schedule.secondPeriod }] : [])];
  const evaluations: ProbationEvaluation[] = periods.map(({ id, label, period }) => ({ id, label, windowStartDate: period.evaluationStartDate, windowEndDate: period.evaluationEndDate, status: "scheduled", completedAt: null, completedBy: null, result: null, notes: null }));
  const alerts = periods.flatMap(({ id, period }) => config.alertsBeforeDays.map((days) => ({ id: `${id}_${days}`, evaluationId: id, dueDate: addCalendarDays(period.evaluationEndDate, -days), status: "scheduled" as const, sentAt: null })));
  return refreshProbationProcess({ status: "active", admissionDate, config, schedule, evaluations, alerts, extensionTerm: { required: config.extensionTermRequired && config.secondPeriodDays > 0, generatedDocumentId: null, signedAt: null }, decision: { result: null, decidedAt: null, decidedBy: null, notes: null }, updatedAt: now }, now.slice(0, 10));
}

export function refreshProbationProcess(state: ProbationProcessState, today: string): ProbationProcessState {
  const normalizedState: ProbationProcessState = {
    ...state,
    config: { ...state.config, extensionTermRequired: false },
    extensionTerm: { ...state.extensionTerm, required: false },
  };
  if (!normalizedState.schedule || normalizedState.status === "effective" || normalizedState.status === "terminated") return normalizedState;
  const evaluations = normalizedState.evaluations.map((evaluation) => evaluation.status === "completed" ? evaluation : { ...evaluation, status: today < evaluation.windowStartDate ? "scheduled" as const : today <= evaluation.windowEndDate ? "available" as const : "overdue" as const });
  const alerts = normalizedState.alerts.map((alert) => alert.status === "sent" ? alert : { ...alert, status: today >= alert.dueDate ? "due" as const : "scheduled" as const });
  const allCompleted = evaluations.length > 0 && evaluations.every((evaluation) => evaluation.status === "completed");
  let status: ProbationProcessState["status"] = normalizedState.status;
  if (allCompleted || today > normalizedState.schedule.finalEndDate) status = "decision_pending";
  if (normalizedState.config.effectivenessRule === "approved_evaluations" && allCompleted && evaluations.every((evaluation) => evaluation.result === "approved")) status = "effective";
  if (normalizedState.config.effectivenessRule === "automatic_at_end" && today > normalizedState.schedule.finalEndDate) status = "effective";
  return { ...normalizedState, status, evaluations, alerts };
}

export function completeProbationEvaluation(state: ProbationProcessState, params: { evaluationId: "first" | "second"; result: "approved" | "rejected" | "review"; notes?: string; actorId: string; now: string }) {
  const current = refreshProbationProcess(state, params.now.slice(0, 10));
  const evaluation = current.evaluations.find((item) => item.id === params.evaluationId);
  if (!evaluation) throw new Error("Avaliação não encontrada.");
  if (evaluation.status === "scheduled") throw new Error(`A avaliação estará disponível em ${evaluation.windowStartDate}.`);
  return refreshProbationProcess({ ...current, evaluations: current.evaluations.map((item) => item.id === params.evaluationId ? { ...item, status: "completed", completedAt: params.now, completedBy: params.actorId, result: params.result, notes: params.notes?.trim() || null } : item), updatedAt: params.now }, params.now.slice(0, 10));
}

export function decideProbation(state: ProbationProcessState, params: { result: "effective" | "terminated"; notes?: string; actorId: string; now: string }) {
  return { ...state, status: params.result, decision: { result: params.result, decidedAt: params.now, decidedBy: params.actorId, notes: params.notes?.trim() || null }, updatedAt: params.now };
}
