import type { FieldMapEntry, FieldVisibility } from "@/types/rh";
import { normalizeFieldVisibility } from "@/types/rh";

export const SYSTEM_FIELD_KEYS = {
  registrationBizneo: "system.documents.registration_bizneo",
  registrationPdv: "system.documents.registration_pdv",
  loginBizneo: "system.access.login_bizneo",
  loginPdv: "system.access.login_pdv",
  loginCoalaOne: "system.access.login_coala_one",
  accessProfile: "system.documents.access_profile",
  jobRole: "system.role.job_role",
  /** Legado: sem tela desde 10/2026; mantido porque o contrato de variáveis `coala-documents-v2` ainda o lista. */
  operational: "system.role.operational",
  /** Legado: idem; metas valem para qualquer pessoa ativa. */
  goals: "system.role.goals",
  functions: "system.role.functions",
  shift: "system.schedule.shift",
  units: "system.schedule.units",
  uniforms: "system.uniforms.summary",
  vacations: "system.vacations.summary",
  asoSummary: "system.aso.summary",
  familySalarySummary: "system.family_salary.summary",
  transportVoucher: "system.transport_voucher.enabled",
  behaviorOperational: "system.behavior.operational",
  behaviorGoals: "system.behavior.goals",
} as const;

export const SYSTEM_NAV_LINKS = [
  { id: "system.schedule_units", label: "Escala e unidades" },
  { id: "system.uniforms", label: "Uniformes" },
  { id: "system.vacations", label: "Férias" },
  { id: "system.aso_control", label: "Controle de ASOs" },
  { id: "system.family_salary", label: "Salário-família" },
  { id: "system.transport_voucher", label: "Vale-transporte" },
  { id: "system.behavior", label: "Comportamento no sistema" },
] as const;

export const ASO_PROFILE_FIELD_KEYS = [
  "employee.aso_admission_date",
  "employee.aso_dismissal_date",
  "employee.aso_periodic_1",
  "employee.aso_periodic_2",
] as const;

export const FAMILY_SALARY_PROFILE_FIELD_KEYS = [
  "employee.children_under_14",
  "employee.children",
  "employee.dependent_name",
  "employee.dependent_relation",
  "employee.dependent_cpf",
  "employee.dependent_rg",
  "employee.has_family_salary",
  "employee.family_salary_end_1",
  "employee.family_salary_birth_1",
  "employee.family_salary_name_1",
] as const;

export const SYSTEM_PANEL_PROFILE_FIELD_KEYS = new Set<string>([
  ...ASO_PROFILE_FIELD_KEYS,
  ...FAMILY_SALARY_PROFILE_FIELD_KEYS,
]);

export const SYSTEM_BLOCK_KEYS = {
  schedule: [SYSTEM_FIELD_KEYS.shift, SYSTEM_FIELD_KEYS.units],
  uniforms: [SYSTEM_FIELD_KEYS.uniforms],
  vacations: [SYSTEM_FIELD_KEYS.vacations],
  asoControl: [SYSTEM_FIELD_KEYS.asoSummary],
  familySalary: [
    SYSTEM_FIELD_KEYS.familySalarySummary,
    "employee.children_under_14",
    "employee.children",
    "employee.has_family_salary",
  ],
  transportVoucher: [SYSTEM_FIELD_KEYS.transportVoucher],
  behavior: [SYSTEM_FIELD_KEYS.behaviorOperational, SYSTEM_FIELD_KEYS.behaviorGoals],
} as const;

export const SYSTEM_BLOCK_FIELD_KEYS_BY_ID: Record<string, readonly string[]> = {
  "system.schedule_units": SYSTEM_BLOCK_KEYS.schedule,
  "system.uniforms": SYSTEM_BLOCK_KEYS.uniforms,
  "system.vacations": SYSTEM_BLOCK_KEYS.vacations,
  "system.aso_control": SYSTEM_BLOCK_KEYS.asoControl,
  "system.family_salary": SYSTEM_BLOCK_KEYS.familySalary,
  "system.transport_voucher": SYSTEM_BLOCK_KEYS.transportVoucher,
  "system.behavior": SYSTEM_BLOCK_KEYS.behavior,
};

export function systemFieldsRepresentedByProfileBlocks(blockIds: Iterable<string>) {
  const fieldKeys = new Set<string>();
  for (const blockId of blockIds) {
    for (const fieldKey of SYSTEM_BLOCK_FIELD_KEYS_BY_ID[blockId] ?? []) fieldKeys.add(fieldKey);
  }
  return fieldKeys;
}

export function defaultFieldLgpd(section: string, visibility: FieldVisibility): NonNullable<FieldMapEntry["lgpd"]> {
  const sensitiveSection = /aso|saúde|saude|divers|biometri|racial|etni|religi|sindic|sexual|gen[eé]tic/i.test(section);
  const normalized = normalizeFieldVisibility(visibility);
  return {
    category: sensitiveSection ? "sensitive" : "personal",
    legal_basis: "legal_obligation",
    retention: normalized === "public" ? "termination_plus_2y" : "employment_plus_5y",
    requires_consent: false,
  };
}

export function systemField(label: string, section: string, order: number, visibility: FieldVisibility): FieldMapEntry {
  return {
    bizneo_id: "coala_internal",
    label,
    section,
    type: "text",
    visibility,
    employee_visible: false,
    employee_editable: false,
    order,
    lgpd: defaultFieldLgpd(section, visibility),
  };
}

export const SYSTEM_FIELD_DEFAULTS: Record<string, FieldMapEntry> = {
  [SYSTEM_FIELD_KEYS.registrationBizneo]: systemField("Matrícula Bizneo", "Sistemas", 20, "restricted_partial"),
  [SYSTEM_FIELD_KEYS.registrationPdv]: systemField("Matrícula PDV", "Sistemas", 50, "restricted_partial"),
  [SYSTEM_FIELD_KEYS.loginBizneo]: systemField("Login do Bizneo", "Sistemas", 10, "restricted_partial"),
  [SYSTEM_FIELD_KEYS.loginPdv]: systemField("Nome de usuário do PDV", "Sistemas", 40, "restricted_partial"),
  [SYSTEM_FIELD_KEYS.loginCoalaOne]: systemField("Login do Coala One", "Sistemas", 70, "restricted_partial"),
  [SYSTEM_FIELD_KEYS.accessProfile]: systemField("Perfil de acesso do PDV Legal", "Sistemas", 60, "restricted_partial"),
  [SYSTEM_FIELD_KEYS.jobRole]: systemField("Cargo", "Dados contratuais", 30, "public"),
  [SYSTEM_FIELD_KEYS.operational]: systemField("Operacional", "Sistemas", 90, "restricted_partial"),
  [SYSTEM_FIELD_KEYS.goals]: systemField("Metas", "Sistemas", 100, "restricted_partial"),
  [SYSTEM_FIELD_KEYS.functions]: systemField("Funções", "Sistemas", 110, "restricted_partial"),
  [SYSTEM_FIELD_KEYS.shift]: systemField("Escala", "Escala e unidades", 10, "public"),
  [SYSTEM_FIELD_KEYS.units]: systemField("Unidades", "Escala e unidades", 20, "public"),
  [SYSTEM_FIELD_KEYS.uniforms]: systemField("Uniformes", "Uniformes", 10, "restricted_total"),
  [SYSTEM_FIELD_KEYS.vacations]: systemField("Férias", "Férias", 10, "restricted_partial"),
  [SYSTEM_FIELD_KEYS.asoSummary]: systemField("Resumo de ASOs", "Controle de ASOs", 10, "confidential"),
  [SYSTEM_FIELD_KEYS.familySalarySummary]: systemField("Resumo do salário-família", "Salário-família", 10, "restricted_partial"),
  [SYSTEM_FIELD_KEYS.transportVoucher]: systemField("Vale-transporte", "Vale-transporte", 10, "restricted_partial"),
  [SYSTEM_FIELD_KEYS.behaviorOperational]: systemField("Usuário operacional", "Comportamento no sistema", 10, "restricted_total"),
  [SYSTEM_FIELD_KEYS.behaviorGoals]: systemField("Participa de metas", "Comportamento no sistema", 20, "restricted_total"),
};

export function isSystemStaticField(key: string) {
  return key.startsWith("system.") || Object.prototype.hasOwnProperty.call(SYSTEM_FIELD_DEFAULTS, key);
}

export function isSystemPanelProfileField(key: string) {
  return SYSTEM_PANEL_PROFILE_FIELD_KEYS.has(key);
}
