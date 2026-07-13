// Tipos internos das Cloud Functions de RH.
// Espelha src/types/rh.ts, mas sem imports do Firebase client SDK.

import { type Timestamp } from 'firebase-admin/firestore';

export type BizneoEmployeeId = string;
export type AuthUid          = string;
export type CoalaKey         = string;
export type BizneoFieldId    = string;
export type JobRoleId        = string;
export type KioskId          = string;

export type FieldVisibility =
  | 'public'
  | 'restricted_total'
  | 'restricted_partial'
  | 'confidential'
  // Legado: mantido para ler field_map antigo sem quebrar funções.
  | 'sensitive'
  | 'internal';
export type RhRole          = 'employee' | 'manager' | 'admin';
export type EmployeeStatus  = 'active' | 'inactive' | 'terminated';
export type NormalizedFieldVisibility = 'public' | 'restricted_total' | 'restricted_partial' | 'confidential';
export type ProfileAccessActor = 'authenticated' | 'owner' | 'manager' | 'admin' | 'explicit';
export type ProfileAccessPermission = 'hidden' | 'view' | 'edit';
export type ProfileAccessMatrixRule = Partial<Record<ProfileAccessActor, ProfileAccessPermission>> & {
  bindings?: FieldAccessBinding;
};
export type ProfileAccessMatrix = {
  version: string;
  visibility: Partial<Record<NormalizedFieldVisibility, ProfileAccessMatrixRule>>;
};
export type FieldType =
  | 'text' | 'multiline' | 'date' | 'number' | 'currency'
  | 'boolean' | 'single_select' | 'multi_select' | 'autonumber' | 'ref:jobRoles';
export type FieldSource = 'bizneo_sync' | 'user_edit' | 'cf_automation';

export type FieldAccessBinding = {
  roleIds?: JobRoleId[];
  functionIds?: string[];
  userIds?: AuthUid[];
};

export type FieldAccessConfig = {
  allowed?: FieldAccessBinding;
};

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

export type FieldMapEntry = {
  bizneo_id:         BizneoFieldId;
  type:              FieldType;
  visibility:        FieldVisibility;
  employee_visible:  boolean;
  employee_editable: boolean;
  required?:         boolean;
  options?:          string[];
  triggers?:         TriggerConfig[];
  access?:           FieldAccessConfig;
  section:           string;
  label:             string;
  order:             number;
};

export type FieldMap = {
  version: string;
  fields:  Record<CoalaKey, FieldMapEntry>;
  access_matrix?: ProfileAccessMatrix;
};

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

export type RhAccessCache = {
  auth_uid:             AuthUid;
  rh_role:              RhRole;
  bizneo_employee_id?:  BizneoEmployeeId;
  unit_id?:             KioskId;
  user_id?:             AuthUid;
  job_role_id?:         JobRoleId;
  job_role_ids?:        JobRoleId[];
  role_ids?:            JobRoleId[];
  job_function_id?:     string;
  job_function_ids?:    string[];
  function_ids?:        string[];
  updated_at:           Timestamp;
};

export type AuditLogEntry = {
  employee_id: BizneoEmployeeId;
  field_key:   CoalaKey;
  old_value:   unknown;
  new_value:   unknown;
  changed_by:  AuthUid;
  changed_at:  Timestamp;
  source:      FieldSource;
};

export type AutomationTask = {
  type:            string;
  payload:         unknown;
  status:          'pending' | 'processing' | 'done' | 'failed';
  idempotency_key: string;
  created_at:      Timestamp;
  processed_at?:   Timestamp;
  retry_count:     number;
};

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

// ─── Profile completion ──────────────────────────────────────────────────────

export const PROFILE_COMPLETION_WEIGHTS: Record<string, number> = {
  'employee.name':               10,
  'employee.phone':              10,
  'employee.personal_email':     5,
  'employee.birth_date':         5,
  'employee.address':            5,
  'employee.cpf':                15,
  'employee.ctps_number':        10,
  'employee.pis':                5,
  'employee.emergency_name':     5,
  'employee.emergency_phone':    5,
  'employee.bank_account':       10,
  'employee.pix_key':            5,
  'employee.aso_admission_date': 10,
};

export function calcProfileCompletion(
  fieldValues: Record<string, EmployeeFieldValue>
): number {
  let total = 0;
  for (const [key, weight] of Object.entries(PROFILE_COMPLETION_WEIGHTS)) {
    const val = fieldValues[key];
    if (!val) continue;
    const isFilled =
      (typeof val.value_text === 'string'   && val.value_text.trim() !== '') ||
      (typeof val.value_number === 'number' && val.value_number != null)     ||
      val.value_date    != null ||
      val.value_boolean != null ||
      (Array.isArray(val.value_json) && (val.value_json as unknown[]).length > 0);
    if (isFilled) total += weight;
  }
  return Math.min(100, total);
}
