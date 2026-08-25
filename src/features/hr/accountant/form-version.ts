export type AccountantFormStaleReason =
  | 'monthly_salary_changed'
  | 'expected_admission_date_changed'
  | 'reviewed_form_data_changed';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function invalidateAccountantFormVersion(
  workflowInput: unknown,
  reason: AccountantFormStaleReason,
  now: string,
) {
  const workflow = record(workflowInput);
  if (typeof workflow.latestFormId !== 'string' || !workflow.latestFormId.trim()) return workflow;
  const staleReasons = Array.isArray(workflow.latestFormStaleReasons)
    ? workflow.latestFormStaleReasons.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    ...workflow,
    status: 'form_generated',
    formValidation: null,
    latestFormRequiresRegeneration: true,
    latestFormStaleReasons: Array.from(new Set([...staleReasons, reason])),
    latestFormInvalidatedAt: now,
    updatedAt: now,
  };
}
