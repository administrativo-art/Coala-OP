import type {
  PjOnboardingStepId,
  PjOnboardingWorkflow,
  PjServiceScopeItem,
} from '@/types';

export const PJ_ONBOARDING_STEP_ORDER: PjOnboardingStepId[] = [
  'contract_definition',
  'provider_registration',
  'registration_review',
  'contract_preparation',
  'contract_signature',
  'financial_registration',
  'access_configuration',
  'provider_activation',
];

export const PJ_ONBOARDING_STEP_LABELS: Record<PjOnboardingStepId, string> = {
  contract_definition: 'Definição da contratação PJ',
  provider_registration: 'Cadastro da empresa prestadora',
  registration_review: 'Conferência cadastral pelo RH',
  contract_preparation: 'Preparação e revisão do contrato',
  contract_signature: 'Assinaturas do contrato',
  financial_registration: 'Cadastro financeiro e fiscal',
  access_configuration: 'Configuração de acessos',
  provider_activation: 'Ativação da prestadora',
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function sanitizePjServiceItems(value: unknown): PjServiceScopeItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const data = entry as Record<string, unknown>;
    const front = cleanText(data.front, 240);
    const deliverable = cleanText(data.deliverable, 1000);
    if (!front && !deliverable) return [];
    const rawId = cleanText(data.id, 80).replace(/[^a-zA-Z0-9_-]/g, '');
    return [{ id: rawId || `scope_${index + 1}`, front, deliverable, order: index }];
  });
}

export function createPjOnboardingWorkflow(input: {
  cnpj: string;
  legalName: string;
  tradeName?: string | null;
  email: string;
  contractStartDate: string;
  termType: 'fixed' | 'indefinite';
  contractEndDate?: string | null;
  monthlyValue: number;
  paymentDay: number;
  serviceItems: PjServiceScopeItem[];
  now: string;
  actorId: string;
}): PjOnboardingWorkflow {
  const steps = Object.fromEntries(PJ_ONBOARDING_STEP_ORDER.map(step => [step, {
    status: step === 'contract_definition' ? 'completed' : step === 'provider_registration' ? 'active' : 'pending',
    completedAt: step === 'contract_definition' ? input.now : null,
    completedBy: step === 'contract_definition' ? input.actorId : null,
  }])) as PjOnboardingWorkflow['steps'];
  return {
    version: 1,
    currentStep: 'provider_registration',
    steps,
    provider: {
      cnpj: input.cnpj,
      legalName: input.legalName,
      tradeName: input.tradeName || null,
      email: input.email,
    },
    terms: {
      contractStartDate: input.contractStartDate,
      termType: input.termType,
      contractEndDate: input.termType === 'fixed' ? input.contractEndDate || null : null,
      monthlyValue: input.monthlyValue,
      paymentDay: input.paymentDay,
      invoiceRequired: true,
      serviceItems: input.serviceItems,
    },
    review: { status: 'pending', issues: [] },
    contract: { status: 'not_generated', version: 0 },
    finance: { status: 'pending' },
    access: { status: 'pending', pdvRequired: false, unitIds: [], unitNames: [] },
  };
}

export function setPjWorkflowStep(
  workflow: PjOnboardingWorkflow,
  nextStep: PjOnboardingStepId,
  now: string,
  actorId: string,
): PjOnboardingWorkflow {
  const current = workflow.currentStep;
  return {
    ...workflow,
    currentStep: nextStep,
    steps: {
      ...workflow.steps,
      [current]: { ...workflow.steps[current], status: 'completed', completedAt: now, completedBy: actorId },
      [nextStep]: { ...workflow.steps[nextStep], status: 'active' },
    },
  };
}

export function pjRequiredRegistrationFieldsMissing(value: unknown) {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const missing: string[] = [];
  const required: Array<[string, string]> = [
    ['companyAddress', 'Endereço da empresa'],
    ['companyPhone', 'Telefone institucional'],
    ['representativeName', 'Nome do representante legal'],
    ['representativeCpf', 'CPF do representante legal'],
    ['representativeQualification', 'Qualificação do representante'],
    ['bankMethod', 'Forma de recebimento'],
    ['bankHolderName', 'Titular da conta'],
    ['bankHolderDocument', 'CPF ou CNPJ do titular'],
  ];
  required.forEach(([key, label]) => { if (!cleanText(data[key], 1000)) missing.push(label); });
  if (cleanText(data.bankMethod, 20) === 'pix' && !cleanText(data.pixKey, 200)) missing.push('Chave Pix');
  if (cleanText(data.bankMethod, 20) === 'bank') {
    if (!cleanText(data.bankName, 120)) missing.push('Banco');
    if (!cleanText(data.bankAgency, 40)) missing.push('Agência');
    if (!cleanText(data.bankAccount, 80)) missing.push('Conta');
  }
  return missing;
}
