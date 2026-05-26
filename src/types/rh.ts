import { type Timestamp } from 'firebase/firestore';

// ─── Identificadores ────────────────────────────────────────────────────────
export type BizneoEmployeeId = string; // ex: "17006830"
export type AuthUid          = string; // ex: "abc123xyz" — Firebase Auth UID
export type CoalaKey         = string; // ex: "employee.vt_daily_value"
export type BizneoFieldId    = string; // ex: "cf_15642_vt_diario" | "PENDING_DISCOVERY"
export type JobRoleId        = string; // ref: coala-rh/jobRoles/{id}
export type KioskId          = string; // ref: coala/Kiosk/{id}

// ─── Enums ──────────────────────────────────────────────────────────────────
export type FieldVisibility = 'public' | 'sensitive' | 'internal';
export type RhRole          = 'employee' | 'manager' | 'admin';
export type EmployeeStatus  = 'active' | 'inactive' | 'terminated';
export type FieldType =
  | 'text'
  | 'multiline'
  | 'date'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'single_select'
  | 'multi_select'
  | 'autonumber'
  | 'ref:jobRoles';
export type FieldSource = 'bizneo_sync' | 'user_edit' | 'cf_automation';

// ─── Trigger / Validation config ────────────────────────────────────────────
export type TriggerConfig = {
  event: 'on_set' | 'on_change' | 'on_clear';
  action:
    | 'create_hr_task'
    | 'schedule_aso_alert'
    | 'initiate_offboarding'
    | 'propagate_uniform'
    | 'notify_salary_change';
  payload?: Record<string, unknown>;
};

export type ValidationRule =
  | { type: 'required' }
  | { type: 'min'; value: number }
  | { type: 'max'; value: number }
  | { type: 'past_date' }
  | { type: 'future_date' }
  | { type: 'unique'; scope: 'global' }
  | { type: 'regex'; pattern: string };

export type ConditionalRule =
  | { kind: 'show_if';    field: CoalaKey; operator: 'eq' | 'neq' | 'truthy'; value?: unknown }
  | { kind: 'required_if'; field: CoalaKey; operator: 'eq' | 'truthy'; value?: unknown };

// ─── FieldMap ───────────────────────────────────────────────────────────────
export type FieldMapEntry = {
  bizneo_id:         BizneoFieldId;
  type:              FieldType;
  visibility:        FieldVisibility;
  employee_visible:  boolean;
  employee_editable: boolean;
  required?:         boolean;
  help_text?:        string;
  options?:          string[];
  lgpd?: {
    category: 'personal' | 'sensitive' | 'confidential';
    legal_basis: 'legal_obligation' | 'contract' | 'legitimate_interest' | 'consent';
    retention: 'employment_plus_5y' | 'termination_plus_90d' | 'termination_plus_2y' | 'manual_review';
    requires_consent?: boolean;
  };
  triggers?:         TriggerConfig[];
  validation?:       ValidationRule[];
  conditionals?:     ConditionalRule[];
  section:           string;
  label:             string;
  order:             number;
};

export type FieldMap = {
  version: string;
  fields:  Record<CoalaKey, FieldMapEntry>;
};

// ─── Employee ───────────────────────────────────────────────────────────────
export type Employee = {
  bizneo_employee_id: BizneoEmployeeId;
  auth_uid?:          AuthUid;
  name:               string;
  email:              string;
  photo_url?:         string;
  status:             EmployeeStatus;
  job_role_id:        JobRoleId;
  unit_id:            KioskId;
  manager_id?:        BizneoEmployeeId;
  profile_completion: number;
  synced_at:          Timestamp;
  created_at:         Timestamp;
  expires_at?:        Timestamp;
};

// ─── FieldValue ─────────────────────────────────────────────────────────────
export type EmployeeFieldValue = {
  field_key:      CoalaKey;
  value_text?:    string;
  value_number?:  number;
  value_date?:    Timestamp;
  value_boolean?: boolean;
  value_json?:    unknown;
  updated_at:     Timestamp;
  updated_by:     AuthUid;
};

// ─── RhAccessCache (coala-rh/rh_access_cache/{auth_uid}) ────────────────────
export type RhAccessCache = {
  auth_uid:             AuthUid;
  rh_role:              RhRole;
  bizneo_employee_id?:  BizneoEmployeeId;
  unit_id?:             KioskId;
  updated_at:           Timestamp;
};

// ─── AuditLog ───────────────────────────────────────────────────────────────
export type AuditLogEntry = {
  employee_id: BizneoEmployeeId;
  field_key:   CoalaKey;
  old_value:   unknown;
  new_value:   unknown;
  changed_by:  AuthUid;
  changed_at:  Timestamp;
  source:      FieldSource;
};

// ─── AutomationTask ─────────────────────────────────────────────────────────
export type AutomationTask = {
  type:            string;
  payload:         unknown;
  status:          'pending' | 'processing' | 'done' | 'failed';
  idempotency_key: string;
  created_at:      Timestamp;
  processed_at?:   Timestamp;
  retry_count:     number;
};

// ─── SyncLog ────────────────────────────────────────────────────────────────
export type SyncLog = {
  status:         'success' | 'failed' | 'partial';
  started_at:     Timestamp;
  finished_at?:   Timestamp;
  duration_ms?:   number;
  employee_count: number;
  updated_count:  number;
  error_count:    number;
  errors?:        string[];
  source:         'scheduled' | 'manual';
};

// ─── Contratos entre módulos ─────────────────────────────────────────────────
export type HrTaskKind = 'hr_probation' | 'hr_aso_alert' | 'hr_offboarding';

export type HrTask = {
  kind:               HrTaskKind;
  employee_id:        BizneoEmployeeId;
  employee_name:      string;
  due_date:           string;
  unit_id:            KioskId;
  assignee_auth_uid?: AuthUid;
  metadata?:          Record<string, unknown>;
};

export type UniformUpdate = {
  employee_id: BizneoEmployeeId;
  unit_id:     KioskId;
  sizes: {
    shirt?: string;
    pants?: string;
    shoes?: string;
  };
  updated_at: string;
};

// ─── Profile completion spec (Anexo B) ──────────────────────────────────────
export const PROFILE_COMPLETION_WEIGHTS: Record<CoalaKey, number> = {
  'employee.name':              10,
  'employee.phone':             10,
  'employee.personal_email':    5,
  'employee.birth_date':        5,
  'employee.address':           5,
  'employee.cpf':               15,
  'employee.ctps_number':       10,
  'employee.pis':               5,
  'employee.emergency_name':    5,
  'employee.emergency_phone':   5,
  'employee.bank_account':      10,
  'employee.pix_key':           5,
  'employee.aso_admission_date': 10,
} as const;

export const PROFILE_COMPLETION_TOTAL = Object.values(PROFILE_COMPLETION_WEIGHTS)
  .reduce((sum, w) => sum + w, 0); // 100

export function calcProfileCompletion(
  fieldValues: Record<CoalaKey, EmployeeFieldValue>
): number {
  let total = 0;
  for (const [key, weight] of Object.entries(PROFILE_COMPLETION_WEIGHTS)) {
    const val = fieldValues[key];
    const isFilled =
      val &&
      (
        (typeof val.value_text === 'string'   && val.value_text.trim() !== '') ||
        (typeof val.value_number === 'number' && val.value_number != null)     ||
        val.value_date    != null ||
        val.value_boolean != null ||
        (Array.isArray(val.value_json) && (val.value_json as unknown[]).length > 0)
      );
    if (isFilled) total += weight;
  }
  return Math.min(100, total);
}

// ─── Helpers de visibilidade ─────────────────────────────────────────────────
export function canViewField(visibility: FieldVisibility, role: RhRole): boolean {
  if (visibility === 'public')    return true;
  if (visibility === 'sensitive') return role === 'manager' || role === 'admin';
  if (visibility === 'internal')  return role === 'admin';
  return false;
}

export function maskSensitiveText(value: string, role: RhRole): string {
  if (role === 'admin' || role === 'manager') return value;
  // mask CPF: ***.***.789-** (mostra últimos 3 dígitos apenas)
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) {
    return `***.***.${digits.slice(6, 9)}-**`;
  }
  return '*'.repeat(value.length);
}
