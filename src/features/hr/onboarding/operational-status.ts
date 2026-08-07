import type { OnboardingDocument, OnboardingProcess, PjOnboardingStepId } from '@/types';
import { PJ_ONBOARDING_STEP_LABELS, PJ_ONBOARDING_STEP_ORDER } from '@/features/hr/onboarding-pj/core';

const DAY_MS = 24 * 60 * 60 * 1000;

export type OnboardingHealth =
  | 'on_track'
  | 'waiting_person'
  | 'hr_action'
  | 'blocked'
  | 'overdue'
  | 'completed'
  | 'cancelled';

export type OnboardingSortMode = 'priority' | 'admission' | 'stalled' | 'name';

export type OnboardingOperationalStatus = {
  health: OnboardingHealth;
  label: string;
  headline: string;
  detail: string;
  priority: number;
  responsible: 'rh' | 'person' | 'third_party' | 'system' | 'none';
  stageStartedAt: string | null;
  daysInStage: number;
  overdueDays: number;
};

export const ONBOARDING_HEALTH_META: Record<OnboardingHealth, {
  label: string;
  dotClass: string;
  textClass: string;
  badgeClass: string;
  borderClass: string;
}> = {
  on_track: {
    label: 'Em dia',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-700',
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    borderClass: 'border-l-emerald-500',
  },
  waiting_person: {
    label: 'Aguardando pessoa',
    dotClass: 'bg-blue-500',
    textClass: 'text-blue-700',
    badgeClass: 'border-blue-200 bg-blue-50 text-blue-700',
    borderClass: 'border-l-blue-500',
  },
  hr_action: {
    label: 'Ação do RH',
    dotClass: 'bg-violet-500',
    textClass: 'text-violet-700',
    badgeClass: 'border-violet-200 bg-violet-50 text-violet-700',
    borderClass: 'border-l-violet-500',
  },
  blocked: {
    label: 'Bloqueado',
    dotClass: 'bg-rose-500',
    textClass: 'text-rose-700',
    badgeClass: 'border-rose-200 bg-rose-50 text-rose-700',
    borderClass: 'border-l-rose-500',
  },
  overdue: {
    label: 'Atrasado',
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-700',
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-700',
    borderClass: 'border-l-amber-500',
  },
  completed: {
    label: 'Finalizado',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-700',
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    borderClass: 'border-l-emerald-500',
  },
  cancelled: {
    label: 'Encerrado',
    dotClass: 'bg-slate-400',
    textClass: 'text-slate-600',
    badgeClass: 'border-slate-200 bg-slate-100 text-slate-600',
    borderClass: 'border-l-slate-400',
  },
};

function validDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSince(value: string | null, now: Date) {
  const start = validDate(value);
  if (!start) return 0;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / DAY_MS));
}

function requiredDocuments(process: OnboardingProcess) {
  return (process.documents ?? []).filter(document => document.required !== false);
}

function documentHasFile(document: OnboardingDocument) {
  return Boolean(document.fileUrl || document.filePath);
}

function signatureDocuments(process: OnboardingProcess) {
  const raw = process as OnboardingProcess & {
    signatureDocuments?: Array<{ status?: string | null; lastError?: string | null }>;
  };
  return raw.signatureDocuments ?? [];
}

function baseStatus(
  process: OnboardingProcess,
  status: Omit<OnboardingOperationalStatus, 'stageStartedAt' | 'daysInStage' | 'overdueDays'>,
  now: Date,
): OnboardingOperationalStatus {
  const customStageStartedAt = process.integrationV2?.currentStageStartedAt;
  const stageStartedAt = process.currentStageStartedAt
    ?? customStageStartedAt
    ?? process.updatedAt
    ?? process.createdAt
    ?? null;
  const daysInStage = daysSince(stageStartedAt, now);
  const stage = (process.stages ?? []).find(item => item.id === process.currentStage);
  const configuredDueDays = stage?.dueDays ?? null;
  const expectedAdmission = validDate(process.expectedAdmissionDate);
  const dueByStage = configuredDueDays !== null && configuredDueDays !== undefined
    ? daysInStage - configuredDueDays
    : 0;
  const dueByAdmission = expectedAdmission
    ? Math.floor((now.getTime() - expectedAdmission.getTime()) / DAY_MS)
    : 0;
  const overdueDays = Math.max(0, dueByStage, dueByAdmission);

  if (
    overdueDays > 0
    && !['blocked', 'completed', 'cancelled'].includes(status.health)
  ) {
    return {
      ...status,
      health: 'overdue',
      label: ONBOARDING_HEALTH_META.overdue.label,
      priority: 90,
      detail: `${status.detail} · ${overdueDays} dia${overdueDays === 1 ? '' : 's'} de atraso.`,
      stageStartedAt,
      daysInStage,
      overdueDays,
    };
  }

  return { ...status, stageStartedAt, daysInStage, overdueDays };
}

function status(
  process: OnboardingProcess,
  health: OnboardingHealth,
  headline: string,
  detail: string,
  responsible: OnboardingOperationalStatus['responsible'],
  now: Date,
): OnboardingOperationalStatus {
  const priorities: Record<OnboardingHealth, number> = {
    blocked: 100,
    overdue: 90,
    hr_action: 80,
    waiting_person: 60,
    on_track: 30,
    completed: 10,
    cancelled: 0,
  };
  return baseStatus(process, {
    health,
    label: ONBOARDING_HEALTH_META[health].label,
    headline,
    detail,
    priority: priorities[health],
    responsible,
  }, now);
}

function failedCommunication(value?: string | null) {
  return ['failed', 'bounced', 'complained'].includes(value ?? '');
}

function resolvePjStatus(process: OnboardingProcess, now: Date) {
  const workflow = process.pjWorkflow;
  if (!workflow) {
    return status(process, 'blocked', 'Fluxo PJ indisponível', 'A configuração do processo PJ não foi encontrada.', 'system', now);
  }

  const step = workflow.currentStep;
  const stepLabel = PJ_ONBOARDING_STEP_LABELS[step];
  const stepState = workflow.steps[step]?.status;
  if (stepState === 'correction_required') {
    return status(process, 'waiting_person', 'Correção solicitada à prestadora', workflow.steps[step]?.note ?? `Aguardando correções em ${stepLabel.toLowerCase()}.`, 'person', now);
  }
  if (workflow.contract?.status === 'failed') {
    return status(process, 'blocked', 'Falha no contrato PJ', workflow.contract.lastError ?? 'É necessário corrigir a geração ou o envio do contrato.', 'system', now);
  }
  if (process.accessProvisioning?.status === 'failed' || process.pdvAccess?.status === 'failed') {
    return status(process, 'blocked', 'Falha na criação dos acessos', process.accessProvisioning?.email?.lastError ?? process.pdvAccess?.lastError ?? 'Revise a integração de acesso.', 'system', now);
  }

  if (step === 'provider_registration') {
    return process.publicFormSubmittedAt
      ? status(process, 'hr_action', 'Conferir cadastro da prestadora', 'O cadastro foi recebido e precisa ser revisado pelo RH.', 'rh', now)
      : status(process, 'waiting_person', 'Prestadora precisa completar o cadastro', 'Aguardando o formulário e os documentos da empresa.', 'person', now);
  }
  if (step === 'registration_review') {
    return status(process, 'hr_action', 'RH precisa revisar o cadastro', 'Confira os dados e documentos antes de preparar o contrato.', 'rh', now);
  }
  if (step === 'contract_preparation') {
    return status(process, 'hr_action', 'Preparar e revisar o contrato', 'Defina o representante, gere a minuta e aprove a versão final.', 'rh', now);
  }
  if (step === 'contract_signature') {
    return workflow.contract?.status === 'sent'
      ? status(process, 'waiting_person', 'Aguardando assinaturas do contrato', 'Contratante e prestadora receberam o documento para assinatura.', 'person', now)
      : status(process, 'hr_action', 'Enviar contrato para assinatura', 'A minuta aprovada está pronta para os dois signatários.', 'rh', now);
  }
  if (step === 'financial_registration') {
    if (workflow.finance?.status === 'submitted') {
      return status(process, 'hr_action', 'Financeiro precisa analisar o cadastro', 'Os dados fiscais e bancários estão em análise.', 'third_party', now);
    }
    return status(process, 'hr_action', workflow.finance?.status === 'correction_required' ? 'RH precisa responder ao Financeiro' : 'Enviar cadastro ao Financeiro', workflow.finance?.note ?? 'Conclua o cadastro financeiro e fiscal.', 'rh', now);
  }
  if (step === 'access_configuration') {
    if (process.collaboratorUserId && process.firstAccess?.status !== 'used') {
      return status(process, 'waiting_person', 'Aguardando criação da senha', 'O acesso foi enviado para a pessoa indicada pela prestadora.', 'person', now);
    }
    return status(process, 'hr_action', 'Configurar acessos da prestadora', 'Defina perfil, unidades e eventual acesso ao PDV Legal.', 'rh', now);
  }
  if (step === 'provider_activation') {
    if (process.firstAccess?.status !== 'used') {
      return status(process, 'waiting_person', 'Aguardando primeiro acesso', 'A prestadora precisa cadastrar a senha do Coala One.', 'person', now);
    }
    if (workflow.access?.pdvRequired && process.pdvAccess?.status !== 'completed') {
      return status(process, 'hr_action', 'Concluir acesso ao PDV Legal', 'O acesso adicional ainda não foi confirmado.', 'rh', now);
    }
    return status(process, 'hr_action', 'Ativar a prestadora', 'Todos os requisitos estão prontos para a conclusão.', 'rh', now);
  }

  return status(process, 'on_track', stepLabel, 'Processo PJ em andamento.', 'system', now);
}

function customIntegrationFailure(process: OnboardingProcess) {
  return Object.values(process.integrationV2?.actionResults ?? {}).find(result => result.status === 'failed');
}

function resolveCltStatus(process: OnboardingProcess, now: Date) {
  const required = requiredDocuments(process);
  const missingRequired = required.filter(document => !documentHasFile(document));
  const rejected = required.filter(document => document.status === 'rejected');
  const pendingReview = required.filter(document => documentHasFile(document) && !['approved'].includes(document.status));
  const aso = process.asoWorkflow;
  const accountant = process.accountantWorkflow;
  const signatures = signatureDocuments(process);
  const signatureFailure = signatures.find(document => ['generation_failed', 'generation_blocked', 'send_failed', 'delivery_failed', 'rejected'].includes(document.status ?? ''));
  const customFailure = customIntegrationFailure(process);

  if (onboardingPublicLinkIsExpired(process, now) && !process.publicFormSubmittedAt) {
    return status(process, 'blocked', 'Link de formalização expirado', 'O RH precisa prorrogar ou reabrir o acesso da pessoa.', 'rh', now);
  }
  if (
    signatureFailure
    || customFailure
    || failedCommunication(aso?.clinic?.emailStatus)
    || failedCommunication(aso?.candidateStartNotification?.emailStatus)
    || ['failed', 'rejected', 'approval_expired'].includes(aso?.paymentStatus ?? '')
    || failedCommunication(accountant?.email?.status)
    || process.accessProvisioning?.status === 'failed'
    || process.pdvAccess?.status === 'failed'
  ) {
    return status(
      process,
      'blocked',
      'Processo precisa de correção',
      signatureFailure?.lastError
        ?? customFailure?.error
        ?? accountant?.email?.lastError
        ?? process.accessProvisioning?.email?.lastError
        ?? process.pdvAccess?.lastError
        ?? 'Há uma falha de envio, pagamento, assinatura ou integração.',
      'system',
      now,
    );
  }

  const stage = process.currentStage ?? 'documents';
  if (stage === 'documents') {
    if (!process.publicFormSubmittedAt) {
      return status(process, 'waiting_person', 'Pessoa precisa preencher a formalização', 'Aguardando dados pessoais e documentos obrigatórios.', 'person', now);
    }
    if (rejected.length > 0) {
      return status(process, 'waiting_person', 'Pessoa precisa corrigir documentos', `${rejected.length} documento${rejected.length === 1 ? '' : 's'} precisa${rejected.length === 1 ? '' : 'm'} ser reenviado${rejected.length === 1 ? '' : 's'}.`, 'person', now);
    }
    if (missingRequired.length > 0) {
      return status(process, 'waiting_person', 'Documentos obrigatórios pendentes', `${missingRequired.length} documento${missingRequired.length === 1 ? '' : 's'} ainda não ${missingRequired.length === 1 ? 'foi enviado' : 'foram enviados'}.`, 'person', now);
    }
    return status(process, 'hr_action', 'RH precisa iniciar a conferência', 'Os dados e documentos foram recebidos.', 'rh', now);
  }
  if (stage === 'document_review') {
    if (rejected.length > 0) {
      return status(process, 'waiting_person', 'Aguardando correção de documentos', `${rejected.length} item${rejected.length === 1 ? '' : 's'} devolvido${rejected.length === 1 ? '' : 's'} para correção.`, 'person', now);
    }
    if (pendingReview.length > 0) {
      return status(process, 'hr_action', 'RH precisa revisar documentos', `${pendingReview.length} documento${pendingReview.length === 1 ? '' : 's'} aguarda${pendingReview.length === 1 ? '' : 'm'} aprovação.`, 'rh', now);
    }
    if (aso?.asoDocument?.storagePath && aso.asoDocument.status !== 'approved') {
      return status(process, 'hr_action', 'RH precisa revisar o ASO', 'O documento do exame foi recebido e aguarda decisão.', 'rh', now);
    }
    if (aso?.appointmentStatus === 'confirmed' || aso?.status === 'candidate_notified' || aso?.status === 'awaiting_exam') {
      return status(process, 'waiting_person', 'Aguardando realização do ASO', 'A pessoa já recebeu os dados do agendamento.', 'person', now);
    }
    if (aso?.startedAt) {
      return status(process, 'waiting_person', 'Aguardando retorno da clínica', 'O processo do ASO está em acompanhamento.', 'third_party', now);
    }
    return status(process, 'hr_action', 'RH precisa conduzir o ASO', 'Valide a solicitação, selecione a clínica e inicie o processo.', 'rh', now);
  }
  if (stage === 'accountant') {
    if (accountant?.registryDocument?.status === 'received' || accountant?.registryDocument?.status === 'rejected') {
      return status(process, 'hr_action', 'RH precisa revisar a ficha do contador', 'A Ficha de Registro de Empregado foi devolvida.', 'rh', now);
    }
    if (accountant?.email?.sentAt) {
      return status(process, 'waiting_person', 'Aguardando retorno do contador', 'O pacote admissional foi enviado com o link de devolução.', 'third_party', now);
    }
    return status(process, 'hr_action', 'Preparar envio para a contabilidade', accountant?.latestFormId ? 'Valide o formulário e envie o pacote admissional.' : 'Gere o formulário da contabilidade.', 'rh', now);
  }
  if (stage === 'signature_preparation') {
    return status(process, 'hr_action', 'Preparar documentos para assinatura', 'Selecione os modelos, gere os documentos e conclua a revisão.', 'rh', now);
  }
  if (stage === 'signature') {
    const sent = signatures.some(document => ['sent', 'viewed', 'partially_signed'].includes(document.status ?? ''));
    return sent
      ? status(process, 'waiting_person', 'Aguardando assinaturas', 'Os documentos enviados ainda não foram totalmente assinados.', 'person', now)
      : status(process, 'hr_action', 'Enviar documentos para assinatura', 'Os documentos revisados estão prontos para envio.', 'rh', now);
  }
  if (stage === 'formalization_validation') {
    return process.collaboratorUserId
      ? status(process, 'waiting_person', 'Aguardando primeiro acesso', 'O cadastro foi criado e a senha ainda não foi confirmada.', 'person', now)
      : status(process, 'hr_action', 'Finalizar configurações do colaborador', 'Revise turno, benefícios e permissões antes de criar o acesso.', 'rh', now);
  }
  if (stage === 'integration') {
    if (!process.collaboratorUserId) {
      return status(process, 'hr_action', 'Criar o cadastro do colaborador', 'Salve a validação final e envie o primeiro acesso.', 'rh', now);
    }
    if (process.firstAccess?.status !== 'used') {
      return status(process, 'waiting_person', 'Aguardando criação da senha', 'O primeiro acesso foi enviado ao colaborador.', 'person', now);
    }
    if ((process.integrationAlerts ?? []).some(alert => alert.status !== 'resolved')) {
      return status(process, 'hr_action', 'Sincronizar acessos e integrações', 'Bizneo, PDV ou verificações operacionais ainda estão pendentes.', 'rh', now);
    }
    if (process.integrationV2?.currentStageId) {
      const customStage = process.integrationV2.snapshot.stages.find(item => item.id === process.integrationV2?.currentStageId);
      return status(process, 'hr_action', customStage?.label ?? 'Concluir roteiro configurável', 'Há uma etapa do modelo de integração aguardando execução.', 'rh', now);
    }
    return status(process, 'hr_action', 'Finalizar integração', 'Os requisitos principais foram concluídos.', 'rh', now);
  }
  return status(process, 'on_track', 'Processo em andamento', 'A integração está seguindo o fluxo previsto.', 'system', now);
}

function onboardingPublicLinkIsExpired(process: OnboardingProcess, now: Date) {
  if (process.publicTokenClosedAt) return true;
  const expiresAt = validDate(process.publicTokenExpiresAt);
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
}

export function resolveOnboardingOperationalStatus(process: OnboardingProcess, now = new Date()): OnboardingOperationalStatus {
  if (process.status === 'cancelled') {
    return status(process, 'cancelled', 'Integração encerrada', process.cancelReason ?? 'Processo encerrado sem finalização.', 'none', now);
  }
  if (process.status === 'completed') {
    return status(process, 'completed', 'Integração finalizada', 'Todas as etapas obrigatórias foram concluídas.', 'none', now);
  }
  return process.employmentRelationshipType === 'pj'
    ? resolvePjStatus(process, now)
    : resolveCltStatus(process, now);
}

function dateValue(value?: string | null, fallback = Number.POSITIVE_INFINITY) {
  return validDate(value)?.getTime() ?? fallback;
}

export function sortOnboardingProcesses(
  processes: OnboardingProcess[],
  mode: OnboardingSortMode,
  now = new Date(),
) {
  return [...processes].sort((left, right) => {
    if (mode === 'name') {
      return (left.candidateName ?? '').localeCompare(right.candidateName ?? '', 'pt-BR');
    }
    if (mode === 'admission') {
      return dateValue(left.expectedAdmissionDate) - dateValue(right.expectedAdmissionDate)
        || (left.candidateName ?? '').localeCompare(right.candidateName ?? '', 'pt-BR');
    }
    if (mode === 'stalled') {
      const leftStatus = resolveOnboardingOperationalStatus(left, now);
      const rightStatus = resolveOnboardingOperationalStatus(right, now);
      return dateValue(leftStatus.stageStartedAt, 0) - dateValue(rightStatus.stageStartedAt, 0);
    }
    const leftStatus = resolveOnboardingOperationalStatus(left, now);
    const rightStatus = resolveOnboardingOperationalStatus(right, now);
    return rightStatus.priority - leftStatus.priority
      || rightStatus.overdueDays - leftStatus.overdueDays
      || dateValue(leftStatus.stageStartedAt, 0) - dateValue(rightStatus.stageStartedAt, 0);
  });
}

export function onboardingProgress(process: OnboardingProcess) {
  if (process.employmentRelationshipType === 'pj' && process.pjWorkflow) {
    const currentIndex = PJ_ONBOARDING_STEP_ORDER.indexOf(process.pjWorkflow.currentStep);
    return {
      current: process.status === 'completed' ? PJ_ONBOARDING_STEP_ORDER.length : Math.max(1, currentIndex + 1),
      total: PJ_ONBOARDING_STEP_ORDER.length,
      label: PJ_ONBOARDING_STEP_LABELS[process.pjWorkflow.currentStep],
      steps: PJ_ONBOARDING_STEP_ORDER.map((id: PjOnboardingStepId) => ({
        id,
        label: PJ_ONBOARDING_STEP_LABELS[id],
        state: process.pjWorkflow?.steps[id]?.status === 'completed'
          ? 'done' as const
          : id === process.pjWorkflow?.currentStep
            ? 'active' as const
            : 'pending' as const,
      })),
    };
  }

  if (process.integrationV2 && process.integrationV2.snapshot.stages.length > 0 && (process.stages?.length ?? 0) === 0) {
    const stages = [...process.integrationV2.snapshot.stages].sort((left, right) => left.order - right.order);
    const visible = stages.filter(stage => process.integrationV2?.stageStatuses[stage.id] !== 'skipped');
    const currentIndex = visible.findIndex(stage => stage.id === process.integrationV2?.currentStageId);
    const completed = visible.filter(stage => process.integrationV2?.stageStatuses[stage.id] === 'completed').length;
    const current = process.integrationV2.currentStageId ? Math.max(1, currentIndex + 1) : Math.max(completed, visible.length);
    const currentStage = visible.find(stage => stage.id === process.integrationV2?.currentStageId);
    return {
      current,
      total: visible.length,
      label: currentStage?.label ?? 'Roteiro configurável concluído',
      steps: visible.map(stage => ({
        id: stage.id,
        label: stage.label,
        state: process.integrationV2?.stageStatuses[stage.id] === 'completed'
          ? 'done' as const
          : stage.id === process.integrationV2?.currentStageId
            ? 'active' as const
            : 'pending' as const,
      })),
    };
  }

  const stages = [...(process.stages ?? [])]
    .sort((left, right) => left.order - right.order)
    .filter((stage, index, all) => stage.id !== 'document_review' || !all.some(item => item.id === 'documents'));
  const normalizedCurrent = process.currentStage === 'document_review' ? 'documents' : process.currentStage;
  const currentIndex = stages.findIndex(stage => stage.id === normalizedCurrent);
  const currentStageOrder = stages.find(stage => stage.id === normalizedCurrent)?.order ?? Number.POSITIVE_INFINITY;
  return {
    current: process.status === 'completed' ? stages.length : Math.max(1, currentIndex + 1),
    total: stages.length,
    label: normalizedCurrent === 'documents'
      ? 'Formalização · Dados, documentos e ASO'
      : stages.find(stage => stage.id === normalizedCurrent)?.label ?? 'Formalização',
    steps: stages.map(stage => ({
      id: stage.id,
      label: stage.id === 'documents' ? 'Formalização · Dados, documentos e ASO' : stage.label,
      state: process.status === 'completed' || stage.order < currentStageOrder
        ? 'done' as const
        : stage.id === normalizedCurrent
          ? 'active' as const
          : 'pending' as const,
    })),
  };
}
