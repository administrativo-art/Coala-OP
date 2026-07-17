import { type Timestamp } from 'firebase/firestore';

// ─── Identificadores ────────────────────────────────────────────────────────
export type BizneoEmployeeId = string; // ex: "17006830"
export type AuthUid          = string; // ex: "abc123xyz" — Firebase Auth UID
export type CoalaKey         = string; // ex: "employee.vt_daily_value"
export type BizneoFieldId    = string; // ex: "cf_15642_vt_diario" | "PENDING_DISCOVERY"
export type JobRoleId        = string; // ref: coala-rh/jobRoles/{id}
export type KioskId          = string; // ref: coala/Kiosk/{id}

// ─── Enums ──────────────────────────────────────────────────────────────────
export type FieldVisibility =
  | 'public'
  | 'restricted_total'
  | 'restricted_partial'
  | 'confidential'
  // Legado: mantido só para ler dados antigos já salvos no field_map.
  | 'sensitive'
  | 'internal';
export type NormalizedFieldVisibility = 'public' | 'restricted_total' | 'restricted_partial' | 'confidential';
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

export type RepeatableConfig = {
  enabled: boolean;
  add_label?: string;
  item_label?: string;
  max_items?: number;
};

export type FieldGroupConfig = {
  id: string;
  label: string;
  order?: number;
  conditionals?: ConditionalRule[];
  repeatable?: RepeatableConfig;
};

export type FieldSubgroupConfig = {
  id: string;
  label: string;
  order?: number;
  group_id?: string;
  conditionals?: ConditionalRule[];
};

export type ProfileBlockConfig = {
  id: string;
  label: string;
  order: number;
  employee_visible: boolean;
  employee_editable?: boolean;
  locked?: boolean;
};

export type FieldAccessBinding = {
  roleIds?: JobRoleId[];
  functionIds?: string[];
  userIds?: AuthUid[];
};

export type FieldAccessConfig = {
  allowed?: FieldAccessBinding;
};

export type FieldVisibilityContext = {
  isOwner?: boolean;
  canViewConfidential?: boolean;
  userId?: AuthUid | null;
  roleIds?: string[];
  functionIds?: string[];
};

export type ProfileAccessActor = 'authenticated' | 'owner' | 'manager' | 'admin' | 'explicit';
export type ProfileAccessPermission = 'hidden' | 'view' | 'edit';
export type ProfileAccessMatrixRule = Partial<Record<ProfileAccessActor, ProfileAccessPermission>> & {
  bindings?: FieldAccessBinding;
};

export type ProfileAccessMatrix = {
  version: string;
  visibility: Partial<Record<NormalizedFieldVisibility, ProfileAccessMatrixRule>>;
};

export type DocumentVisibilityConfig = {
  version: string;
  categories?: Record<string, NormalizedFieldVisibility>;
  document_types?: Record<string, NormalizedFieldVisibility>;
};

export const DEFAULT_PROFILE_ACCESS_MATRIX: ProfileAccessMatrix = {
  version: 'coala-rh-access-v1',
  visibility: {
    public: {
      authenticated: 'view',
      owner: 'view',
      manager: 'edit',
      admin: 'edit',
      explicit: 'view',
    },
    restricted_partial: {
      authenticated: 'hidden',
      owner: 'view',
      manager: 'edit',
      admin: 'edit',
      explicit: 'view',
    },
    restricted_total: {
      authenticated: 'hidden',
      owner: 'hidden',
      manager: 'edit',
      admin: 'edit',
      explicit: 'view',
    },
    confidential: {
      authenticated: 'hidden',
      owner: 'hidden',
      manager: 'hidden',
      admin: 'edit',
      explicit: 'view',
    },
  },
};

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
    legal_basis: 'legal_obligation' | 'contract' | 'legitimate_interest' | 'consent' | 'life_protection' | 'health_guardianship';
    retention: 'employment_plus_5y' | 'termination_plus_90d' | 'termination_plus_2y' | 'manual_review';
    requires_consent?: boolean;
  };
  triggers?:         TriggerConfig[];
  validation?:       ValidationRule[];
  conditionals?:     ConditionalRule[];
  group?:            FieldGroupConfig;
  subgroup?:         FieldSubgroupConfig;
  repeatable?:       RepeatableConfig;
  access?:           FieldAccessConfig;
  section:           string;
  label:             string;
  order:             number;
};

export type FieldMap = {
  version: string;
  fields:  Record<CoalaKey, FieldMapEntry>;
  section_order?: Record<string, number>;
  profile_blocks?: Record<string, ProfileBlockConfig>;
  access_matrix?: ProfileAccessMatrix;
  document_visibility?: DocumentVisibilityConfig;
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
  user_id?:             AuthUid;
  job_role_id?:         JobRoleId;
  job_role_ids?:        JobRoleId[];
  role_ids?:            JobRoleId[];
  job_function_id?:     string;
  job_function_ids?:    string[];
  function_ids?:        string[];
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
export function normalizeFieldVisibility(visibility?: FieldVisibility | string | null): NormalizedFieldVisibility {
  if (visibility === 'sensitive') return 'restricted_total';
  if (visibility === 'internal') return 'confidential';
  if (
    visibility === 'public'
    || visibility === 'restricted_total'
    || visibility === 'restricted_partial'
    || visibility === 'confidential'
  ) {
    return visibility;
  }
  return 'confidential';
}

function normalizeAccessList(values?: string[]) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

export function normalizeFieldAccessBinding(binding?: FieldAccessBinding | null): FieldAccessBinding | undefined {
  const roleIds = normalizeAccessList(binding?.roleIds);
  const functionIds = normalizeAccessList(binding?.functionIds);
  const userIds = normalizeAccessList(binding?.userIds);

  if (roleIds.length === 0 && functionIds.length === 0 && userIds.length === 0) return undefined;

  return {
    ...(roleIds.length ? { roleIds } : {}),
    ...(functionIds.length ? { functionIds } : {}),
    ...(userIds.length ? { userIds } : {}),
  };
}

export function hasExplicitAccessBinding(
  binding: FieldAccessBinding | undefined,
  context: FieldVisibilityContext = {},
): boolean {
  if (!binding) return false;

  const userIds = normalizeAccessList(binding.userIds);
  const roleIds = normalizeAccessList(binding.roleIds);
  const functionIds = normalizeAccessList(binding.functionIds);

  if (context.userId && userIds.includes(context.userId)) return true;
  if (normalizeAccessList(context.roleIds).some((roleId) => roleIds.includes(roleId))) return true;
  if (normalizeAccessList(context.functionIds).some((functionId) => functionIds.includes(functionId))) return true;

  return false;
}

export function hasExplicitFieldAccess(
  access: FieldAccessConfig | undefined,
  context: FieldVisibilityContext = {},
): boolean {
  return hasExplicitAccessBinding(access?.allowed, context);
}

const PROFILE_ACCESS_PERMISSION_RANK: Record<ProfileAccessPermission, number> = {
  hidden: 0,
  view: 1,
  edit: 2,
};

export function normalizeProfileAccessPermission(value: unknown): ProfileAccessPermission {
  if (value === 'edit' || value === 'view' || value === 'hidden') return value;
  return 'hidden';
}

export function normalizeProfileAccessMatrix(matrix?: ProfileAccessMatrix | null): ProfileAccessMatrix {
  const source = matrix?.visibility ?? {};
  const visibility = Object.fromEntries(
    (['public', 'restricted_partial', 'restricted_total', 'confidential'] as NormalizedFieldVisibility[]).map((key) => {
      const defaults = DEFAULT_PROFILE_ACCESS_MATRIX.visibility[key] ?? {};
      const current = source[key] ?? {};
      const bindings = normalizeFieldAccessBinding(current.bindings);
      return [
        key,
        {
          authenticated: normalizeProfileAccessPermission(current.authenticated ?? defaults.authenticated),
          owner: normalizeProfileAccessPermission(current.owner ?? defaults.owner),
          manager: normalizeProfileAccessPermission(current.manager ?? defaults.manager),
          admin: normalizeProfileAccessPermission(current.admin ?? defaults.admin),
          explicit: normalizeProfileAccessPermission(current.explicit ?? defaults.explicit),
          ...(bindings ? { bindings } : {}),
        },
      ];
    }),
  ) as Record<NormalizedFieldVisibility, ProfileAccessMatrixRule>;

  return {
    version: matrix?.version || DEFAULT_PROFILE_ACCESS_MATRIX.version,
    visibility,
  };
}

export function resolveFieldAccessPermission(
  visibility: FieldVisibility,
  role: RhRole,
  context: FieldVisibilityContext = {},
  access?: FieldAccessConfig,
  matrix?: ProfileAccessMatrix,
): ProfileAccessPermission {
  if (!matrix) {
    const normalized = normalizeFieldVisibility(visibility);
    if (normalized === 'public') return role === 'admin' || role === 'manager' ? 'edit' : 'view';
    if (hasExplicitFieldAccess(access, context)) return 'view';
    if (normalized === 'restricted_partial') return role === 'admin' || role === 'manager' ? 'edit' : context.isOwner === true ? 'view' : 'hidden';
    if (normalized === 'restricted_total') return role === 'admin' || role === 'manager' ? 'edit' : 'hidden';
    if (normalized === 'confidential') return role === 'admin' || context.canViewConfidential === true ? 'edit' : 'hidden';
    return 'hidden';
  }

  const normalized = normalizeFieldVisibility(visibility);
  const normalizedMatrix = normalizeProfileAccessMatrix(matrix);
  const rule = normalizedMatrix.visibility[normalized] ?? {};
  const actors: ProfileAccessActor[] = ['authenticated'];
  if (context.isOwner === true) actors.push('owner');
  if (role === 'manager') actors.push('manager');
  if (role === 'admin' || context.canViewConfidential === true) actors.push('admin');
  if (hasExplicitAccessBinding(rule.bindings, context) || hasExplicitFieldAccess(access, context)) actors.push('explicit');

  return actors.reduce<ProfileAccessPermission>((best, actor) => {
    const permission = normalizeProfileAccessPermission(rule[actor]);
    return PROFILE_ACCESS_PERMISSION_RANK[permission] > PROFILE_ACCESS_PERMISSION_RANK[best] ? permission : best;
  }, 'hidden');
}

export function canEditField(
  entry: FieldMapEntry,
  role: RhRole,
  context: FieldVisibilityContext = {},
  matrix?: ProfileAccessMatrix,
): boolean {
  const permission = resolveFieldAccessPermission(entry.visibility, role, context, entry.access, matrix);
  return permission === 'edit';
}

export function canViewField(
  visibility: FieldVisibility,
  role: RhRole,
  context: FieldVisibilityContext = {},
  access?: FieldAccessConfig,
  matrix?: ProfileAccessMatrix,
): boolean {
  if (matrix) {
    return resolveFieldAccessPermission(visibility, role, context, access, matrix) !== 'hidden';
  }
  const normalized = normalizeFieldVisibility(visibility);
  if (normalized === 'public') return true;
  if (hasExplicitFieldAccess(access, context)) return true;
  if (normalized === 'restricted_partial') return role === 'manager' || role === 'admin' || context.isOwner === true;
  if (normalized === 'restricted_total') return role === 'manager' || role === 'admin';
  if (normalized === 'confidential') return role === 'admin' || context.canViewConfidential === true;
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
