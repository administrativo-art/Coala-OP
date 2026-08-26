import type { assertFormalizationAccess } from '@/features/hr/lib/server-access';
import { hasFormalizationPermission } from '@/lib/hr-formalization-permissions';

type FormalizationAccess = NonNullable<Awaited<ReturnType<typeof assertFormalizationAccess>>>;

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function redactOnboardingProcess(
  process: Record<string, unknown>,
  access: FormalizationAccess,
) {
  const result = structuredClone(process) as Record<string, unknown>;
  const allowed = (action: Parameters<typeof hasFormalizationPermission>[1]) =>
    hasFormalizationPermission(access.permissions, action, access.isDefaultAdmin);
  const accountantWorkflow = result.accountantWorkflow && typeof result.accountantWorkflow === 'object' && !Array.isArray(result.accountantWorkflow)
    ? result.accountantWorkflow as Record<string, unknown>
    : null;
  const accountantFormData = accountantWorkflow?.formData && typeof accountantWorkflow.formData === 'object' && !Array.isArray(accountantWorkflow.formData)
    ? accountantWorkflow.formData as Record<string, unknown>
    : null;
  const configuredSalary = numberValue(result.monthlySalary) ?? numberValue(accountantFormData?.monthlySalary);
  result.monthlySalaryConfigured = configuredSalary !== null && configuredSalary > 0;

  if (!allowed('aso.view')) delete result.asoWorkflow;
  if (!allowed('accountant.view')) delete result.accountantWorkflow;
  if (!allowed('consents.view')) {
    delete result.consentimento_imagem_voz;
    delete result.publicPrivacyAcceptance;
  }
  if (!allowed('onboarding.manage')) {
    delete result.publicToken;
    delete result.publicTokenExtendedBy;
  }
  if (!allowed('documents.view')) {
    const documents = Array.isArray(result.documents) ? result.documents : [];
    result.documents = documents.map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
      const document = { ...(entry as Record<string, unknown>) };
      delete document.fileUrl;
      delete document.storagePath;
      delete document.hashSha256;
      return document;
    });
  }
  if (!allowed('sensitiveData.view')) {
    delete result.monthlySalary;
    if (accountantFormData) delete accountantFormData.monthlySalary;
    const answers = result.publicFormAnswers && typeof result.publicFormAnswers === 'object' && !Array.isArray(result.publicFormAnswers)
      ? { ...(result.publicFormAnswers as Record<string, unknown>) }
      : null;
    if (answers) {
      for (const key of ['cpf', 'rg', 'identityNumber', 'bankName', 'bankAgency', 'bankAccount', 'pixKey']) delete answers[key];
      if (Array.isArray(answers.children)) {
        answers.children = answers.children.map(child => {
          if (!child || typeof child !== 'object' || Array.isArray(child)) return child;
          const safeChild = { ...(child as Record<string, unknown>) };
          delete safeChild.cpf;
          return safeChild;
        });
      }
      result.publicFormAnswers = answers;
    }
  }
  return result;
}
