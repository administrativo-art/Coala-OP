import { type Timestamp } from 'firebase/firestore';

// ─── Context discriminator ─────────────────────────────────────────────────────

export type FormContext = 'operational' | 'recruitment';

// ─── Item types ────────────────────────────────────────────────────────────────

export type FormItemType =
  | 'checkbox'
  | 'text'
  | 'number'
  | 'temperature'
  | 'select'
  | 'photo'
  | 'signature'
  | 'yes_no'
  | 'multi_select'
  | 'date'
  | 'file_upload'
  | 'location';

export type FormItemCriticality = 'low' | 'medium' | 'high' | 'critical';

// ─── Project / Type / Subtype ──────────────────────────────────────────────────

export type FormProjectMemberRole = 'viewer' | 'operator' | 'manager';

export type FormProjectMember = {
  user_id: string;
  username: string;
  role: FormProjectMemberRole;
  custom_permissions?: {
    view?: boolean;
    operate?: boolean;
    manage?: boolean;
  };
};

export type FormProject = {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  is_active: boolean;
  members: FormProjectMember[];
  created_at: Timestamp | string;
  updated_at: Timestamp | string;
  created_by: { user_id: string; username: string };
};

export type FormType = {
  id: string;
  form_project_id: string;
  workspace_id: string;
  name: string;
  description?: string;
  requires_subtype: boolean;
  context: FormContext;
  order: number;
  is_active: boolean;
  created_at: Timestamp | string;
  updated_at: Timestamp | string;
};

export type FormSubtype = {
  id: string;
  form_type_id: string;
  form_project_id: string;
  workspace_id: string;
  name: string;
  description?: string;
  order: number;
  is_active: boolean;
  created_at: Timestamp | string;
  updated_at: Timestamp | string;
};

// ─── Conditional logic ─────────────────────────────────────────────────────────

export type FormConditionalOperator =
  | 'equals'
  | 'not_equals'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'contains'
  | 'is_empty'
  | 'is_not_empty';

export type FormConditionalRule = {
  item_id: string;
  operator: FormConditionalOperator;
  value?: unknown;
};

export type FormConditionalBranch = {
  value?: unknown;
  label: string;
  items: FormTemplateItem[];
};

// ─── Task triggers ─────────────────────────────────────────────────────────────

export type FormTaskTrigger = {
  id: string;
  title_template: string;
  description_template?: string;
  task_project_id: string;
  assignee_type: 'user' | 'role';
  assignee_id: string;
  assignee_name?: string;
  requires_approval: boolean;
  approver_id?: string;
  approver_name?: string;
  sla_hours?: number;
  condition?: FormConditionalRule;
};

// ─── Item config ───────────────────────────────────────────────────────────────

export type FormItemConfig = {
  min?: number;
  max?: number;
  unit?: string;
  alert_out_of_range?: boolean;
  options?: string[];
  min_photos?: number;
  max_photos?: number;
  allow_multiple?: boolean;
  accept?: string;
};

// ─── Template ──────────────────────────────────────────────────────────────────

export type FormTemplateItem = {
  id: string;
  order: number;
  title: string;
  description?: string;
  type: FormItemType;
  required: boolean;
  weight: number;
  block_next: boolean;
  criticality: FormItemCriticality;
  reference_value?: number;
  tolerance_percent?: number;
  action_required?: boolean;
  notify_role_ids?: string[];
  escalation_minutes?: number;
  show_if?: FormConditionalRule;
  conditional_branches?: FormConditionalBranch[];
  task_triggers?: FormTaskTrigger[];
  config?: FormItemConfig;
};

export type FormTemplateSection = {
  id: string;
  title: string;
  order: number;
  show_if?: FormConditionalRule;
  require_photo?: boolean;
  require_signature?: boolean;
  items: FormTemplateItem[];
};

export type FormTemplateVersionHistoryEntry = {
  version: number;
  updated_by: string;
  updated_at: Timestamp | string;
  change_notes?: string;
};

export type FormRecruitmentConfig = {
  requires_lgpd_consent: boolean;
  public_landing: boolean;
  candidate_dedupe_keys: ('cpf' | 'email')[];
  rate_limit_per_ip_per_day?: number;
};

export type FormOccurrenceType =
  | 'manual'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'annual'
  | 'custom';

export type FormCustomSchedule = {
  modes: ('weekdays' | 'monthdays' | 'interval' | 'once')[];
  weekdays?: number[];
  monthdays?: number[];
  interval_days?: number;
  once_dates?: string[];
};

export type FormTemplate = {
  id: string;
  workspace_id: string;
  form_project_id: string;
  form_type_id: string;
  form_subtype_id?: string;
  context: FormContext;
  name: string;
  description?: string;
  occurrence_type?: FormOccurrenceType;
  annual_schedule?: { month: number; day: number };
  custom_schedule?: FormCustomSchedule;
  unit_ids?: string[];
  unit_names?: string[];
  job_role_ids?: string[];
  job_role_names?: string[];
  job_function_ids?: string[];
  job_function_names?: string[];
  shift_definition_ids?: string[];
  shift_definition_names?: string[];
  is_active: boolean;
  version: number;
  version_history?: FormTemplateVersionHistoryEntry[];
  last_execution_at?: string | null;
  sections: FormTemplateSection[];
  recruitment_config?: FormRecruitmentConfig;
  created_at: Timestamp | string;
  updated_at?: Timestamp | string;
  created_by?: { user_id: string; username: string };
  updated_by?: { user_id: string; username: string };
};

// ─── Execution ─────────────────────────────────────────────────────────────────

export type FormExecutionStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'overdue'
  | 'canceled';

export type FormExecutionItem = {
  id: string;
  template_item_id: string;
  // template_section_id: referência imutável à seção original; sobrevive a versionamento
  template_section_id: string;
  // section_id: identidade da seção nessa execução; várias podem apontar pro mesmo template_section_id (clones condicionais)
  section_id: string;
  section_title: string;
  order: number;
  title: string;
  description?: string;
  type: FormItemType;
  required: boolean;
  weight: number;
  block_next: boolean;
  criticality: FormItemCriticality;
  reference_value?: number;
  tolerance_percent?: number;
  action_required?: boolean;
  notify_role_ids?: string[];
  escalation_minutes?: number;
  show_if?: FormConditionalRule;
  section_show_if?: FormConditionalRule;
  config?: FormItemConfig;
  // Response values
  checked?: boolean | null;
  yes_no_value?: boolean | null;
  text_value?: string;
  number_value?: number;
  multi_values?: string[];
  date_value?: string;
  photo_urls?: string[];
  file_urls?: { url: string; name: string; mime: string }[];
  signature_url?: string;
  location?: { lat: number; lng: number; address?: string };
  // State
  is_out_of_range?: boolean;
  completed_at?: string | null;
  completed_by_user_id?: string | null;
  linked_project_task_id?: string | null;
  linked_project_task_status?: string | null;
};

export type FormExecutionSection = {
  id: string;
  template_section_id: string;
  title: string;
  order: number;
  show_if?: FormConditionalRule;
  require_photo?: boolean;
  require_signature?: boolean;
  photo_url?: string;
  signature_url?: string;
};

export type FormExecutionEventType =
  | 'created'
  | 'claimed'
  | 'item_updated'
  | 'section_completed'
  | 'completed'
  | 'reopened'
  | 'canceled'
  | 'evidence_added'
  | 'evidence_removed'
  | 'signature_added'
  | 'task_created'
  | 'task_status_changed';

export type FormExecutionEvent = {
  id: string;
  type: FormExecutionEventType;
  user_id: string;
  username: string;
  timestamp: Timestamp | string;
  metadata?: Record<string, unknown>;
};

export type FormEvidence = {
  id: string;
  item_id: string;
  url: string;
  name: string;
  mime: string;
  size?: number;
  uploaded_by: { user_id: string; username: string };
  uploaded_at: string;
};

export type FormSectionsSummary = Record<string, {
  total_items: number;
  completed_items: number;
  score?: number;
}>;

export type FormExecution = {
  id: string;
  workspace_id: string;
  form_project_id: string;
  form_type_id: string;
  form_subtype_id?: string;
  context: FormContext;
  template_id: string;
  template_name: string;
  template_version: number;
  template_snapshot?: FormTemplate;
  occurrence_type?: FormOccurrenceType;
  unit_id: string;
  unit_name?: string;
  schedule_id?: string;
  shift_id?: string;
  shift_definition_id?: string;
  shift_definition_name?: string;
  shift_start_time?: string;
  shift_end_time?: string;
  shift_end_date?: string;
  assigned_user_id: string;
  assigned_username: string;
  collaborator_user_ids?: string[];
  collaborator_usernames?: string[];
  created_by_user_id?: string;
  created_by_username?: string;
  scheduled_for?: string;
  sections: FormExecutionSection[];
  items?: FormExecutionItem[];
  sections_summary?: FormSectionsSummary;
  status: FormExecutionStatus;
  score?: number;
  claimed_by_user_id?: string | null;
  claimed_by_username?: string | null;
  claimed_at?: string | null;
  completed_by_user_id?: string | null;
  completed_by_username?: string | null;
  completed_at?: string | null;
  canceled_by_user_id?: string | null;
  canceled_at?: string | null;
  created_at: Timestamp | string;
  updated_at?: Timestamp | string;
};

// ─── KPIs ──────────────────────────────────────────────────────────────────────

export type FormKpiType =
  | 'completion_rate'
  | 'average_score'
  | 'overdue_executions'
  | 'critical_non_conformities'
  | 'ranking_by_unit'
  | 'open_tasks';

export type FormKpi = {
  id: string;
  workspace_id: string;
  form_project_id: string;
  type: FormKpiType;
  name: string;
  description?: string;
  is_active: boolean;
  order: number;
  config?: Record<string, unknown>;
  created_at: Timestamp | string;
};

export type FormKpiDashboardItem = {
  kpi_id: string;
  order: number;
  is_visible: boolean;
};

export type FormKpiDashboard = {
  id: string;
  user_id: string;
  workspace_id: string;
  form_project_id: string;
  items: FormKpiDashboardItem[];
  updated_at: Timestamp | string;
};
