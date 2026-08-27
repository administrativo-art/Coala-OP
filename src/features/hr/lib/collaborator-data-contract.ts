import type { User } from "@/types";

export const COLLABORATOR_DATA_CONTRACT_VERSION = 1 as const;

/** One registry for the source of truth and derived projections shown in the profile. */
export const COLLABORATOR_DATA_CONTRACT = {
  transportVoucher: {
    canonicalSource: "coala.users.transportVoucherHistory",
    currentState: ["coala.users.needsTransportVoucher", "coala.users.transportVoucherValue"],
    projections: ["coala-rh.employees.field_values.employee.has_vt", "coala-rh.employees.field_values.employee.vt_daily_value"],
    documents: ["TRANSPORT_REQUEST", "TRANSPORT_BENEFIT_TERM"],
  },
  aso: {
    canonicalSource: "coala-rh.employees.field_values.system.aso.summary",
    projections: ["employee.aso_admission_date", "employee.aso_periodic_1", "employee.aso_periodic_2", "employee.aso_dismissal_date"],
    documents: ["ASO_ADMISSION", "ASO_PERIODIC", "ASO_RETURN", "ASO_RISK_CHANGE", "ASO_DISMISSAL"],
  },
  probation: {
    canonicalSource: "validated PROBATION_CONTRACT/PROBATION_EXTENSION document",
    projections: ["employee.admission_date", "employee.probation_eval_1", "employee.probation_eval_2"],
    documents: ["PROBATION_CONTRACT", "PROBATION_EXTENSION"],
  },
  familySalary: {
    canonicalSource: "coala-rh.employees.field_values.system.family_salary.summary",
    projections: ["employee.children", "employee.children_under_14", "employee.has_family_salary"],
    documents: ["DEPENDENT_DOCUMENT", "BIRTH_CERTIFICATE", "VACCINATION_RECORD", "SCHOOL_ATTENDANCE", "RESPONSIBILITY_TERM"],
  },
  privacy: {
    canonicalSource: "coala-rh.employees.ciencia_privacidade_onboarding",
    projections: [],
    documents: ["LGPD_TERM"],
  },
  imageVoiceConsent: {
    canonicalSource: "coala-rh.employees.consentimentos_imagem_voz_historico",
    currentState: ["coala-rh.employees.consentimento_imagem_voz"],
    projections: [],
    documents: ["IMAGE_VOICE_CONSENT"],
  },
} as const;

type VoucherHistory = NonNullable<User["transportVoucherHistory"]>;

export function initialTransportVoucherHistory(input: {
  active: boolean;
  value?: number | null;
  effectiveDate: string;
  actor: { userId: string; username: string };
  existing?: User["transportVoucherHistory"];
}): VoucherHistory {
  if (input.existing?.length || !input.active) return input.existing ?? [];
  return [{
    id: `vt-initial-${input.effectiveDate}-${input.actor.userId}`,
    fromStatus: "none",
    toStatus: "active",
    effectiveDate: input.effectiveDate,
    reason: "Configuração inicial do vale-transporte.",
    ...(input.value != null ? { value: input.value } : {}),
    changedAt: new Date().toISOString(),
    changedBy: input.actor,
  }];
}
