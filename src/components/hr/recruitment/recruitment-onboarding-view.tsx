"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { IntegrationSubfieldEditor } from '@/features/hr/integration/IntegrationTemplateManager';
import type { IntegrationTemplateMetadataClient } from '@/features/hr/integration/client';
import { simulateIntegrationTemplate } from '@/features/hr/integration/engine';
import { IntegrationRulesPanel } from '@/features/hr/integration/IntegrationRulePanels';
import { buildProbationSchedule, DEFAULT_PROBATION_FIRST_PERIOD_DAYS, probationConfigForFirstPeriod } from '@/features/hr/integration/probation';
import { probationIsReleasedAfterFormalization } from '@/features/hr/integration/probation-process';
import { PjOnboardingDetailPanel } from '@/features/hr/onboarding-pj/detail-panel';
import type { IntegrationBlock, IntegrationRule, IntegrationStage, IntegrationSubfield, IntegrationTemplateVersion } from '@/features/hr/integration/schemas';
import type { DPShiftDefinition, DPUnit, JobFunction, JobRole, OnboardingDocument, OnboardingFinalizationSettings, OnboardingProcess, OnboardingStageId, OnboardingTrainingItem } from '@/types';
import { applyOnboardingSignatureMode, normalizeOnboardingStages } from '@/lib/recruitment-onboarding';
import { shiftDefinitionMatchesUnit } from '@/lib/dp-shift-definitions';
import { formatPersonName } from '@/lib/person-name';
import { essentialPublicFormDataReady } from '@/features/hr/onboarding/public-form-revision';
import { maritalStatusIsInformed, ONBOARDING_MARITAL_STATUSES } from '@/features/hr/onboarding/marital-status';
import { canUpdateExpectedAdmissionDate } from '@/features/hr/onboarding-lifecycle';
import { resolveTransportVoucherServiceStatus } from '@/features/hr/onboarding/benefit-service-status';
import { formatBrlCurrency, parseBrlCurrency } from '@/features/hr/compensation/brl-currency';
import { isAutomaticAccountantDocument } from '@/features/hr/accountant/document-selection';
import { isPreviewableDocumentContentType } from '@/features/hr/documents/preview-content-type';
import { pdvPendingPasswordMessage } from '@/lib/hr/onboarding-integrations';
import { ONBOARDING_HEALTH_META, resolveOnboardingOperationalStatus, sortOnboardingProcesses, type OnboardingHealth, type OnboardingSortMode } from '@/features/hr/onboarding/operational-status';
import { isAsoAppointmentAfterAdmission } from '@/features/hr/aso/dates';
import { clinicLocationFromConfig, clinicLocationLabel } from '@/features/hr/aso/clinic-location';
import { ASO_GUIDE_TEMPLATE_VERSION } from '@/features/hr/aso/guide-version';
import { shouldPollAsoPayment } from '@/features/hr/aso/payment-status';
import { OnboardingProductionLine } from '@/features/hr/onboarding/production-line';
import { OnboardingDetailNavigation, onboardingConceptualStageNumber } from '@/features/hr/onboarding/detail-navigation';
import { OnboardingDocumentWorkbench } from '@/features/hr/onboarding/document-workbench';
import { readHrJsonResponse } from '@/features/hr/lib/client-response';
import { applicableOnboardingDocuments, presentOnboardingDocumentForAnswers } from '@/features/hr/onboarding/document-applicability';
import { onboardingPublicLinkExpiresAt, onboardingPublicLinkExpired, onboardingPublicLinkExtensionUsed } from '@/lib/hr/onboarding-public-link';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import { UserPlus, Mail, FileText, Calendar, Clock, CheckCircle2, XCircle, ArrowRight, Loader2, X, Trash2, AlertTriangle, Briefcase, ChevronDown, ChevronRight, Paperclip, Archive, Plus, Pencil, FolderOpen, Copy, ArrowLeft, Users, RotateCw, Download, Send, Eye, Wallet, RefreshCw, GraduationCap, Check, FileCheck2, Info, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SignatureParticipantCard } from '@/components/hr/recruitment/signature-participant-card';
import { apiFetch, candidateInitials, ErrorLine, PUBLIC_RECRUITMENT_URL } from './recruitment-shared';

const SignaturePlacementEditor = dynamic(
  () => import('@/components/hr/recruitment/signature-placement-editor'),
  { ssr: false },
);

// ─── OnboardingView ──────────────────────────────────────────────────────────

export const ONBOARDING_STATUS_LABELS: Record<OnboardingProcess['status'], string> = {
  pending_setup: 'Pendente',
  collecting_documents: 'Coletando documentos',
  reviewing_documents: 'Conferindo documentos',
  accountant_pending: 'Aguardando contador',
  contract_pending: 'Contrato pendente',
  ready_to_create_user: 'Criar colaborador',
  awaiting_first_access: 'Aguardando primeiro acesso',
  active: 'Em andamento',
  completed: 'Finalizado',
  cancelled: 'Encerrada',
};

const ONBOARDING_DOCUMENT_STATUS_LABELS: Record<OnboardingDocument['status'], string> = {
  pending: 'Pendente',
  received: 'Enviado',
  ai_approved: 'Aprovado pela Mel',
  review_required: 'Revisão do gestor',
  approved: 'Aprovado pelo RH',
  rejected: 'Reprovado',
};

export const ONBOARDING_STAGE_DETAILS: Record<OnboardingStageId, { owner: string; focus: string }> = {
  documents: {
    owner: 'Candidato + RH',
    focus: 'Dados do candidato, anexos obrigatórios e ASO admissional',
  },
  document_review: {
    owner: 'Candidato + RH',
    focus: 'Conferência dos dados, aprovação dos documentos e conclusão do ASO admissional',
  },
  accountant: {
    owner: 'RH + Contador',
    focus: 'Envio do pacote admissional e recebimento da ficha de registro',
  },
  signature_preparation: {
    owner: 'RH + Candidato',
    focus: 'Seleção, geração e revisão dos documentos admissionais; depois, envio e acompanhamento das assinaturas.',
  },
  signature: {
    owner: 'Candidato + RH',
    focus: 'Seleção, geração e revisão dos documentos admissionais; depois, envio e acompanhamento das assinaturas.',
  },
  formalization_validation: {
    owner: 'RH',
    focus: 'Configurações finais antes dos acessos e do treinamento',
  },
  integration: {
    owner: 'RH + Liderança',
    focus: 'Integração à rotina da empresa',
  },
  probation: {
    owner: 'Liderança',
    focus: 'Acompanhamento de experiência',
  },
  done: {
    owner: 'RH',
    focus: 'Integração finalizada',
  },
};

// Panel type rendered for each stage in the drill-in detail view.
const ONBOARDING_STAGE_KIND: Record<
  OnboardingStageId,
  'coleta' | 'revisao' | 'contador' | 'generico' | 'assinatura' | 'validacao' | 'integracao' | 'experiencia'
> = {
  documents: 'coleta',
  document_review: 'revisao',
  accountant: 'contador',
  signature_preparation: 'assinatura',
  signature: 'assinatura',
  formalization_validation: 'validacao',
  integration: 'integracao',
  probation: 'experiencia',
  done: 'generico',
};

// Stable per-candidate accent colors used on the grid cards and detail avatar.
const ONBOARDING_CARD_COLORS = ['#df2f78', '#7c3aed', '#2563eb', '#008f83', '#d17400', '#c026d3'];

function consolidatedOnboardingPhaseId(stageId?: OnboardingStageId | null) {
  if (stageId === 'document_review') return 'documents';
  if (stageId === 'signature') return 'signature_preparation';
  return stageId;
}

function consolidatedOnboardingStages(process: OnboardingProcess) {
  const stages = applyOnboardingSignatureMode(
    normalizeOnboardingStages(process.stages),
    process.generateSignatureDocuments === true
  );
  let visibleStages = stages;
  const hasCollection = stages.some(stage => stage.id === 'documents');
  const hasReview = stages.some(stage => stage.id === 'document_review');
  if (hasCollection && hasReview) {
    const visibleDocumentStage = process.currentStage === 'documents' ? 'documents' : 'document_review';
    visibleStages = visibleStages
      .filter(stage => stage.id !== (visibleDocumentStage === 'documents' ? 'document_review' : 'documents'))
      .map(stage => stage.id === visibleDocumentStage
        ? { ...stage, label: 'Formalização · Dados, documentos e ASO' }
        : stage);
  }

  const hasSignaturePreparation = stages.some(stage => stage.id === 'signature_preparation');
  const hasSignature = stages.some(stage => stage.id === 'signature');
  if (hasSignaturePreparation && hasSignature) {
    const currentOrder = stages.find(stage => stage.id === process.currentStage)?.order ?? -1;
    const signatureOrder = stages.find(stage => stage.id === 'signature')?.order ?? Number.POSITIVE_INFINITY;
    const visibleSignatureStage: OnboardingStageId = process.currentStage === 'signature_preparation'
      ? 'signature_preparation'
      : process.currentStage === 'signature' || currentOrder > signatureOrder
        ? 'signature'
        : 'signature_preparation';
    visibleStages = visibleStages
      .filter(stage => stage.id !== (visibleSignatureStage === 'signature_preparation' ? 'signature' : 'signature_preparation'))
      .map(stage => stage.id === visibleSignatureStage
        ? { ...stage, label: 'Documentação admissional' }
        : stage);
  }

  return visibleStages.map(stage => stage.id === 'signature_preparation' || stage.id === 'signature'
    ? { ...stage, label: 'Documentação admissional' }
    : stage);
}

type SignatureTemplateOption = {
  id: string;
  name: string;
  category: string;
  version: number;
  documentTypeCode?: string;
  variables?: string[];
};

type SignatureWorkflowDocument = {
  id: string;
  onboardingId: string;
  templateId: string;
  templateName: string;
  documentName?: string;
  selected?: boolean;
  status: string;
  reviewStatus?: string;
  generatedDocumentId?: string;
  generatedStoragePath?: string;
  generatedPdfStoragePath?: string;
  signatureScope?: string;
  missingRequired?: string[];
  lastError?: string | null;
  emailStatus?: string;
  emailSentAt?: string | null;
  emailDeliveredAt?: string | null;
  viewedAt?: string | null;
  signedAt?: string | null;
  archivedAt?: string | null;
  employeeDocumentId?: string | null;
  sandbox?: boolean;
  signatureRequestId?: string | null;
  providerSignaturesCount?: number;
  providerSignedCount?: number;
};

type SignatureWorkflowPayload = {
  templates: SignatureTemplateOption[];
  documents: SignatureWorkflowDocument[];
  packageTemplateIds?: string[];
  signaturePackage?: {
    status: string;
    sandbox: boolean;
    packageHash: string | null;
    pageCount: number | null;
    placementReady: boolean;
    layout: import('@/features/hr/documents/admission-signature-layout').AdmissionSignatureLayout | null;
    signers: Array<{
      party: 'employee' | 'company';
      name: string;
      email: string;
    }>;
    participants: Array<{
      party: 'employee' | 'company';
      name: string;
      email: string;
      avatarUrl?: string | null;
      providerSignatureId: string;
      status: 'sent' | 'viewed' | 'signed' | 'rejected' | 'delivery_failed';
      invitedAt: string | null;
      emailSentAt: string | null;
      emailDeliveredAt: string | null;
      deliveryFailureReason?: string | null;
      emailOpenedAt: string | null;
      viewedAt: string | null;
      signedAt: string | null;
      rejectedAt: string | null;
      lastResentAt?: string | null;
      resendCount?: number;
      signatureLinkGeneratedAt?: string | null;
      lastIp?: string | null;
      lastPort?: number | null;
    }>;
  } | null;
};

const SIGNATURE_WORKFLOW_STATUS_LABELS: Record<string, string> = {
  selected: 'Selecionado',
  generation_failed: 'Falha na geração',
  generation_blocked: 'Dados obrigatórios pendentes',
  review_pending: 'Aguardando revisão do RH',
  ready_to_send: 'Revisado e pronto para envio',
  sending: 'Enviando',
  sent: 'Enviado',
  viewed: 'Aberto pelo titular',
  partially_signed: 'Assinado pelo titular',
  signed: 'Assinado, arquivando',
  signed_archived_pending_employee: 'Assinado e arquivado no processo',
  archived: 'Assinado e arquivado no colaborador',
  rejected: 'Assinatura recusada',
  delivery_failed: 'Falha na entrega',
  send_failed: 'Falha no envio',
};

function formatOnboardingDate(value?: string | null) {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informado';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatOnboardingDateTime(value?: string | null) {
  if (!value) return 'Pendente';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Pendente';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatOnboardingDateOnly(value?: string | null) {
  const match = value?.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Não informada';
}

type AsoProcessStartResult = {
  emails: Array<{
    recipient: string;
    recipientName: string;
    purpose: string;
    status: string;
    providerId?: string | null;
    error?: string | null;
  }>;
  payment: {
    amount: number;
    beneficiary: string;
    maskedDestination: string;
    status: string;
    message: string;
  };
  warning?: string | null;
};

export type AsoPaymentWorkflowPatch = Pick<NonNullable<OnboardingProcess['asoWorkflow']>,
  'paymentRequestId' | 'paymentStatus' | 'paymentProofStoragePath' | 'paymentConfirmedAt'
>;

function asoCommunicationStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    pending: 'Preparando envio',
    accepted: 'Enviado',
    delivered: 'Entregue',
    opened: 'Aberto',
    delayed: 'Entrega atrasada',
    bounced: 'E-mail recusado',
    complained: 'Marcado como spam',
    suppressed: 'Envio suprimido',
    failed: 'Falha no envio',
  };
  return labels[status ?? ''] ?? 'Pendente';
}

type AsoEmailTrackingRecord = {
  emailStatus?: string | null;
  sentAt?: string | null;
  deliveredAt?: string | null;
  openedAt?: string | null;
  clickedAt?: string | null;
  repliedAt?: string | null;
};

function AsoEmailTrackingMilestones({
  communication,
  includeReply = false,
  replyLabel = 'Retorno recebido',
}: {
  communication?: AsoEmailTrackingRecord | null;
  includeReply?: boolean;
  replyLabel?: string;
}) {
  const milestones = [
    { label: 'Enviado', at: communication?.sentAt, completed: Boolean(communication?.sentAt) },
    {
      label: 'Entregue',
      at: communication?.deliveredAt,
      completed: Boolean(communication?.deliveredAt) || communication?.emailStatus === 'delivered',
    },
    { label: 'Aberto', at: communication?.openedAt, completed: Boolean(communication?.openedAt) },
    { label: 'Link acessado', at: communication?.clickedAt, completed: Boolean(communication?.clickedAt) },
    ...(includeReply ? [{ label: replyLabel, at: communication?.repliedAt, completed: Boolean(communication?.repliedAt) }] : []),
  ];

  return (
    <div className="mt-2 grid grid-cols-2 gap-1.5">
      {milestones.map(milestone => {
        const completed = milestone.completed;
        return (
          <div
            key={milestone.label}
            className={`rounded-lg border px-2 py-1.5 ${completed ? 'border-emerald-200 bg-white text-emerald-800' : 'border-slate-200 bg-white/70 text-slate-400'}`}
          >
            <div className="flex items-center gap-1.5">
              {completed ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <Clock className="h-3 w-3 shrink-0" />}
              <span className="text-[9px] font-black uppercase tracking-wide">{milestone.label}</span>
            </div>
            <p className="mt-0.5 pl-[18px] text-[9px] font-semibold tabular-nums">
              {milestone.at ? formatOnboardingDateTime(milestone.at) : completed ? 'Confirmado' : 'Pendente'}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function asoPaymentStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    awaiting_financial_authorization: 'Aguardando autorização do Financeiro',
    ready_to_submit: 'Autorizado para envio ao Banco Inter',
    submitting: 'Enviando ao Banco Inter',
    awaiting_bank_approval: 'Aguardando aprovação no Banco Inter',
    processing: 'Em processamento no Banco Inter',
    paid: 'PIX confirmado',
    rejected: 'PIX rejeitado',
    approval_expired: 'Aprovação bancária expirada',
    failed: 'Falha no processamento bancário',
    cancelled: 'Pagamento cancelado',
  };
  return labels[status ?? ''] ?? 'Pagamento ainda não solicitado';
}

function formatOnboardingLinkRemaining(process: OnboardingProcess, now: number) {
  const expiresAt = onboardingPublicLinkExpiresAt(process);
  if (!expiresAt) return 'Prazo indisponível';
  const remaining = expiresAt.getTime() - now;
  if (remaining <= 0) return 'Prazo expirado';
  const totalMinutes = Math.ceil(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}min restantes`;
}

function readOnboardingAnswer(answers: Record<string, unknown> | undefined, key: string) {
  const value = answers?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : 'Aguardando';
}

function readOnboardingChoice(answers: Record<string, unknown> | undefined, key: string, labels: Record<string, string>) {
  const value = answers?.[key];
  return typeof value === 'string' && labels[value] ? labels[value] : 'Aguardando';
}

function formatOnboardingCpf(value: unknown) {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '').slice(0, 11) : '';
  if (digits.length !== 11) return typeof value === 'string' && value.trim() ? value.trim() : 'Aguardando';
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function readOnboardingList(answers: Record<string, unknown> | undefined, key: string) {
  const value = answers?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(', ') || 'Aguardando'
    : 'Aguardando';
}

function readOnboardingChildren(answers: Record<string, unknown> | undefined) {
  const children = Array.isArray(answers?.children) ? answers.children : [];
  if (children.length === 0) return 'Nenhum';
  return children
    .map((entry, index) => {
      const data = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
      const birthDate = typeof data.birthDate === 'string' && data.birthDate ? formatOnboardingDate(data.birthDate) : 'sem data';
      return `Filho ${index + 1}: ${birthDate}`;
    })
    .join('\n');
}

function onboardingAnswerYes(answers: Record<string, unknown> | undefined, key: string) {
  return answers?.[key] === 'yes';
}

type AccountantFormTextField =
  | 'companyName'
  | 'employerCnpj'
  | 'employeeName'
  | 'maritalStatus'
  | 'employeeCpf'
  | 'educationLevel'
  | 'jobFunction'
  | 'probationContract'
  | 'weeklyRest'
  | 'workSchedule';

type AccountantFormTextDraft = Record<AccountantFormTextField, string>;

const EMPTY_ACCOUNTANT_FORM_TEXT_DRAFT: AccountantFormTextDraft = {
  companyName: '',
  employerCnpj: '',
  employeeName: '',
  maritalStatus: '',
  employeeCpf: '',
  educationLevel: '',
  jobFunction: '',
  probationContract: '',
  weeklyRest: '',
  workSchedule: '',
};
const ACCOUNTANT_FORM_TEXT_FIELDS = Object.keys(EMPTY_ACCOUNTANT_FORM_TEXT_DRAFT) as AccountantFormTextField[];
const ACCOUNTANT_FORM_TEXT_FIELD_CONFIG: Array<{
  key: AccountantFormTextField;
  label: string;
  wide?: boolean;
  options?: readonly string[];
}> = [
  { key: 'companyName', label: 'Empresa contratante' },
  { key: 'employerCnpj', label: 'CNPJ da empresa' },
  { key: 'employeeName', label: 'Nome da candidata' },
  { key: 'employeeCpf', label: 'CPF da candidata' },
  { key: 'maritalStatus', label: 'Estado civil', options: ONBOARDING_MARITAL_STATUSES },
  { key: 'educationLevel', label: 'Escolaridade' },
  { key: 'jobFunction', label: 'Função' },
  { key: 'probationContract', label: 'Contrato de experiência' },
  { key: 'weeklyRest', label: 'Descanso semanal' },
  { key: 'workSchedule', label: 'Jornada de trabalho', wide: true },
];

function onboardingAnswerText(answers: Record<string, unknown> | undefined, key: string) {
  const value = answers?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function accountantFormTextDraftFrom(
  process: OnboardingProcess | null,
  roles: JobRole[],
  jobFunctions: JobFunction[],
): AccountantFormTextDraft {
  if (!process) return { ...EMPTY_ACCOUNTANT_FORM_TEXT_DRAFT };
  const stored = process.accountantWorkflow?.formData ?? {};
  const answers = process.publicFormAnswers;
  const jobFunction = jobFunctions.find((item) => item.id === process.functionId);
  const jobRole = roles.find((item) => item.id === process.jobRoleId);
  const probation = process.probationV2?.config;
  const probationContract = probation
    ? probation.secondPeriodDays > 0
      ? `${probation.firstPeriodDays} dias + ${probation.secondPeriodDays} dias`
      : `${probation.firstPeriodDays} dias`
    : 'Não informado';
  const storedText = (key: AccountantFormTextField) => {
    const value = stored[key];
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  };
  const cnpj = storedText('employerCnpj') || process.employerCnpj || '';
  return {
    companyName: storedText('companyName') || process.employerUnitName || process.unitName || 'Empresa não informada',
    employerCnpj: CnpjValidator.format(cnpj),
    employeeName: storedText('employeeName') || onboardingAnswerText(answers, 'fullName') || process.candidateName || 'Não informado',
    maritalStatus: (storedText('maritalStatus').toLocaleLowerCase('pt-BR') === 'não informado' ? '' : storedText('maritalStatus')) || onboardingAnswerText(answers, 'maritalStatus') || 'Não informado',
    employeeCpf: storedText('employeeCpf') || formatOnboardingCpf(answers?.cpf),
    educationLevel: storedText('educationLevel') || onboardingAnswerText(answers, 'educationLevel') || 'Não informado',
    jobFunction: storedText('jobFunction') || process.functionName || process.jobRoleName || 'Não informada',
    probationContract: storedText('probationContract') || probationContract,
    weeklyRest: storedText('weeklyRest') || 'Conforme escala',
    workSchedule: storedText('workSchedule') || jobFunction?.workSchedule || jobRole?.workSchedule || process.shiftDefinitionName || 'Não informada',
  };
}

function accountantCurrentStepNumber(process: OnboardingProcess) {
  const workflow = process.accountantWorkflow;
  const latestFormId = workflow?.latestFormId;
  const formValidated = Boolean(
    latestFormId
    && workflow?.latestFormRequiresRegeneration !== true
    && workflow?.formValidation?.documentId === latestFormId,
  );
  const documentsConfirmed = Boolean(
    workflow?.email?.sentAt
    || (formValidated && workflow?.documentSelection?.documentId === latestFormId),
  );
  return documentsConfirmed ? 3 : formValidated ? 2 : 1;
}

function getFinalizationDraft(process: OnboardingProcess | null): OnboardingFinalizationSettings {
  if (!process) {
    return {
      operational: false,
      participatesInGoals: false,
      loginRestrictionEnabled: false,
      needsTransportVoucher: false,
      transportVoucherValue: 8.4,
      shiftDefinitionId: '',
    };
  }
  const settings = process.finalizationSettings ?? {};
  return {
    operational: settings.operational ?? false,
    participatesInGoals: settings.participatesInGoals ?? false,
    loginRestrictionEnabled: settings.loginRestrictionEnabled ?? false,
    needsTransportVoucher: settings.needsTransportVoucher ?? onboardingAnswerYes(process.publicFormAnswers, 'wantsTransportVoucher'),
    transportVoucherValue: settings.transportVoucherValue ?? 8.4,
    shiftDefinitionId: settings.shiftDefinitionId ?? process.shiftDefinitionId ?? '',
  };
}

function onboardingProfilePhotoUrl(process: OnboardingProcess) {
  const photo = process.documents?.find(document => (
    document.status === 'approved'
    && (document.id === 'profile_photo' || document.documentTypeCode === 'PROFILE_PHOTO')
    && typeof document.fileUrl === 'string'
    && document.fileUrl.trim().length > 0
  ));
  return photo?.fileUrl?.trim() || null;
}

function OnboardingFinalizationControls({
  value,
  onChange,
  shiftDefinitions,
  unitId,
  disabled = false,
  compact = false,
  transportVoucherMode = 'editable',
  transportVoucherAnswered = true,
}: {
  value: OnboardingFinalizationSettings;
  onChange: React.Dispatch<React.SetStateAction<OnboardingFinalizationSettings>>;
  shiftDefinitions: DPShiftDefinition[];
  unitId?: string | null;
  disabled?: boolean;
  compact?: boolean;
  transportVoucherMode?: 'editable' | 'initial' | 'summary';
  transportVoucherAnswered?: boolean;
}) {
  const [transportVoucherDraft, setTransportVoucherDraft] = useState(() =>
    value.transportVoucherValue == null
      ? ''
      : value.transportVoucherValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  );
  const availableShiftDefinitions = useMemo(() => {
    const active = [...shiftDefinitions];
    if (!unitId) return active.sort((a, b) => a.name.localeCompare(b.name));
    return active
      .filter(definition => shiftDefinitionMatchesUnit(definition, unitId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [shiftDefinitions, unitId]);

  useEffect(() => {
    if (value.transportVoucherValue == null) {
      setTransportVoucherDraft('');
    }
  }, [value.needsTransportVoucher, value.transportVoucherValue]);

  useEffect(() => {
    if (value.shiftDefinitionId && !availableShiftDefinitions.some(item => item.id === value.shiftDefinitionId)) {
      onChange(current => ({ ...current, shiftDefinitionId: null }));
    }
  }, [availableShiftDefinitions, onChange, value.shiftDefinitionId]);

  function patch(next: Partial<OnboardingFinalizationSettings>) {
    onChange(current => ({ ...current, ...next }));
  }

  function handleOperationalChange(next: boolean) {
    patch({
      operational: next,
      ...(next ? { loginRestrictionEnabled: true } : {}),
    });
  }

  return (
    <div className="space-y-3">
      <div className={compact ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}>
        {[
          ['operational', 'Operacional', 'Entra em escala e rotinas operacionais.'],
          ['participatesInGoals', 'Participa de metas', 'Pode entrar nos acompanhamentos de metas.'],
          ['loginRestrictionEnabled', 'Login por escala', 'Acesso passa a respeitar a escala montada.'],
          ...(transportVoucherMode === 'editable'
            ? [['needsTransportVoucher', 'Vale-transporte', 'Usa valor diário por dia trabalhado.']]
            : []),
        ].map(([key, label, helper]) => (
          <label key={key} className="flex min-h-[76px] cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
            <input
              type="checkbox"
              checked={Boolean(value[key as keyof OnboardingFinalizationSettings])}
              onChange={event => {
                if (key === 'operational') {
                  handleOperationalChange(event.target.checked);
                  return;
                }
                patch({
                  [key]: event.target.checked,
                  ...(key === 'needsTransportVoucher' && !event.target.checked ? { transportVoucherValue: null } : {}),
                });
              }}
              disabled={disabled}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-pink-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-bold text-slate-900">{label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-slate-500">{helper}</span>
            </span>
          </label>
        ))}
        {transportVoucherMode !== 'editable' ? (
          <div className="flex min-h-[76px] items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
            <div className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border border-pink-300 bg-pink-50 text-[9px] font-black text-pink-600">
              VT
            </div>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-slate-900">Vale-transporte</span>
              <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                {transportVoucherMode === 'initial'
                  ? 'A colaboradora responderá se deseja receber no link da integração.'
                  : transportVoucherAnswered
                    ? `Resposta da colaboradora: ${value.needsTransportVoucher ? 'Sim' : 'Não'}.`
                    : 'Aguardando a resposta da colaboradora.'}
              </span>
            </span>
          </div>
        ) : null}
      </div>

      <div className={compact && (transportVoucherMode !== 'editable' || value.needsTransportVoucher) ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}>
        {transportVoucherMode !== 'editable' || value.needsTransportVoucher ? (
          <label className="block text-sm font-semibold text-slate-700">
            Valor diário do VT definido pelo RH
            <input
              type="text"
              value={transportVoucherDraft}
              onChange={event => {
                const draft = event.target.value;
                setTransportVoucherDraft(draft);
                const normalized = draft
                  .replace(/[^\d,.]/g, '')
                  .replace(/\./g, '')
                  .replace(',', '.');
                const parsed = normalized ? Number(normalized) : Number.NaN;
                const numericValue = Number.isFinite(parsed) ? Math.max(0, parsed) : null;
                patch({ transportVoucherValue: numericValue });
              }}
              onBlur={() => {
                if (value.transportVoucherValue == null) {
                  setTransportVoucherDraft('');
                  return;
                }
                setTransportVoucherDraft(value.transportVoucherValue.toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                }));
              }}
              disabled={disabled || transportVoucherMode === 'summary'}
              inputMode="decimal"
              className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
              placeholder="R$ 0,00"
            />
          </label>
        ) : null}

        <label className="block text-sm font-semibold text-slate-700">
          Turno previsto
          <select
            value={value.shiftDefinitionId ?? ''}
            onChange={event => patch({ shiftDefinitionId: event.target.value || null })}
            disabled={disabled}
            className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
          >
            <option value="">Sem turno definido</option>
            {availableShiftDefinitions.map(definition => (
              <option key={definition.id} value={definition.id}>
                {definition.name} ({definition.startTime}-{definition.endTime})
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

type PjStartScopeItem = { id: string; front: string; deliverable: string };

function PjOnboardingStartForm({
  units,
  getToken,
  onBack,
  onClose,
  onCreated,
}: {
  units: DPUnit[];
  getToken: () => Promise<string>;
  onBack: () => void;
  onClose: () => void;
  onCreated: (process: OnboardingProcess) => void;
}) {
  const [providerCnpj, setProviderCnpj] = useState('');
  const [providerLegalName, setProviderLegalName] = useState('');
  const [providerTradeName, setProviderTradeName] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [employerUnitId, setEmployerUnitId] = useState('');
  const [contractStartDate, setContractStartDate] = useState('');
  const [termType, setTermType] = useState<'fixed' | 'indefinite'>('indefinite');
  const [contractEndDate, setContractEndDate] = useState('');
  const [monthlyValue, setMonthlyValue] = useState('');
  const [paymentDay, setPaymentDay] = useState('');
  const [serviceItems, setServiceItems] = useState<PjStartScopeItem[]>([
    { id: crypto.randomUUID(), front: '', deliverable: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const employerUnits = useMemo(
    () => units.filter(unit => unit.isArchived !== true && CnpjValidator.validate(unit.cnpj ?? '').valid),
    [units],
  );

  function patchService(id: string, key: 'front' | 'deliverable', value: string) {
    setServiceItems(current => current.map(item => item.id === id ? { ...item, [key]: value } : item));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const numericValue = Number(monthlyValue.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));
      const result = await apiFetch('/api/hr/onboarding', getToken, {
        method: 'POST',
        body: JSON.stringify({
          employmentRelationshipType: 'pj',
          providerCnpj,
          providerLegalName,
          providerTradeName: providerTradeName || null,
          candidateEmail: candidateEmail.trim().toLowerCase(),
          employerUnitId,
          contractStartDate,
          termType,
          contractEndDate: termType === 'fixed' ? contractEndDate : null,
          monthlyValue: numericValue,
          paymentDay: Number(paymentDay),
          serviceItems,
        }),
      });
      if (!result?.process) throw new Error('Integração criada, mas a resposta veio incompleta.');
      onCreated(result.process as OnboardingProcess);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao iniciar a integração PJ.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex items-center justify-between rounded-xl border border-violet-100 bg-violet-50 px-3 py-2.5">
          <div>
            <p className="text-xs font-black text-violet-900">Integração de prestadora PJ</p>
            <p className="mt-0.5 text-[11px] font-semibold text-violet-700">O contrato é único e a nota fiscal será obrigatória.</p>
          </div>
          <button type="button" onClick={onBack} className="text-xs font-black text-violet-700">Trocar vínculo</button>
        </div>

        <section className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">Empresa prestadora</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-bold text-slate-700">CNPJ
              <input value={providerCnpj} onChange={event => setProviderCnpj(CnpjValidator.format(event.target.value))} required className="mt-1 h-9 w-full rounded-lg border px-3 text-xs" placeholder="00.000.000/0000-00" />
            </label>
            <label className="text-xs font-bold text-slate-700">Razão social
              <input value={providerLegalName} onChange={event => setProviderLegalName(event.target.value)} required className="mt-1 h-9 w-full rounded-lg border px-3 text-xs" />
            </label>
            <label className="text-xs font-bold text-slate-700">Nome fantasia <span className="font-semibold text-slate-400">(opcional)</span>
              <input value={providerTradeName} onChange={event => setProviderTradeName(event.target.value)} className="mt-1 h-9 w-full rounded-lg border px-3 text-xs" />
            </label>
            <label className="text-xs font-bold text-slate-700">E-mail da prestadora
              <input type="email" value={candidateEmail} onChange={event => setCandidateEmail(event.target.value)} required className="mt-1 h-9 w-full rounded-lg border px-3 text-xs" />
              <span className="mt-1 block text-[10px] font-semibold leading-relaxed text-slate-500">Será usado no cadastro, contrato, assinatura e acessos.</span>
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">Condições da contratação</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-bold text-slate-700 md:col-span-2">Empresa contratante
              <select value={employerUnitId} onChange={event => setEmployerUnitId(event.target.value)} required className="mt-1 h-9 w-full rounded-lg border bg-white px-3 text-xs">
                <option value="">Selecione a empresa</option>
                {employerUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name} · {CnpjValidator.format(unit.cnpj ?? '')}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-700">Data de início
              <input type="date" value={contractStartDate} onChange={event => setContractStartDate(event.target.value)} required className="mt-1 h-9 w-full rounded-lg border px-3 text-xs" />
            </label>
            <label className="text-xs font-bold text-slate-700">Prazo
              <select value={termType} onChange={event => setTermType(event.target.value as 'fixed' | 'indefinite')} className="mt-1 h-9 w-full rounded-lg border bg-white px-3 text-xs">
                <option value="indefinite">Indeterminado</option>
                <option value="fixed">Determinado</option>
              </select>
            </label>
            {termType === 'fixed' ? <label className="text-xs font-bold text-slate-700">Data de término
              <input type="date" value={contractEndDate} onChange={event => setContractEndDate(event.target.value)} required className="mt-1 h-9 w-full rounded-lg border px-3 text-xs" />
            </label> : null}
            <label className="text-xs font-bold text-slate-700">Valor mensal
              <input value={monthlyValue} onChange={event => setMonthlyValue(event.target.value)} required inputMode="decimal" className="mt-1 h-9 w-full rounded-lg border px-3 text-xs" placeholder="R$ 0,00" />
            </label>
            <label className="text-xs font-bold text-slate-700">Dia do pagamento
              <input type="number" min={1} max={31} value={paymentDay} onChange={event => setPaymentDay(event.target.value)} required className="mt-1 h-9 w-full rounded-lg border px-3 text-xs" placeholder="Ex.: 10" />
            </label>
          </div>
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-800">A apresentação da nota fiscal será obrigatória para todos os pagamentos.</p>
        </section>

        <section className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-black uppercase tracking-wide text-slate-500">Escopo e entregáveis</p><p className="mt-1 text-[11px] font-semibold text-slate-500">Os itens preencherão o Anexo I do contrato.</p></div>
            <button type="button" onClick={() => setServiceItems(current => [...current, { id: crypto.randomUUID(), front: '', deliverable: '' }])} className="inline-flex h-8 items-center gap-1 rounded-lg bg-violet-100 px-3 text-[11px] font-black text-violet-800"><Plus className="h-3.5 w-3.5" />Adicionar</button>
          </div>
          <div className="mt-3 space-y-2">
            {serviceItems.map((item, index) => <div key={item.id} className="grid gap-2 rounded-xl border bg-slate-50 p-3 md:grid-cols-[42px_1fr_1.4fr_34px]">
              <span className="pt-2 text-xs font-black text-slate-400">1.{index + 1}</span>
              <input value={item.front} onChange={event => patchService(item.id, 'front', event.target.value)} required className="h-9 rounded-lg border bg-white px-3 text-xs" placeholder="Frente" />
              <textarea value={item.deliverable} onChange={event => patchService(item.id, 'deliverable', event.target.value)} required rows={2} className="min-h-9 rounded-lg border bg-white px-3 py-2 text-xs" placeholder="Entregável" />
              <button type="button" disabled={serviceItems.length === 1} onClick={() => setServiceItems(current => current.filter(entry => entry.id !== item.id))} className="grid h-9 place-items-center text-rose-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
            </div>)}
          </div>
        </section>
        {error ? <ErrorLine msg={error} /> : null}
      </div>
      <div className="flex justify-end gap-2 border-t px-4 py-3">
        <button type="button" onClick={onClose} className="h-9 rounded-lg border px-4 text-xs font-bold text-slate-600">Cancelar</button>
        <button type="submit" disabled={submitting} className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-700 px-4 text-xs font-black text-white disabled:opacity-60">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Criar e enviar convite</button>
      </div>
    </form>
  );
}

function StartOnboardingModal({
  roles,
  jobFunctions,
  units,
  shiftDefinitions,
  getToken,
  onClose,
  onCreated,
}: {
  roles: JobRole[];
  jobFunctions: JobFunction[];
  units: DPUnit[];
  shiftDefinitions: DPShiftDefinition[];
  getToken: () => Promise<string>;
  onClose: () => void;
  onCreated: (process: OnboardingProcess) => void;
}) {
  const [integrationMode, setIntegrationMode] = useState<'import' | 'blank' | null>(null);
  const [integrationTemplateId, setIntegrationTemplateId] = useState('');
  const [compatibleTemplates, setCompatibleTemplates] = useState<IntegrationTemplateMetadataClient[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [formStep, setFormStep] = useState<1 | 2 | 3>(1);
  const [candidateName, setCandidateName] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [jobRoleId, setJobRoleId] = useState('');
  const [functionId, setFunctionId] = useState('');
  const [employmentRelationshipType, setEmploymentRelationshipType] = useState<'' | 'clt' | 'pj'>('');
  const [unitId, setUnitId] = useState('');
  const [employerUnitId, setEmployerUnitId] = useState('');
  const [expectedAdmissionDate, setExpectedAdmissionDate] = useState('');
  const [probationFirstPeriodDays, setProbationFirstPeriodDays] = useState(String(DEFAULT_PROBATION_FIRST_PERIOD_DAYS));
  const [finalizationSettings, setFinalizationSettings] = useState<OnboardingFinalizationSettings>(() => getFinalizationDraft(null));
  const [generateSignatureDocuments, setGenerateSignatureDocuments] = useState(false);
  const [requiresPdvAccess, setRequiresPdvAccess] = useState(false);
  const [pdvProfileId, setPdvProfileId] = useState('');
  const [pdvProfiles, setPdvProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingPdvProfiles, setLoadingPdvProfiles] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeRoles = useMemo(
    () => roles.filter(role => role.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [roles]
  );
  const availableFunctions = useMemo(() => {
    const active = jobFunctions.filter(item => item.isActive !== false);
    if (!jobRoleId) return active.sort((a, b) => a.name.localeCompare(b.name));
    return active
      .filter(item => {
        const compatible = item.compatibleRoleIds ?? [];
        return compatible.length === 0 || compatible.includes(jobRoleId);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [jobFunctions, jobRoleId]);
  const activeUnits = useMemo(
    () => [...units].sort((a, b) => a.name.localeCompare(b.name)),
    [units]
  );
  const employerUnits = useMemo(
    () => activeUnits.filter(unit => CnpjValidator.validate(unit.cnpj ?? '').valid),
    [activeUnits],
  );
  const probationPreview = useMemo(() => {
    try {
      const config = probationConfigForFirstPeriod(Number(probationFirstPeriodDays));
      return {
        config,
        schedule: expectedAdmissionDate ? buildProbationSchedule(expectedAdmissionDate, config) : null,
      };
    } catch {
      return null;
    }
  }, [expectedAdmissionDate, probationFirstPeriodDays]);

  useEffect(() => {
    if (functionId && !availableFunctions.some(item => item.id === functionId)) {
      setFunctionId('');
    }
  }, [availableFunctions, functionId]);

  useEffect(() => {
    if (integrationMode !== 'import') {
      setCompatibleTemplates([]);
      setIntegrationTemplateId('');
      return;
    }
    let active = true;
    setLoadingTemplates(true);
    void apiFetch('/api/hr/integration-templates?status=published', getToken)
      .then(payload => {
        if (!active) return;
        const templates = Array.isArray(payload?.templates) ? payload.templates as IntegrationTemplateMetadataClient[] : [];
        setCompatibleTemplates(templates.sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name)));
      })
      .catch(caught => active && setError(caught instanceof Error ? caught.message : 'Falha ao carregar modelos.'))
      .finally(() => active && setLoadingTemplates(false));
    return () => { active = false; };
  }, [getToken, integrationMode]);

  const selectedIntegrationTemplate = useMemo(
    () => compatibleTemplates.find(template => template.id === integrationTemplateId) ?? null,
    [compatibleTemplates, integrationTemplateId],
  );

  function selectIntegrationTemplate(template: IntegrationTemplateMetadataClient) {
    setIntegrationTemplateId(template.id);
    setJobRoleId(template.roleId);
    setFunctionId(template.functionId ?? '');
    setFormStep(1);
    setError(null);
  }

  function resetIntegrationMode() {
    setIntegrationMode(null);
    setIntegrationTemplateId('');
    setJobRoleId('');
    setFunctionId('');
    setFormStep(1);
    setError(null);
  }

  function continueToAccessStep() {
    const normalizedCandidateName = formatPersonName(candidateName);
    const normalizedCandidateEmail = candidateEmail.trim().toLowerCase();
    setCandidateName(normalizedCandidateName);
    setCandidateEmail(normalizedCandidateEmail);
    setError(null);
    if (!normalizedCandidateName) {
      setError('Informe o nome da pessoa em integração.');
      return;
    }
    if (!normalizedCandidateEmail || !normalizedCandidateEmail.includes('@')) {
      setError('Informe um e-mail válido.');
      return;
    }
    if (!jobRoleId) {
      setError('Selecione o cargo da integração.');
      return;
    }
    if (!functionId) {
      setError('Selecione a função da integração.');
      return;
    }
    if (!unitId) {
      setError('Selecione a unidade onde a pessoa trabalhará.');
      return;
    }
    if (!employerUnitId) {
      setError('Selecione o CNPJ responsável pela contratação.');
      return;
    }
    if (!probationPreview) {
      setError('Informe um primeiro período de experiência válido, entre 1 e 89 dias.');
      return;
    }
    setFormStep(2);
  }

  function continueToReviewStep() {
    setError(null);
    if (finalizationSettings.transportVoucherValue == null) {
      setError('Informe o valor diário do vale-transporte, mesmo quando for R$ 0,00.');
      return;
    }
    if (requiresPdvAccess && !activeUnits.find(unit => unit.id === unitId)?.pdvFilialId) {
      setError('A unidade selecionada ainda não possui uma filial do PDV Legal vinculada.');
      return;
    }
    if (requiresPdvAccess && !pdvProfileId) {
      setError('Selecione o perfil de acesso do PDV Legal.');
      return;
    }
    setFormStep(3);
  }

  useEffect(() => {
    if (!requiresPdvAccess) return;
    let active = true;
    setLoadingPdvProfiles(true);
    void apiFetch('/api/hr/integrations/pdvlegal/catalog', getToken)
      .then(payload => {
        if (!active) return;
        const profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
        setPdvProfiles(profiles);
        setPdvProfileId(current => profiles.some((item: { id: string }) => item.id === current) ? current : '');
      })
      .catch(caught => active && setError(caught instanceof Error ? caught.message : 'Falha ao carregar perfis do PDV Legal.'))
      .finally(() => active && setLoadingPdvProfiles(false));
    return () => { active = false; };
  }, [getToken, requiresPdvAccess]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedCandidateName = formatPersonName(candidateName);
    const normalizedCandidateEmail = candidateEmail.trim().toLowerCase();
    setCandidateName(normalizedCandidateName);
    setCandidateEmail(normalizedCandidateEmail);
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch('/api/hr/onboarding', getToken, {
        method: 'POST',
        body: JSON.stringify({
          candidateName: normalizedCandidateName,
          candidateEmail: normalizedCandidateEmail,
          jobRoleId,
          functionId,
          employmentRelationshipType,
          unitId: unitId || null,
          employerUnitId,
          shiftDefinitionId: finalizationSettings.shiftDefinitionId || null,
          expectedAdmissionDate: expectedAdmissionDate || null,
          probationFirstPeriodDays: Number(probationFirstPeriodDays),
          operational: finalizationSettings.operational ?? false,
          participatesInGoals: finalizationSettings.participatesInGoals ?? false,
          loginRestrictionEnabled: finalizationSettings.loginRestrictionEnabled ?? false,
          transportVoucherValue: finalizationSettings.transportVoucherValue ?? null,
          generateSignatureDocuments,
          integrationMode,
          integrationTemplateId: integrationMode === 'import' ? integrationTemplateId : null,
          requiresPdvAccess,
          pdvProfileId: requiresPdvAccess ? pdvProfileId : null,
        }),
      });
      if (!result?.process) throw new Error('Integração criada, mas a resposta veio incompleta.');
      onCreated(result.process as OnboardingProcess);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao iniciar integração.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-pink-600">Integração avulsa</p>
            <h2 className="mt-1 text-base font-black text-slate-950">Nova integração</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Inicie a formalização sem depender do funil de recrutamento.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!employmentRelationshipType ? (
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <button type="button" onClick={() => setEmploymentRelationshipType('clt')} className="rounded-xl border-2 border-slate-200 p-5 text-left transition hover:border-pink-300 hover:bg-pink-50/40">
              <Users className="h-7 w-7 text-pink-600" />
              <span className="mt-3 block text-base font-black text-slate-950">CLT</span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-500">Admissão trabalhista com documentos, ASO e contabilidade.</span>
            </button>
            <button type="button" onClick={() => setEmploymentRelationshipType('pj')} className="rounded-xl border-2 border-slate-200 p-5 text-left transition hover:border-violet-300 hover:bg-violet-50/40">
              <Briefcase className="h-7 w-7 text-violet-700" />
              <span className="mt-3 block text-base font-black text-slate-950">Pessoa jurídica (PJ)</span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-500">Contratação de empresa prestadora com contrato e cadastro fiscal próprios.</span>
            </button>
          </div>
        ) : employmentRelationshipType === 'pj' ? (
          <PjOnboardingStartForm units={units} getToken={getToken} onBack={() => setEmploymentRelationshipType('')} onClose={onClose} onCreated={onCreated} />
        ) : !integrationMode ? (
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <button type="button" onClick={() => setIntegrationMode('import')} className="rounded-xl border-2 border-slate-200 p-5 text-left transition hover:border-pink-300 hover:bg-pink-50/40">
              <FolderOpen className="h-7 w-7 text-pink-600" />
              <span className="mt-3 block text-base font-black text-slate-950">Importar modelo</span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-500">Escolha primeiro um modelo publicado. Cargo e função serão preenchidos por ele.</span>
            </button>
            <button type="button" onClick={() => setIntegrationMode('blank')} className="rounded-xl border-2 border-slate-200 p-5 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40">
              <Plus className="h-7 w-7 text-indigo-600" />
              <span className="mt-3 block text-base font-black text-slate-950">Nova integração</span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-500">Comece do zero somente para esta situação. Nenhum modelo existente será alterado.</span>
            </button>
          </div>
        ) : integrationMode === 'import' && !integrationTemplateId ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-black text-slate-950">Escolha o modelo de integração</p>
                  <p className="mt-1 text-xs text-slate-500">O modelo define o cargo, a função e as etapas que serão aplicadas.</p>
                </div>
                <button type="button" onClick={resetIntegrationMode} className="text-xs font-black text-pink-600">Voltar</button>
              </div>

              {loadingTemplates ? (
                <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando modelos publicados...
                </div>
              ) : compatibleTemplates.length > 0 ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {compatibleTemplates.map(template => {
                    const roleName = activeRoles.find(role => role.id === template.roleId)?.name ?? 'Cargo não encontrado';
                    const functionName = template.functionId
                      ? jobFunctions.find(item => item.id === template.functionId)?.name ?? 'Função não encontrada'
                      : 'Função será escolhida na próxima etapa';
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => selectIntegrationTemplate(template)}
                        className="rounded-xl border-2 border-slate-200 p-4 text-left transition hover:border-pink-300 hover:bg-pink-50/40"
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="text-sm font-black text-slate-950">{template.name}</span>
                          {template.isDefault ? <span className="rounded-full bg-pink-100 px-2 py-1 text-[10px] font-black text-pink-700">Padrão</span> : null}
                        </span>
                        <span className="mt-2 block text-xs font-semibold text-slate-600">{roleName} · {functionName}</span>
                        <span className="mt-1 block text-[11px] text-slate-400">Versão publicada {template.currentVersion}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5 text-center">
                  <p className="text-sm font-bold text-amber-900">Nenhum modelo publicado disponível.</p>
                  <p className="mt-1 text-xs text-amber-700">Publique um modelo ou inicie uma integração criada do zero.</p>
                  <button type="button" onClick={() => setIntegrationMode('blank')} className="mt-4 h-9 rounded-lg bg-slate-950 px-4 text-xs font-black text-white">Criar do zero</button>
                </div>
              )}
              {error ? <div className="mt-4"><ErrorLine msg={error} /></div> : null}
            </div>
          </div>
        ) : <form onSubmit={formStep === 1 ? event => { event.preventDefault(); continueToAccessStep(); } : formStep === 2 ? event => { event.preventDefault(); continueToReviewStep(); } : handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-slate-100 px-5 py-3">
            <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 sm:gap-3">
              <button type="button" onClick={() => setFormStep(1)} className={`flex items-center gap-2 text-left ${formStep === 1 ? 'text-pink-700' : 'text-slate-500'}`}>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${formStep === 1 ? 'bg-pink-600 text-white' : 'bg-emerald-100 text-emerald-700'}`}>{formStep > 1 ? '✓' : '1'}</span>
                <span><span className="block text-xs font-black">Identificação</span><span className="hidden text-[10px] font-medium sm:block">Pessoa, cargo e vínculo</span></span>
              </button>
              <span className="h-px w-5 bg-slate-200 sm:w-10" />
              <button type="button" disabled={formStep === 1} onClick={() => setFormStep(2)} className={`flex items-center justify-center gap-2 text-left ${formStep === 2 ? 'text-pink-700' : formStep > 2 ? 'text-slate-500' : 'text-slate-400'}`}>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${formStep === 2 ? 'bg-pink-600 text-white' : formStep > 2 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>{formStep > 2 ? '✓' : '2'}</span>
                <span><span className="block text-xs font-black">Acessos e comportamento</span><span className="hidden text-[10px] font-medium sm:block">Sistema, PDV e benefícios</span></span>
              </button>
              <span className="h-px w-5 bg-slate-200 sm:w-10" />
              <div className={`flex items-center justify-end gap-2 text-left ${formStep === 3 ? 'text-pink-700' : 'text-slate-400'}`}>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${formStep === 3 ? 'bg-pink-600 text-white' : 'bg-slate-100 text-slate-400'}`}>3</span>
                <span><span className="block text-xs font-black">Revisão</span><span className="hidden text-[10px] font-medium sm:block">Confira antes de iniciar</span></span>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {formStep === 1 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <span className="block text-xs font-black text-slate-800">{integrationMode === 'import' ? selectedIntegrationTemplate?.name ?? 'Modelo publicado' : 'Integração criada do zero'}</span>
                    {integrationMode === 'import' ? <span className="mt-0.5 block text-[11px] text-slate-500">Cargo e função definidos pelo modelo selecionado.</span> : null}
                  </div>
                  <button type="button" onClick={integrationMode === 'import' ? () => { setIntegrationTemplateId(''); setFormStep(1); setError(null); } : resetIntegrationMode} className="shrink-0 text-xs font-black text-pink-600">{integrationMode === 'import' ? 'Trocar modelo' : 'Trocar'}</button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    Nome da pessoa
                    <input value={candidateName} onChange={event => setCandidateName(event.target.value)} onBlur={event => setCandidateName(formatPersonName(event.target.value))} required className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" placeholder="Nome completo" />
                    <span className="mt-1.5 block text-xs font-medium leading-snug text-slate-500">Use o nome completo com iniciais maiúsculas.</span>
                  </label>
                  <label className="block text-sm font-semibold text-slate-700">
                    E-mail para envio
                    <input type="email" value={candidateEmail} onChange={event => setCandidateEmail(event.target.value)} onBlur={event => setCandidateEmail(event.target.value.trim().toLowerCase())} required className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" placeholder="nome@email.com" />
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    Cargo
                    <select value={jobRoleId} onChange={event => setJobRoleId(event.target.value)} required disabled={integrationMode === 'import'} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-600">
                      <option value="">Selecione o cargo</option>
                      {activeRoles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-slate-700">
                    Função
                    <select value={functionId} onChange={event => setFunctionId(event.target.value)} required disabled={integrationMode === 'import' && Boolean(selectedIntegrationTemplate?.functionId)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-600">
                      <option value="">Selecione a função</option>
                      {availableFunctions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-pink-100 bg-pink-50 px-3 py-2.5 text-xs font-bold text-pink-800">
                  <span>Vínculo: CLT</span>
                  <button type="button" onClick={() => { setEmploymentRelationshipType(''); resetIntegrationMode(); }} className="font-black">Trocar</button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    Unidade <span className="text-rose-500">*</span>
                    <select value={unitId} onChange={event => setUnitId(event.target.value)} required className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                      <option value="">Selecione a unidade</option>
                      {activeUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-slate-700">
                    CNPJ responsável pela contratação <span className="text-rose-500">*</span>
                    <select value={employerUnitId} onChange={event => setEmployerUnitId(event.target.value)} required className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                      <option value="">Selecione a empresa responsável</option>
                      {employerUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name} · {CnpjValidator.format(unit.cnpj ?? '')}</option>)}
                    </select>
                    <span className="mt-1.5 block text-xs font-medium text-slate-500">Pode ser diferente da unidade onde a pessoa trabalhará.</span>
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    Data prevista de admissão <span className="text-rose-500">*</span>
                    <input type="date" value={expectedAdmissionDate} onChange={event => setExpectedAdmissionDate(event.target.value)} required className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                  </label>
                  <label className="block text-sm font-semibold text-slate-700">
                    1º período de experiência <span className="text-rose-500">*</span>
                    <div className="mt-1.5 flex h-10 items-center rounded-xl border border-slate-200 bg-white focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
                      <input type="number" min="1" max="89" step="1" value={probationFirstPeriodDays} onChange={event => setProbationFirstPeriodDays(event.target.value)} required className="h-full min-w-0 flex-1 rounded-xl bg-transparent px-3 text-sm text-slate-900 outline-none" />
                      <span className="pr-3 text-xs font-bold text-slate-400">dias</span>
                    </div>
                  </label>
                </div>
                {probationPreview ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                    <p className="text-xs font-black text-amber-900">2º período calculado automaticamente: {probationPreview.config.secondPeriodDays} dias</p>
                    <p className="mt-1 text-xs font-semibold text-amber-700">
                      Total de 90 dias
                      {probationPreview.schedule ? ` · 1º período até ${formatOnboardingDateOnly(probationPreview.schedule.firstPeriod.endDate)} · contrato até ${formatOnboardingDateOnly(probationPreview.schedule.finalEndDate)}` : ' · as datas serão calculadas a partir da admissão'}.
                    </p>
                  </div>
                ) : (
                  <ErrorLine msg="O primeiro período deve ter entre 1 e 89 dias." />
                )}
                {error ? <ErrorLine msg={error} /> : null}
              </div>
            ) : formStep === 2 ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Acesso ao PDV Legal</p>
                    <div className="mt-3 flex gap-5 text-sm font-bold text-slate-700">
                      <label className="flex items-center gap-2"><input type="radio" name="pdvAccess" checked={!requiresPdvAccess} onChange={() => { setRequiresPdvAccess(false); setPdvProfileId(''); }} />Não</label>
                      <label className="flex items-center gap-2"><input type="radio" name="pdvAccess" checked={requiresPdvAccess} onChange={() => setRequiresPdvAccess(true)} />Sim</label>
                    </div>
                    {requiresPdvAccess ? (
                      <div className="mt-3 space-y-2">
                        <label className="block text-sm font-semibold text-slate-700">
                          Perfil de acesso
                          <select value={pdvProfileId} onChange={event => setPdvProfileId(event.target.value)} required disabled={loadingPdvProfiles} className="mt-1.5 h-10 w-full rounded-xl border border-blue-200 bg-white px-3 text-sm">
                            <option value="">{loadingPdvProfiles ? 'Sincronizando perfis...' : 'Selecione o perfil do PDV'}</option>
                            {pdvProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                          </select>
                        </label>
                        <p className="text-xs font-semibold text-blue-700">{activeUnits.find(unit => unit.id === unitId)?.pdvFilialId ? `Filial vinculada à unidade ${activeUnits.find(unit => unit.id === unitId)?.name}.` : 'Esta unidade ainda não possui filial do PDV vinculada.'}</p>
                      </div>
                    ) : null}
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <input type="checkbox" checked={generateSignatureDocuments} onChange={event => setGenerateSignatureDocuments(event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-pink-600" />
                    <span><span className="block text-sm font-bold text-slate-900">Gerar documentos</span><span className="block text-xs text-slate-500">Inclui as etapas de geração e assinatura.</span></span>
                  </label>

                  <div className="flex items-start gap-2.5 rounded-xl border border-pink-200 bg-pink-50 px-3.5 py-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-pink-600" />
                    <span className="text-xs font-semibold leading-snug text-pink-700">O link será válido por 72 horas e poderá receber uma única prorrogação de 24 horas pelo RH.</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Comportamento no sistema</p>
                  <OnboardingFinalizationControls value={finalizationSettings} onChange={setFinalizationSettings} shiftDefinitions={shiftDefinitions} unitId={unitId} compact transportVoucherMode="initial" />
                </div>
                {error ? <div className="lg:col-span-2"><ErrorLine msg={error} /></div> : null}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="text-xs font-black uppercase tracking-wider text-emerald-700">Pronto para iniciar</p>
                  <p className="mt-1 text-sm font-bold text-emerald-950">Confira os dados e os acessos. A criação envia o convite imediatamente.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ['Pessoa', candidateName],
                    ['E-mail', candidateEmail],
                    ['Cargo e função', `${activeRoles.find(role => role.id === jobRoleId)?.name ?? '—'} · ${availableFunctions.find(item => item.id === functionId)?.name ?? '—'}`],
                    ['Unidade', activeUnits.find(unit => unit.id === unitId)?.name ?? '—'],
                    ['Empresa contratante', employerUnits.find(unit => unit.id === employerUnitId)?.name ?? '—'],
                    ['Admissão prevista', expectedAdmissionDate ? formatOnboardingDateOnly(expectedAdmissionDate) : 'A definir'],
                    ['Período de experiência', probationPreview ? `${probationPreview.config.firstPeriodDays} + ${probationPreview.config.secondPeriodDays} dias` : '—'],
                    ['PDV Legal', requiresPdvAccess ? pdvProfiles.find(profile => profile.id === pdvProfileId)?.name ?? 'Perfil não definido' : 'Não solicitado'],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                      <span className="block text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</span>
                      <span className="mt-1 block text-sm font-bold text-slate-800">{value}</span>
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <span className={`rounded-xl border px-3 py-2.5 text-xs font-bold ${generateSignatureDocuments ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>Documentos para assinatura: {generateSignatureDocuments ? 'sim' : 'não'}</span>
                  <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-600">Operacional: {finalizationSettings.operational ? 'sim' : 'não'}</span>
                  <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-600">Participa de metas: {finalizationSettings.participatesInGoals ? 'sim' : 'não'}</span>
                </div>
                {error ? <ErrorLine msg={error} /> : null}
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-white px-5 py-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 px-4 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
            {formStep > 1 ? <button type="button" onClick={() => { setFormStep(current => current === 3 ? 2 : 1); setError(null); }} className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 px-4 text-xs font-bold text-slate-600 hover:bg-slate-50">Voltar</button> : null}
            {formStep === 1 ? (
              <button type="submit" className="inline-flex h-9 items-center justify-center rounded-lg bg-pink-600 px-4 text-xs font-bold text-white shadow-md shadow-pink-600/20 hover:bg-pink-700">Continuar</button>
            ) : formStep === 2 ? (
              <button type="submit" className="inline-flex h-9 items-center justify-center rounded-lg bg-pink-600 px-4 text-xs font-bold text-white shadow-md shadow-pink-600/20 hover:bg-pink-700">Revisar integração</button>
            ) : (
              <button type="submit" disabled={submitting || finalizationSettings.transportVoucherValue == null || (requiresPdvAccess && (!pdvProfileId || !activeUnits.find(unit => unit.id === unitId)?.pdvFilialId))} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-pink-600 px-4 text-xs font-bold text-white shadow-md shadow-pink-600/20 hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-60">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Iniciar integração
              </button>
            )}
          </div>
        </form>}
      </div>
    </div>
  );
}

type InstanceEditorTab = 'stages' | 'rules';

const INSTANCE_BLOCK_TYPES: Array<{ type: IntegrationBlock['type']; label: string }> = [
  { type: 'heading', label: 'Título' },
  { type: 'rich_text', label: 'Texto de orientação' },
  { type: 'text', label: 'Texto curto' },
  { type: 'textarea', label: 'Texto longo' },
  { type: 'number', label: 'Número' },
  { type: 'currency', label: 'Moeda' },
  { type: 'date', label: 'Data' },
  { type: 'yes_no', label: 'Sim/Não' },
  { type: 'single_select', label: 'Escolha única' },
  { type: 'multi_select', label: 'Múltipla escolha' },
  { type: 'confirmation', label: 'Confirmação' },
  { type: 'signature', label: 'Assinatura' },
  { type: 'repeatable_group', label: 'Grupo repetível' },
  { type: 'repeatable_table', label: 'Tabela repetível' },
  { type: 'subform', label: 'Subformulário' },
  { type: 'upload', label: 'Upload' },
  { type: 'task', label: 'Tarefa' },
  { type: 'approval', label: 'Aprovação' },
  { type: 'evaluation', label: 'Avaliação' },
  { type: 'decision', label: 'Decisão' },
  { type: 'document_generation', label: 'Gerar documento' },
  { type: 'notification', label: 'Notificação' },
  { type: 'probation', label: 'Período de experiência' },
];

function instanceLocalId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeInstanceBlock(stageId: string, order: number, type: IntegrationBlock['type']): IntegrationBlock {
  return {
    id: instanceLocalId('block'),
    stageId,
    order,
    type,
    label: INSTANCE_BLOCK_TYPES.find(item => item.type === type)?.label ?? 'Novo bloco',
    required: false,
    readOnly: false,
    active: true,
    writePolicy: 'process_only',
    hiddenAnswerPolicy: 'exclude',
    ...(type === 'repeatable_group' || type === 'repeatable_table' || type === 'subform' ? { fields: [] } : {}),
    config: {},
  };
}

function IntegrationInstanceEditor({
  draft,
  disabled,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  draft: IntegrationTemplateVersion;
  disabled: boolean;
  saving: boolean;
  onChange: (draft: IntegrationTemplateVersion) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [tab, setTab] = useState<InstanceEditorTab>('stages');
  const [selectedStageId, setSelectedStageId] = useState(draft.stages[0]?.id ?? '');
  const [selectedBlockId, setSelectedBlockId] = useState('');
  const selectedStage = draft.stages.find(stage => stage.id === selectedStageId) ?? draft.stages[0] ?? null;
  const stageBlocks = draft.blocks.filter(block => block.stageId === selectedStage?.id).sort((a, b) => a.order - b.order);
  const selectedBlock = draft.blocks.find(block => block.id === selectedBlockId) ?? null;

  function patchDraft(patch: Partial<IntegrationTemplateVersion>) { onChange({ ...draft, ...patch }); }
  function patchStage(stageId: string, patch: Partial<IntegrationStage>) { patchDraft({ stages: draft.stages.map(stage => stage.id === stageId ? { ...stage, ...patch } : stage) }); }
  function addStage() {
    const stage: IntegrationStage = { id: instanceLocalId('stage'), label: 'Nova etapa', order: draft.stages.length, required: true, skippable: false, dueDays: null, dueDateSource: 'stage_entry' };
    patchDraft({ stages: [...draft.stages, stage] });
    setSelectedStageId(stage.id);
    setSelectedBlockId('');
  }
  function removeStage(stageId: string) {
    if (draft.stages.length <= 1) return;
    const stages = draft.stages.filter(stage => stage.id !== stageId).map((stage, order) => ({ ...stage, order }));
    patchDraft({ stages, blocks: draft.blocks.filter(block => block.stageId !== stageId) });
    setSelectedStageId(stages[0]?.id ?? '');
    setSelectedBlockId('');
  }
  function patchBlock(blockId: string, patch: Partial<IntegrationBlock>) { patchDraft({ blocks: draft.blocks.map(block => block.id === blockId ? { ...block, ...patch } : block) }); }
  function addBlock(type: IntegrationBlock['type']) {
    if (!selectedStage) return;
    const block = makeInstanceBlock(selectedStage.id, stageBlocks.length, type);
    patchDraft({ blocks: [...draft.blocks, block] });
    setSelectedBlockId(block.id);
  }
  function removeBlock(blockId: string) {
    patchDraft({ blocks: draft.blocks.filter(block => block.id !== blockId) });
    setSelectedBlockId('');
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4"><div><h3 className="text-lg font-black">Editar integração avulsa</h3><p className="text-xs text-slate-500">{draft.name}</p></div><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border"><X className="h-4 w-4" /></button></div>
        <div className="flex gap-2 border-b px-5 py-2"><button type="button" onClick={() => setTab('stages')} className={`h-9 rounded-lg px-3 text-xs font-black ${tab === 'stages' ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600'}`}>Etapas e blocos</button><button type="button" onClick={() => setTab('rules')} className={`h-9 rounded-lg px-3 text-xs font-black ${tab === 'rules' ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600'}`}>Regras</button></div>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {tab === 'stages' ? <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_320px]">
            <aside className="rounded-xl border bg-white p-3"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-bold uppercase text-slate-400">Etapas</p>{!disabled ? <button type="button" onClick={addStage} className="grid h-8 w-8 place-items-center rounded-lg border"><Plus className="h-4 w-4" /></button> : null}</div>{draft.stages.map(stage => <button key={stage.id} type="button" onClick={() => { setSelectedStageId(stage.id); setSelectedBlockId(''); }} className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm font-semibold ${selectedStage?.id === stage.id ? 'bg-slate-950 text-white' : 'hover:bg-slate-50'}`}>{stage.label}</button>)}</aside>
            <div className="space-y-4 rounded-xl border bg-white p-4">{selectedStage ? <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]"><label className="text-xs font-bold text-slate-500">Nome da etapa<input disabled={disabled} value={selectedStage.label} onChange={event => patchStage(selectedStage.id, { label: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900" /></label>{!disabled ? <button type="button" disabled={draft.stages.length <= 1} onClick={() => removeStage(selectedStage.id)} className="mt-5 h-10 rounded-lg border px-3 text-xs font-black text-rose-600 disabled:opacity-40">Remover</button> : null}<label className="text-xs font-bold text-slate-500 md:col-span-2">Descrição<textarea disabled={disabled} value={selectedStage.description ?? ''} onChange={event => patchStage(selectedStage.id, { description: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border p-3 text-sm text-slate-900" /></label></div> : null}<div className="flex items-center justify-between"><p className="text-sm font-black">Blocos</p>{!disabled ? <select defaultValue="" onChange={event => { if (event.target.value) addBlock(event.target.value as IntegrationBlock['type']); event.target.value = ''; }} className="h-9 rounded-lg border px-2 text-xs font-bold"><option value="">+ Adicionar bloco</option>{INSTANCE_BLOCK_TYPES.map(item => <option key={item.type} value={item.type}>{item.label}</option>)}</select> : null}</div><div className="space-y-2">{stageBlocks.map(block => <button key={block.id} type="button" onClick={() => setSelectedBlockId(block.id)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${selectedBlockId === block.id ? 'border-pink-300 bg-pink-50' : 'bg-slate-50'}`}><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{block.label}</span><span className="text-xs text-slate-500">{INSTANCE_BLOCK_TYPES.find(item => item.type === block.type)?.label ?? block.type}</span></span>{block.required ? <span className="text-[10px] font-bold text-rose-600">Obrigatório</span> : null}</button>)}</div></div>
            <aside className="rounded-xl border bg-white p-4">{selectedBlock ? <div className="space-y-3"><div className="flex items-center justify-between"><p className="font-black">Configurar bloco</p>{!disabled ? <button type="button" onClick={() => removeBlock(selectedBlock.id)} className="text-rose-500"><Trash2 className="h-4 w-4" /></button> : null}</div><label className="block text-xs font-bold text-slate-500">Tipo<select disabled={disabled} value={selectedBlock.type} onChange={event => patchBlock(selectedBlock.id, { type: event.target.value as IntegrationBlock['type'], fields: ['repeatable_group', 'repeatable_table', 'subform'].includes(event.target.value) ? selectedBlock.fields ?? [] : undefined })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900">{INSTANCE_BLOCK_TYPES.map(item => <option key={item.type} value={item.type}>{item.label}</option>)}</select></label><label className="block text-xs font-bold text-slate-500">Nome<input disabled={disabled} value={selectedBlock.label} onChange={event => patchBlock(selectedBlock.id, { label: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900" /></label><label className="block text-xs font-bold text-slate-500">Descrição<textarea disabled={disabled} value={selectedBlock.description ?? ''} onChange={event => patchBlock(selectedBlock.id, { description: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border p-3 text-sm text-slate-900" /></label><label className="block text-xs font-bold text-slate-500">Variável de destino<input disabled={disabled} value={selectedBlock.variableKey ?? ''} onChange={event => patchBlock(selectedBlock.id, { variableKey: event.target.value || undefined })} placeholder="employee.name" className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900" /></label><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={selectedBlock.required} disabled={disabled} onChange={event => patchBlock(selectedBlock.id, { required: event.target.checked })} /> Obrigatório</label><label className="block text-xs font-bold text-slate-500">Gravação<select disabled={disabled} value={selectedBlock.writePolicy} onChange={event => patchBlock(selectedBlock.id, { writePolicy: event.target.value as IntegrationBlock['writePolicy'] })} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm text-slate-900"><option value="process_only">Somente no processo</option><option value="direct">Atualização direta</option><option value="confirm">Pedir confirmação</option><option value="approval">Exigir aprovação</option></select></label>{selectedBlock.type === 'upload' ? <input disabled={disabled} value={String(selectedBlock.config.accept ?? '')} onChange={event => patchBlock(selectedBlock.id, { config: { ...selectedBlock.config, accept: event.target.value } })} placeholder=".pdf,.docx,.jpg" className="h-9 w-full rounded-lg border px-2 text-xs" /> : null}{selectedBlock.type === 'document_generation' ? <label className="block rounded-lg bg-violet-50 p-3 text-xs font-bold text-violet-800">ID do modelo documental<input disabled={disabled} value={String(selectedBlock.config.templateId ?? '')} onChange={event => patchBlock(selectedBlock.id, { config: { ...selectedBlock.config, templateId: event.target.value } })} className="mt-1 h-9 w-full rounded-lg border bg-white px-2 text-xs text-slate-900" /></label> : null}{['repeatable_group', 'repeatable_table', 'subform'].includes(selectedBlock.type) ? <IntegrationSubfieldEditor fields={selectedBlock.fields ?? []} disabled={disabled} onChange={fields => patchBlock(selectedBlock.id, { fields })} /> : null}</div> : <p className="text-sm text-slate-500">Selecione um bloco para editar.</p>}</aside>
          </div> : <IntegrationRulesPanel draft={draft} disabled={disabled} onChange={(rules: IntegrationRule[]) => patchDraft({ rules })} />}
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3"><button type="button" onClick={onClose} className="h-9 rounded-lg border px-3 text-sm font-bold">Cancelar</button><button type="button" onClick={onSave} disabled={disabled || saving} className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-bold text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}Salvar avulso</button></div>
      </div>
    </div>
  );
}

function IntegrationV2Runner({ process, getToken, canManage, onRefresh }: { process: OnboardingProcess; getToken: () => Promise<string>; canManage: boolean; onRefresh: () => void }) {
  const execution = process.integrationV2;
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => execution?.answers ?? {});
  const [uploads, setUploads] = useState<Record<string, unknown>>(() => execution?.uploads ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instanceDraft, setInstanceDraft] = useState<IntegrationTemplateVersion | null>(null);
  useEffect(() => { setAnswers(execution?.answers ?? {}); setUploads(execution?.uploads ?? {}); }, [execution?.answers, execution?.uploads]);
  const simulation = useMemo(() => execution ? simulateIntegrationTemplate(execution.snapshot, { answers, uploads }) : null, [answers, execution, uploads]);
  if (!execution || !simulation) return null;
  const activeExecution = execution;
  const orderedStages = [...activeExecution.snapshot.stages]
    .filter(item => activeExecution.stageStatuses[item.id] !== 'skipped')
    .sort((left, right) => left.order - right.order);
  const stage = orderedStages.find(item => item.id === activeExecution.currentStageId) ?? null;
  const blocks = activeExecution.snapshot.blocks.filter(block => block.stageId === stage?.id && simulation.visibleBlockIds.includes(block.id)).sort((a, b) => a.order - b.order);

  async function persist(action: 'save' | 'advance', nextUploads = uploads) {
    setBusy(action); setError(null);
    try {
      await apiFetch(`/api/hr/onboarding/${process.id}/integration`, getToken, { method: 'PATCH', body: JSON.stringify({ action, answers, uploads: nextUploads }) });
      onRefresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Falha ao atualizar o fluxo.'); }
    finally { setBusy(null); }
  }

  async function upload(blockId: string, file: File) {
    setBusy(`upload:${blockId}`); setError(null);
    try {
      const token = await getToken();
      const formData = new FormData(); formData.set('file', file);
      const response = await fetch('/api/hr/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Falha no upload.');
      const nextUploads = { ...uploads, [blockId]: { status: 'uploaded', url: payload.url, path: payload.path, name: file.name, sha256: payload.sha256 } };
      setUploads(nextUploads);
      await persist('save', nextUploads);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Falha no upload.'); }
    finally { setBusy(null); }
  }

  async function generateDocument(block: IntegrationBlock) {
    const templateId = typeof block.config.templateId === 'string' ? block.config.templateId : '';
    if (!templateId) { setError('Configure o modelo documental deste bloco antes de gerar.'); return; }
    setBusy(`document:${block.id}`); setError(null);
    try {
      const token = await getToken();
      const response = await fetch('/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ templateId, onboardingId: process.id }) });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || 'Falha ao gerar documento.'); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'documento.docx'; anchor.click(); URL.revokeObjectURL(url);
      setAnswers(current => ({ ...current, [block.id]: response.headers.get('X-Generated-Document-Id') ?? true }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Falha ao gerar documento.'); }
    finally { setBusy(null); }
  }

  async function configure(content: Pick<IntegrationTemplateVersion, 'stages' | 'blocks'> & Partial<Pick<IntegrationTemplateVersion, 'rules' | 'probation' | 'completionRules'>>) {
    setBusy('configure'); setError(null);
    try {
      await apiFetch(`/api/hr/onboarding/${process.id}/integration`, getToken, { method: 'PATCH', body: JSON.stringify({ action: 'configure', content: { stages: content.stages, blocks: content.blocks, rules: content.rules ?? activeExecution.snapshot.rules, probation: content.probation ?? activeExecution.snapshot.probation, completionRules: content.completionRules ?? activeExecution.snapshot.completionRules } }) });
      onRefresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Falha ao configurar o fluxo avulso.'); }
    finally { setBusy(null); }
  }

  function openInstanceEditor() {
    setInstanceDraft(structuredClone(activeExecution.snapshot));
  }

  async function saveInstanceEditor() {
    if (!instanceDraft) return;
    await configure({
      stages: instanceDraft.stages,
      blocks: instanceDraft.blocks,
      rules: instanceDraft.rules,
      probation: instanceDraft.probation,
      completionRules: instanceDraft.completionRules,
    });
    setInstanceDraft(null);
  }

  function recordValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  async function uploadNested(scopeKey: string, file: File, onChange: (value: unknown) => void) {
    setBusy(`upload:${scopeKey}`); setError(null);
    try {
      const token = await getToken();
      const formData = new FormData(); formData.set('file', file);
      const response = await fetch('/api/hr/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Falha no upload.');
      onChange({ status: 'uploaded', url: payload.url, path: payload.path, name: file.name, sha256: payload.sha256 });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Falha no upload.'); }
    finally { setBusy(null); }
  }

  function renderNestedFields(fields: IntegrationSubfield[] | undefined, value: unknown, onChange: (value: Record<string, unknown>) => void, scopeKey: string) {
    const data = recordValue(value);
    if (!fields?.length) return <p className="rounded-lg border border-dashed bg-slate-50 p-3 text-xs text-slate-400">Nenhum campo interno configurado.</p>;
    return <div className="grid gap-2 md:grid-cols-2">{fields.map(nested => <label key={nested.id} className="block rounded-lg border bg-slate-50 p-2 text-xs font-bold text-slate-600"><span className="mb-1 block">{nested.label}{nested.required ? <b className="text-rose-500"> *</b> : null}</span>{renderNestedInput(nested, data[nested.id], nextValue => onChange({ ...data, [nested.id]: nextValue }), `${scopeKey}:${nested.id}`)}{nested.helpText ? <span className="mt-1 block font-medium text-slate-400">{nested.helpText}</span> : null}</label>)}</div>;
  }

  function renderRepeatable(label: string, fields: IntegrationSubfield[] | undefined, value: unknown, onChange: (value: Record<string, unknown>[]) => void, scopeKey: string, table = false) {
    const rows = Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[] : [];
    const addRow = () => onChange([...rows, {}]);
    const patchRow = (index: number, row: Record<string, unknown>) => onChange(rows.map((item, itemIndex) => itemIndex === index ? row : item));
    const removeRow = (index: number) => onChange(rows.filter((_, itemIndex) => itemIndex !== index));
    if (table && fields?.length) {
      return <div className="space-y-2 overflow-x-auto"><table className="min-w-full border-separate border-spacing-0 text-xs"><thead><tr>{fields.map(item => <th key={item.id} className="border-b bg-slate-50 px-2 py-1 text-left font-black text-slate-500">{item.label}</th>)}<th className="w-8 border-b bg-slate-50" /></tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{fields.map(nested => <td key={nested.id} className="min-w-40 border-b px-2 py-2 align-top">{renderNestedInput(nested, row[nested.id], nextValue => patchRow(index, { ...row, [nested.id]: nextValue }), `${scopeKey}:${index}:${nested.id}`)}</td>)}<td className="border-b px-1 py-2 align-top">{canManage ? <button type="button" onClick={() => removeRow(index)} className="grid h-8 w-8 place-items-center text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button> : null}</td></tr>)}</tbody></table>{canManage ? <button type="button" onClick={addRow} className="h-8 rounded-lg border bg-white px-3 text-xs font-black text-indigo-700">+ Linha</button> : null}</div>;
    }
    return <div className="space-y-2">{rows.map((row, index) => <div key={index} className="rounded-lg border bg-slate-50 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-black text-slate-500">{label} #{index + 1}</span>{canManage ? <button type="button" onClick={() => removeRow(index)} className="text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button> : null}</div>{renderNestedFields(fields, row, nextRow => patchRow(index, nextRow), `${scopeKey}:${index}`)}</div>)}{canManage ? <button type="button" onClick={addRow} className="h-8 rounded-lg border bg-white px-3 text-xs font-black text-indigo-700">+ Item</button> : null}</div>;
  }

  function renderNestedInput(field: IntegrationSubfield, value: unknown, onChange: (value: unknown) => void, scopeKey: string): React.ReactNode {
    const base = 'h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900';
    if (field.type === 'subform') return renderNestedFields(field.fields, value, onChange as (value: Record<string, unknown>) => void, scopeKey);
    if (field.type === 'repeatable_group' || field.type === 'repeatable_table') return renderRepeatable(field.label, field.fields, value, onChange as (value: Record<string, unknown>[]) => void, scopeKey, field.type === 'repeatable_table');
    if (field.type === 'upload') {
      const uploaded = recordValue(value);
      return <div className="flex flex-wrap items-center gap-2"><input type="file" disabled={!canManage || busy === `upload:${scopeKey}`} accept={String(field.config.accept ?? '.pdf,.jpg,.jpeg,.png')} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadNested(scopeKey, file, onChange); }} className="min-w-0 flex-1 text-xs" />{typeof uploaded.url === 'string' ? <a href={uploaded.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-600">{String(uploaded.name ?? 'Ver arquivo')}</a> : null}</div>;
    }
    if (field.type === 'yes_no' || field.type === 'confirmation') return <select disabled={!canManage || field.readOnly} value={value === true ? 'true' : value === false ? 'false' : ''} onChange={event => onChange(event.target.value === 'true')} className={base}><option value="">Selecione</option><option value="true">Sim</option><option value="false">Não</option></select>;
    if (field.type === 'single_select' || field.type === 'multi_select') return <select disabled={!canManage || field.readOnly} multiple={field.type === 'multi_select'} value={field.type === 'multi_select' ? (Array.isArray(value) ? value.map(String) : []) : String(value ?? '')} onChange={event => onChange(field.type === 'multi_select' ? Array.from(event.target.selectedOptions).map(option => option.value) : event.target.value)} className={base}><option value="">Selecione</option>{field.options?.filter(option => option.active !== false).map(option => <option key={option.id} value={String(option.value)}>{option.label}</option>)}</select>;
    if (field.type === 'textarea' || field.type === 'address') return <textarea disabled={!canManage || field.readOnly} value={String(value ?? '')} onChange={event => onChange(event.target.value)} className="min-h-20 w-full rounded-lg border bg-white p-2 text-xs text-slate-900" />;
    const inputType = ['date', 'time', 'datetime'].includes(field.type) ? (field.type === 'datetime' ? 'datetime-local' : field.type) : ['number', 'currency', 'percentage'].includes(field.type) ? 'number' : field.type === 'email' ? 'email' : 'text';
    return <input disabled={!canManage || field.readOnly} type={inputType} value={String(value ?? '')} onChange={event => onChange(inputType === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)} placeholder={field.placeholder} className={base} />;
  }

  function field(block: IntegrationBlock) {
    const value = answers[block.id];
    const base = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900';
    if (block.type === 'heading' || block.type === 'rich_text' || block.type === 'notice') return <p className={block.type === 'heading' ? 'text-base font-black' : 'text-sm text-slate-600'}>{block.description ?? block.label}</p>;
    if (block.type === 'repeatable_group' || block.type === 'repeatable_table') return renderRepeatable(block.label, block.fields, value, nextValue => setAnswers(current => ({ ...current, [block.id]: nextValue })), block.id, block.type === 'repeatable_table');
    if (block.type === 'subform') return renderNestedFields(block.fields, value, nextValue => setAnswers(current => ({ ...current, [block.id]: nextValue })), block.id);
    if (block.type === 'upload') {
      const uploaded = uploads[block.id] as { url?: string; name?: string } | undefined;
      return <div className="flex flex-wrap items-center gap-2"><input type="file" disabled={!canManage || busy === `upload:${block.id}`} accept={String(block.config.accept ?? '.pdf,.jpg,.jpeg,.png')} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(block.id, file); }} className="min-w-0 flex-1 text-xs" />{uploaded?.url ? <a href={uploaded.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-600">{uploaded.name ?? 'Ver arquivo'}</a> : null}</div>;
    }
    if (block.type === 'document_generation') return <button type="button" disabled={!canManage || busy === `document:${block.id}`} onClick={() => void generateDocument(block)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-3 text-xs font-black text-white disabled:opacity-50">{busy === `document:${block.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}Gerar Word</button>;
    if (block.type === 'yes_no' || block.type === 'confirmation') return <select disabled={!canManage} value={String(value ?? '')} onChange={event => setAnswers(current => ({ ...current, [block.id]: event.target.value === 'true' }))} className={base}><option value="">Selecione</option><option value="true">Sim</option><option value="false">Não</option></select>;
    if (block.type === 'single_select' || block.type === 'multi_select') return <select disabled={!canManage} multiple={block.type === 'multi_select'} value={block.type === 'multi_select' ? (Array.isArray(value) ? value.map(String) : []) : String(value ?? '')} onChange={event => setAnswers(current => ({ ...current, [block.id]: block.type === 'multi_select' ? Array.from(event.target.selectedOptions).map(option => option.value) : event.target.value }))} className={base}><option value="">Selecione</option>{block.options?.filter(option => option.active !== false).map(option => <option key={option.id} value={String(option.value)}>{option.label}</option>)}</select>;
    if (block.type === 'textarea') return <textarea disabled={!canManage} value={String(value ?? '')} onChange={event => setAnswers(current => ({ ...current, [block.id]: event.target.value }))} className="min-h-24 w-full rounded-lg border p-3 text-sm" />;
    const inputType = ['date', 'time', 'datetime'].includes(block.type) ? (block.type === 'datetime' ? 'datetime-local' : block.type) : ['number', 'currency', 'percentage', 'numeric_scale'].includes(block.type) ? 'number' : block.type === 'email' ? 'email' : 'text';
    return <input disabled={!canManage || block.readOnly} type={inputType} value={String(value ?? '')} onChange={event => setAnswers(current => ({ ...current, [block.id]: inputType === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value }))} placeholder={block.placeholder} className={base} />;
  }

  return (
    <section className="mx-6 mt-5 overflow-hidden rounded-2xl border border-indigo-200 bg-indigo-50/30 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-indigo-100 bg-white/80 p-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600">
            Roteiro configurável · {execution.mode === 'import' ? `modelo v${execution.templateVersion}` : 'avulso'}
          </p>
          <h3 className="mt-1 text-base font-black text-slate-950">{stage?.label ?? 'Roteiro concluído'}</h3>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">{execution.snapshot.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && execution.mode === 'blank' ? (
            <button type="button" disabled={!!busy} onClick={openInstanceEditor} className="inline-flex h-9 items-center gap-1 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-black text-indigo-700">
              <Pencil className="h-3.5 w-3.5" /> Editar avulso
            </button>
          ) : null}
          {canManage ? (
            <button type="button" disabled={!!busy} onClick={() => void persist('save')} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-50">
              {busy === 'save' ? 'Salvando...' : 'Salvar respostas'}
            </button>
          ) : null}
          {canManage && stage ? (
            <button type="button" disabled={!!busy || simulation.blockedReasons.length > 0} onClick={() => void persist('advance')} className="inline-flex h-9 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-xs font-black text-white disabled:opacity-50">
              {busy === 'advance' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Avançar <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {orderedStages.length > 0 ? (
        <div className="border-b border-indigo-100 bg-white/60 px-4 py-3">
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${orderedStages.length}, minmax(0, 1fr))` }}>
            {orderedStages.map(item => {
              const state = activeExecution.stageStatuses[item.id];
              return (
                <span
                  key={item.id}
                  className={`h-1.5 rounded-full ${state === 'completed' ? 'bg-emerald-500' : state === 'active' ? 'bg-indigo-600' : 'bg-slate-200'}`}
                  title={`${item.label}: ${state === 'completed' ? 'concluída' : state === 'active' ? 'atual' : 'pendente'}`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[10.5px] font-bold text-slate-500">
            <span>{orderedStages.filter(item => activeExecution.stageStatuses[item.id] === 'completed').length} de {orderedStages.length} concluídas</span>
            {stage?.dueDays ? <span>Prazo da etapa: {stage.dueDays}d</span> : null}
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {orderedStages.map((item, index) => {
              const state = activeExecution.stageStatuses[item.id];
              return (
                <div key={item.id} className={`flex min-w-[150px] items-center gap-2 rounded-xl border px-3 py-2 ${
                  state === 'completed'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : state === 'active'
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-800'
                      : 'border-slate-200 bg-white text-slate-400'
                }`}>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                    state === 'completed' ? 'bg-emerald-500 text-white' : state === 'active' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {state === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <span className="line-clamp-2 text-[10.5px] font-black leading-snug">{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="p-4">
        {simulation.blockedReasons.length > 0 ? (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{simulation.blockedReasons.join(' ')}</span>
          </div>
        ) : null}
        {error ? <div className="mb-3"><ErrorLine msg={error} /></div> : null}
        <div className="grid gap-3 md:grid-cols-2">
          {blocks.map(block => (
            <div key={block.id} className="relative rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700 shadow-sm">
              <span className="mb-1.5 block pr-6">{block.label}{simulation.requiredBlockIds.includes(block.id) ? <b className="text-rose-500"> *</b> : null}</span>
              {field(block)}
              {block.helpText ? <span className="mt-1 block font-medium text-slate-400">{block.helpText}</span> : null}
            </div>
          ))}
          {stage && !blocks.length ? (
            <p className="col-span-full rounded-xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">Esta etapa não possui campos visíveis.</p>
          ) : null}
          {!stage ? (
            <p className="col-span-full rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">Todas as etapas do roteiro configurável foram concluídas.</p>
          ) : null}
        </div>
      </div>

      {instanceDraft ? (
        <IntegrationInstanceEditor
          draft={instanceDraft}
          disabled={!canManage}
          saving={busy === 'configure'}
          onChange={setInstanceDraft}
          onClose={() => setInstanceDraft(null)}
          onSave={() => void saveInstanceEditor()}
        />
      ) : null}
    </section>
  );
}

function ProbationV2Panel({ process, getToken, canManage, formalizationComplete, onRefresh }: { process: OnboardingProcess; getToken: () => Promise<string>; canManage: boolean; formalizationComplete: boolean; onRefresh: () => void }) {
  const [state, setState] = useState(process.probationV2 ?? null);
  const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setState(process.probationV2 ?? null);
    if (!formalizationComplete) return;
    if (!process.probationV2) return;
    void apiFetch(`/api/hr/onboarding/${process.id}/probation`, getToken).then(payload => setState(payload.probation)).catch(() => undefined);
  }, [formalizationComplete, getToken, process.id, process.probationV2]);
  if (!state) return null;
  if (!formalizationComplete) {
    return <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-400"><LockKeyhole className="h-4 w-4" /></span><div><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Experiência ainda não iniciada</p><h3 className="mt-1 text-base font-black text-slate-900">Aguardando conclusão da formalização</h3><p className="mt-1 text-xs font-semibold text-slate-500">As avaliações e seus alertas serão liberados somente após a conclusão de todas as etapas da formalização.</p></div></div></section>;
  }
  const activeState = state;
  async function patch(action: string, body: Record<string, unknown> = {}) { setBusy(action); setError(null); try { const payload = await apiFetch(`/api/hr/onboarding/${process.id}/probation`, getToken, { method: 'PATCH', body: JSON.stringify({ action, ...body }) }); setState(payload.probation); onRefresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Falha ao atualizar experiência.'); } finally { setBusy(null); } }
  async function generateExtensionTerm() {
    const templateId = activeState.config.extensionDocumentTemplateId; if (!templateId) { setError('Configure o modelo do termo de prorrogação.'); return; }
    setBusy('term'); setError(null);
    try { const token = await getToken(); const response = await fetch('/api/documents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ templateId, onboardingId: process.id }) }); if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || 'Falha ao gerar termo.'); } const id = response.headers.get('X-Generated-Document-Id'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'termo-prorrogacao.docx'; anchor.click(); URL.revokeObjectURL(url); await patch('term_generated', { generatedDocumentId: id }); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Falha ao gerar termo.'); } finally { setBusy(null); }
  }
  return <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Experiência</p><h3 className="mt-1 text-base font-black text-slate-950">{state.status === 'awaiting_admission' ? 'Aguardando data de admissão' : `${state.schedule?.totalDays ?? 0} dias programados`}</h3><p className="text-xs text-slate-500">{state.schedule ? `${state.schedule.admissionDate} até ${state.schedule.finalEndDate}` : 'Informe a admissão para calcular todas as etapas.'}</p></div>{canManage && state.status === 'awaiting_admission' ? <input type="date" onChange={event => { if (event.target.value) void patch('set_admission_date', { admissionDate: event.target.value }); }} className="h-9 rounded-lg border bg-white px-3 text-xs" /> : null}</div>{error ? <div className="mt-3"><ErrorLine msg={error} /></div> : null}{state.schedule ? <div className="mt-4 grid gap-3 md:grid-cols-2">{state.evaluations.map(evaluation => <div key={evaluation.id} className="rounded-xl border bg-white p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-black">{evaluation.label}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${evaluation.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : evaluation.status === 'available' ? 'bg-blue-50 text-blue-700' : evaluation.status === 'overdue' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{evaluation.status}</span></div><p className="mt-1 text-xs text-slate-500">Janela: {evaluation.windowStartDate} a {evaluation.windowEndDate}</p>{evaluation.result ? <p className="mt-2 text-xs font-bold">Resultado: {evaluation.result}</p> : null}{canManage && ['available','overdue'].includes(evaluation.status) ? <div className="mt-3 flex gap-2"><button type="button" disabled={!!busy} onClick={() => void patch('evaluate', { evaluationId: evaluation.id, result: 'approved', notes: window.prompt('Observações da avaliação:') ?? '' })} className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white">Aprovar</button><button type="button" disabled={!!busy} onClick={() => void patch('evaluate', { evaluationId: evaluation.id, result: 'rejected', notes: window.prompt('Motivo:') ?? '' })} className="h-8 rounded-lg bg-rose-600 px-3 text-xs font-black text-white">Reprovar</button></div> : null}</div>)}</div> : null}{state.extensionTerm.required ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3"><div><p className="text-sm font-black">Termo de prorrogação obrigatório</p><p className="text-xs text-slate-500">{state.extensionTerm.signedAt ? 'Assinado' : state.extensionTerm.generatedDocumentId ? 'Gerado, aguardando assinatura' : 'Pendente de geração'}</p></div>{canManage ? <div className="flex gap-2">{!state.extensionTerm.generatedDocumentId ? <button type="button" disabled={!!busy} onClick={() => void generateExtensionTerm()} className="h-8 rounded-lg bg-violet-600 px-3 text-xs font-black text-white">Gerar termo</button> : null}{state.extensionTerm.generatedDocumentId && !state.extensionTerm.signedAt ? <button type="button" disabled={!!busy} onClick={() => void patch('term_signed')} className="h-8 rounded-lg bg-slate-950 px-3 text-xs font-black text-white">Marcar assinado</button> : null}</div> : null}</div> : null}{canManage && state.status === 'decision_pending' ? <div className="mt-3 flex gap-2"><button type="button" disabled={!!busy} onClick={() => void patch('decide', { result: 'effective', notes: window.prompt('Observações da efetivação:') ?? '' })} className="h-9 rounded-lg bg-emerald-600 px-4 text-xs font-black text-white">Efetivar</button><button type="button" disabled={!!busy} onClick={() => void patch('decide', { result: 'terminated', notes: window.prompt('Observações do desligamento:') ?? '' })} className="h-9 rounded-lg bg-rose-600 px-4 text-xs font-black text-white">Não efetivar</button></div> : null}</section>;
}

const TRAINING_STATUS_META: Record<OnboardingTrainingItem['status'], { label: string; badgeBg: string; badgeFg: string; iconBg: string; border: string; bg: string }> = {
  done: { label: 'Concluído', badgeBg: 'bg-emerald-50', badgeFg: 'text-emerald-700', iconBg: 'bg-emerald-600 text-white', border: 'border-emerald-200', bg: 'bg-emerald-50/40' },
  current: { label: 'Em andamento', badgeBg: 'bg-pink-50', badgeFg: 'text-pink-700', iconBg: 'bg-pink-600 text-white', border: 'border-pink-200', bg: 'bg-pink-50/40' },
  pending: { label: 'Pendente', badgeBg: 'bg-slate-100', badgeFg: 'text-slate-500', iconBg: 'bg-slate-100 text-slate-400', border: 'border-slate-100', bg: 'bg-white' },
};

function TrainingPanel({ process, getToken, canManage, onRefresh }: { process: OnboardingProcess; getToken: () => Promise<string>; canManage: boolean; onRefresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = [...(process.trainingItems ?? [])].sort((a, b) => a.order - b.order);
  const doneCount = items.filter(item => item.status === 'done').length;

  async function patch(action: string, body: Record<string, unknown> = {}) {
    setBusy(action);
    setError(null);
    try {
      await apiFetch(`/api/hr/onboarding/${process.id}/training`, getToken, { method: 'PATCH', body: JSON.stringify({ action, ...body }) });
      onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao atualizar treinamento.');
    } finally {
      setBusy(null);
    }
  }

  function addTraining() {
    const label = window.prompt('Nome do treinamento:');
    if (!label || !label.trim()) return;
    const detail = window.prompt('Detalhe (opcional, ex: duração ou modalidade):') ?? '';
    void patch('add', { label: label.trim(), detail: detail.trim() });
  }

  return (
    <div className="p-[18px]">
      <div className="mb-3 flex items-center justify-between gap-2.5">
        <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">Trilhas de integração</p>
        <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">{doneCount}/{items.length} concluídos</span>
      </div>
      {error && <div className="mb-3"><ErrorLine msg={error} /></div>}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-[13px] font-medium text-slate-500">
          Nenhuma trilha cadastrada ainda para esta pessoa.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map(item => {
            const meta = TRAINING_STATUS_META[item.status];
            return (
              <div key={item.id} className={`flex items-center gap-3 rounded-xl border ${meta.border} ${meta.bg} px-3.5 py-2.5`}>
                <span className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] ${meta.iconBg}`}>
                  {item.status === 'done' ? <CheckCircle2 className="h-4 w-4" /> : item.status === 'current' ? <RefreshCw className="h-4 w-4" /> : <GraduationCap className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-extrabold text-slate-900">{item.label}</p>
                  {item.detail && <p className="mt-0.5 text-xs font-medium text-slate-500">{item.detail}</p>}
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wide ${meta.badgeBg} ${meta.badgeFg}`}>{meta.label}</span>
                {canManage && item.status !== 'done' && (
                  <div className="flex shrink-0 gap-1.5">
                    {item.status === 'pending' && (
                      <button type="button" disabled={!!busy} onClick={() => void patch('set_status', { itemId: item.id, status: 'current' })} className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                        Iniciar
                      </button>
                    )}
                    <button type="button" disabled={!!busy} onClick={() => void patch('set_status', { itemId: item.id, status: 'done' })} className="h-8 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-black text-white hover:bg-emerald-500">
                      Concluir
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {canManage && (
        <button type="button" onClick={addTraining} className="mt-3.5 inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-bold text-slate-600 hover:bg-slate-50">
          <Plus className="h-4 w-4" />
          Adicionar treinamento
        </button>
      )}
    </div>
  );
}

export type OnboardingProcessScope = 'active' | 'completed' | 'cancelled';
export type OnboardingPageInfo = Record<OnboardingProcessScope, {
  limit: number;
  hasMore: boolean;
  cursorId: string | null;
}>;

export function OnboardingView({ processes, pageInfo, loadingMoreScope, roles, jobFunctions, units, shiftDefinitions, getToken, canManage, canViewAso, canManageAso, canViewAccountant, canManageAccountant, canViewSensitiveData, canViewSignatures, canGenerateDocuments, canReviewDocuments, canSendSignatures, onRefresh, onLoadMore, onProcessUpdated, onAsoPaymentUpdated, onAsoWorkflowUpdated }: {
  processes: OnboardingProcess[];
  pageInfo: OnboardingPageInfo;
  loadingMoreScope: OnboardingProcessScope | null;
  roles: JobRole[];
  jobFunctions: JobFunction[];
  units: DPUnit[];
  shiftDefinitions: DPShiftDefinition[];
  getToken: () => Promise<string>;
  canManage: boolean;
  canViewAso: boolean;
  canManageAso: boolean;
  canViewAccountant: boolean;
  canManageAccountant: boolean;
  canViewSensitiveData: boolean;
  canViewSignatures: boolean;
  canGenerateDocuments: boolean;
  canReviewDocuments: boolean;
  canSendSignatures: boolean;
  onRefresh: () => void;
  onLoadMore: (scope: OnboardingProcessScope) => void;
  onProcessUpdated: (process: OnboardingProcess) => void;
  onAsoPaymentUpdated: (processId: string, workflow: AsoPaymentWorkflowPatch) => void;
  onAsoWorkflowUpdated: (processId: string, workflow: NonNullable<OnboardingProcess['asoWorkflow']>) => void;
}) {
  const [search, setSearch] = useState('');
  const [phaseFilter, setPhaseFilter] = useState<string>('all');
  const [healthFilter, setHealthFilter] = useState<'all' | OnboardingHealth>('all');
  const [onboardingSortMode, setOnboardingSortMode] = useState<OnboardingSortMode>('priority');
  const [processStateFilter, setProcessStateFilter] = useState<'active' | 'completed' | 'cancelled'>('active');
  const [view, setView] = useState<'grid' | 'detail'>('grid');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phaseId, setPhaseId] = useState<OnboardingStageId | 'training' | null>(null);
  const [showStartModal, setShowStartModal] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [linkClock, setLinkClock] = useState(() => Date.now());
  const [finalizationDraft, setFinalizationDraft] = useState<OnboardingFinalizationSettings>(() => getFinalizationDraft(null));
  const [signatureWorkflow, setSignatureWorkflow] = useState<SignatureWorkflowPayload | null>(null);
  const [signatureBusy, setSignatureBusy] = useState<string | null>(null);
  const [signaturePlacementOpen, setSignaturePlacementOpen] = useState(false);
  const [asoGuideBusy, setAsoGuideBusy] = useState(false);
  const [asoActionBusy, setAsoActionBusy] = useState<string | null>(null);
  const [asoStartResult, setAsoStartResult] = useState<AsoProcessStartResult | null>(null);
  const [asoPhaseIndex, setAsoPhaseIndex] = useState<number | null>(null);
  const [asoCollapsed, setAsoCollapsed] = useState(false);
  const [candidateDataCollapsed, setCandidateDataCollapsed] = useState(false);
  const [asoClinics, setAsoClinics] = useState<Array<{ id: string; active: boolean; asoPrice: number; schedulingEmail: string; address?: { street?: string; number?: string; complement?: string; district?: string; city?: string; state?: string; postalCode?: string; reference?: string; mapsUrl?: string } | null; entity?: { name?: string } | null; paymentProfile?: { configured?: boolean; validated?: boolean } }>>([]);
  const [asoClinicsLoading, setAsoClinicsLoading] = useState(false);
  const [asoClinicsError, setAsoClinicsError] = useState<string | null>(null);
  const [asoClinicEntityId, setAsoClinicEntityId] = useState('');
  const [asoAppointmentDraft, setAsoAppointmentDraft] = useState({ date: '', time: '' });
  const asoAdmissionAlertKeyRef = useRef('');
  const [accountantActionBusy, setAccountantActionBusy] = useState<string | null>(null);
  const [accountantEmail, setAccountantEmail] = useState('');
  const [accountantSalaryDraft, setAccountantSalaryDraft] = useState('');
  const [accountantFormTextDraft, setAccountantFormTextDraft] = useState<AccountantFormTextDraft>(() => ({ ...EMPTY_ACCOUNTANT_FORM_TEXT_DRAFT }));
  const [accountantFormEditing, setAccountantFormEditing] = useState(false);
  const [accountantSelectedDocumentIds, setAccountantSelectedDocumentIds] = useState<string[]>([]);
  const [accountantActiveStep, setAccountantActiveStep] = useState(1);
  const [expectedAdmissionDateDraft, setExpectedAdmissionDateDraft] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReasonDraft, setCancelReasonDraft] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setLinkClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeProcesses = useMemo(
    () => processes.filter(process => {
      if (processStateFilter === 'completed') return process.status === 'completed';
      if (processStateFilter === 'cancelled') return process.status === 'cancelled';
      return process.status !== 'completed' && process.status !== 'cancelled';
    }),
    [processes, processStateFilter]
  );
  // Distinct current phases present across active processes, for the "Todas as fases" filter.
  const phaseOptions = useMemo(() => {
    const map = new Map<string, string>();
    activeProcesses.forEach(process => {
      const stageId = process.currentStage;
      if (!stageId) return;
      const consolidatedId = consolidatedOnboardingPhaseId(stageId) ?? stageId;
      const label = consolidatedId === 'documents'
        ? 'Formalização · Dados, documentos e ASO'
        : consolidatedId === 'signature_preparation'
          ? 'Documentação admissional'
          : (process.stages ?? []).find(stage => stage.id === stageId)?.label ?? stageId;
      if (!map.has(consolidatedId)) map.set(consolidatedId, label);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [activeProcesses]);

  const filtered = useMemo(() => {
    const now = new Date(linkClock);
    const matching = activeProcesses.filter(process => {
      if (phaseFilter !== 'all' && consolidatedOnboardingPhaseId(process.currentStage) !== phaseFilter) return false;
      if (healthFilter !== 'all' && resolveOnboardingOperationalStatus(process, now).health !== healthFilter) return false;
      const text = [
        process.candidateName,
        process.candidateEmail,
        process.jobRoleName,
        process.functionName,
        process.unitName,
        process.employerUnitName,
        process.cancelReason,
        process.integrationV2?.snapshot.name,
      ].filter(Boolean).join(' ').toLowerCase();
      return !search || text.includes(search.toLowerCase());
    });
    return sortOnboardingProcesses(matching, onboardingSortMode, now);
  }, [activeProcesses, search, phaseFilter, healthFilter, onboardingSortMode, linkClock]);
  // The detail must remain mounted even when an action moves the process to a
  // different list filter (for example, from active to completed).
  const selectedProcess = useMemo(
    () => processes.find(process => process.id === selectedId) ?? null,
    [processes, selectedId]
  );

  useEffect(() => {
    const requestedId = new URLSearchParams(window.location.search).get('process');
    const requested = requestedId ? processes.find(process => process.id === requestedId) : null;
    if (!requested || selectedId === requested.id) return;
    setSelectedId(requested.id);
    setPhaseId(requested.currentStage ?? requested.stages?.[0]?.id ?? null);
    setAsoPhaseIndex(null);
    setAsoCollapsed(false);
    setCandidateDataCollapsed(false);
    setAccountantActiveStep(accountantCurrentStepNumber(requested));
    setView('detail');
  }, [processes, selectedId]);

  const loadSignatureWorkflow = useCallback(async () => {
    if (!selectedProcess?.id || !canViewSignatures) {
      setSignatureWorkflow(null);
      return;
    }
    try {
      const payload = await apiFetch(
        `/api/hr/onboarding/${selectedProcess.id}/signature-documents`,
        getToken
      ) as SignatureWorkflowPayload;
      setSignatureWorkflow(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar documentos para assinatura.');
    }
  }, [canViewSignatures, getToken, selectedProcess?.id, selectedProcess?.publicFormAnswers?.wantsTransportVoucher]);

  const refreshSelectedProcess = useCallback(async () => {
    if (!selectedProcess?.id) return;
    try {
      const payload = await apiFetch(`/api/hr/onboarding/${selectedProcess.id}`, getToken) as { process?: OnboardingProcess };
      if (payload.process) onProcessUpdated(payload.process);
    } catch {
      // O próximo ciclo tenta novamente sem substituir os dados já exibidos.
    }
  }, [getToken, onProcessUpdated, selectedProcess?.id]);

  useEffect(() => {
    if (view !== 'detail' || !selectedProcess?.id) return;
    void loadSignatureWorkflow();
  }, [loadSignatureWorkflow, selectedProcess?.id, view]);

  useEffect(() => {
    const accessPending = Boolean(
      selectedProcess?.collaboratorUserId
      && selectedProcess.accessProvisioning?.status !== 'completed'
      && selectedProcess.status !== 'cancelled'
      && selectedProcess.status !== 'completed'
    );
    if (!accessPending || !selectedProcess?.id || view !== 'detail') return;
    const refreshPendingState = () => {
      void refreshSelectedProcess();
    };
    const timer = window.setInterval(refreshPendingState, 10_000);
    return () => window.clearInterval(timer);
  }, [refreshSelectedProcess, selectedProcess?.accessProvisioning?.status, selectedProcess?.collaboratorUserId, selectedProcess?.id, selectedProcess?.status, view]);

  useEffect(() => {
    const signaturePending = signatureWorkflow?.documents.some(document =>
      document.selected && ['sent', 'viewed', 'partially_signed', 'signed'].includes(document.status)
    ) ?? false;
    if (!signaturePending || !selectedProcess?.id || view !== 'detail') return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadSignatureWorkflow();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadSignatureWorkflow, selectedProcess?.id, signatureWorkflow?.documents, view]);

  useEffect(() => {
    setFinalizationDraft(getFinalizationDraft(selectedProcess));
  }, [
    selectedProcess?.id,
    selectedProcess?.shiftDefinitionId,
    selectedProcess?.publicFormAnswers,
    selectedProcess?.finalizationSettings,
  ]);

  useEffect(() => {
    setExpectedAdmissionDateDraft(selectedProcess?.expectedAdmissionDate?.slice(0, 10) ?? '');
  }, [selectedProcess?.id, selectedProcess?.expectedAdmissionDate]);

  useEffect(() => {
    setAsoClinicEntityId(selectedProcess?.asoWorkflow?.clinicEntityId ?? '');
    setAsoAppointmentDraft({
      date: selectedProcess?.asoWorkflow?.appointment?.date ?? '',
      time: selectedProcess?.asoWorkflow?.appointment?.time ?? '',
    });
  }, [selectedProcess?.id, selectedProcess?.asoWorkflow?.appointment]);

  useEffect(() => {
    const appointmentDate = selectedProcess?.asoWorkflow?.appointment?.date ?? null;
    const admissionDate = selectedProcess?.expectedAdmissionDate ?? null;
    if (view !== 'detail' || !isAsoAppointmentAfterAdmission(appointmentDate, admissionDate)) return;
    const alertKey = `${selectedProcess?.id}:${appointmentDate}:${admissionDate}`;
    if (asoAdmissionAlertKeyRef.current === alertKey) return;
    asoAdmissionAlertKeyRef.current = alertKey;
    window.alert(
      `Atenção: o exame admissional foi agendado para ${formatOnboardingDateOnly(appointmentDate)}, depois da data de admissão em ${formatOnboardingDateOnly(admissionDate)}. Revise a data de admissão ou solicite à clínica um agendamento anterior.`,
    );
  }, [
    selectedProcess?.asoWorkflow?.appointment?.date,
    selectedProcess?.expectedAdmissionDate,
    selectedProcess?.id,
    view,
  ]);

  useEffect(() => {
    setAsoStartResult(null);
  }, [selectedProcess?.id]);

  useEffect(() => {
    const processId = selectedProcess?.id;
    const workflow = selectedProcess?.asoWorkflow;
    if (view !== 'detail' || !canViewAso || !processId || !shouldPollAsoPayment(workflow?.paymentRequestId, workflow?.paymentStatus)) return;
    let disposed = false;
    let requestRunning = false;
    const refreshPaymentStatus = async () => {
      if (requestRunning) return;
      requestRunning = true;
      try {
        const payload = await apiFetch(`/api/hr/onboarding/${processId}/aso-workflow?view=payment`, getToken) as { workflow?: AsoPaymentWorkflowPatch };
        if (!disposed && payload.workflow) onAsoPaymentUpdated(processId, payload.workflow);
      } catch {
        // O reconciliador do servidor continua ativo; a próxima leitura da tela tenta novamente.
      } finally {
        requestRunning = false;
      }
    };
    void refreshPaymentStatus();
    const timer = window.setInterval(() => void refreshPaymentStatus(), 30_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [canViewAso, getToken, onAsoPaymentUpdated, selectedProcess?.asoWorkflow?.paymentRequestId, selectedProcess?.asoWorkflow?.paymentStatus, selectedProcess?.id, view]);

  useEffect(() => {
    if (!canViewAso || view !== 'detail') return;
    let cancelled = false;
    setAsoClinicsLoading(true);
    setAsoClinicsError(null);
    void apiFetch('/api/hr/aso-clinics', getToken).then(payload => {
      if (cancelled) return;
      const clinics = Array.isArray((payload as { clinics?: unknown[] }).clinics) ? (payload as { clinics: typeof asoClinics }).clinics : [];
      setAsoClinics(clinics.filter(clinic => clinic.active));
    }).catch(caught => {
      if (cancelled) return;
      setAsoClinics([]);
      setAsoClinicsError(caught instanceof Error ? caught.message : 'Não foi possível carregar as clínicas de ASO.');
    }).finally(() => {
      if (!cancelled) setAsoClinicsLoading(false);
    });
    return () => { cancelled = true; };
  }, [canViewAso, getToken, view]);

  useEffect(() => {
    setAccountantEmail(selectedProcess?.accountantWorkflow?.email?.recipient ?? selectedProcess?.accountantWorkflow?.suggestedRecipientEmail ?? '');
    const monthlySalary = selectedProcess?.monthlySalary ?? selectedProcess?.accountantWorkflow?.formData?.monthlySalary;
    setAccountantSalaryDraft(typeof monthlySalary === 'number' && monthlySalary > 0 ? formatBrlCurrency(monthlySalary) : '');
    setAccountantFormTextDraft(accountantFormTextDraftFrom(selectedProcess, roles, jobFunctions));
    setAccountantFormEditing(false);
    const selectableDocumentIds = new Set(applicableOnboardingDocuments(
      selectedProcess?.documents ?? [],
      selectedProcess?.publicFormAnswers,
    ).filter(document => !isAutomaticAccountantDocument(document)).map(document => document.id));
    setAccountantSelectedDocumentIds(
      (selectedProcess?.accountantWorkflow?.selectedDocumentIds ?? []).filter(documentId => selectableDocumentIds.has(documentId)),
    );
  }, [jobFunctions, roles, selectedProcess]);

  useEffect(() => {
    if (selectedProcess?.currentStage === 'document_review' && phaseId === 'documents') {
      setPhaseId('document_review');
      return;
    }
    if (selectedProcess?.currentStage === 'signature' && phaseId === 'signature_preparation') {
      setPhaseId('signature');
    }
  }, [phaseId, selectedProcess?.currentStage]);

  async function patchProcess(processId: string, body: Record<string, unknown>) {
    setUpdating(`${processId}:${body.action ?? 'update'}`);
    setError(null);
    try {
      const payload = await apiFetch(`/api/hr/onboarding/${processId}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }) as { process?: OnboardingProcess };
      if (payload.process?.currentStage === 'accountant' && ['document_status', 'document_status_bulk'].includes(String(body.action))) {
        setPhaseId('accountant');
      }
      if (payload.process) onProcessUpdated(payload.process);
      else onRefresh();
      return payload;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar integração.');
      return null;
    } finally {
      setUpdating(null);
    }
  }

  async function allowIdentityCorrection(process: OnboardingProcess) {
    const reason = window.prompt('Informe o motivo para liberar a correção de nome e CPF:')?.trim();
    if (!reason) return;
    await patchProcess(process.id, { action: 'allow_identity_correction', reason });
  }

  async function refreshAsoWorkflow(processId: string) {
    const payload = await apiFetch(`/api/hr/onboarding/${processId}/aso-workflow?view=workflow`, getToken) as {
      workflow?: NonNullable<OnboardingProcess['asoWorkflow']>;
    };
    if (payload.workflow) onAsoWorkflowUpdated(processId, payload.workflow);
  }

  async function cancelOnboardingProcess(process: OnboardingProcess) {
    const reason = cancelReasonDraft.trim();
    if (reason.length < 10) return;
    const result = await patchProcess(process.id, { action: 'cancel', reason });
    if (!result) return;
    setShowCancelModal(false);
    setCancelReasonDraft('');
    closeProcess();
    setPhaseFilter('all');
    setProcessStateFilter('cancelled');
  }

  async function generateAsoGuide(process: OnboardingProcess) {
    if (!asoClinicEntityId) {
      setError('Selecione a clínica do ASO antes de gerar a solicitação.');
      return;
    }
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      setError('O navegador bloqueou a nova aba. Libere pop-ups para gerar a solicitação.');
      return;
    }
    setAsoGuideBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const validationResponse = await fetch(`/api/hr/onboarding/${process.id}/aso-workflow`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate_request', clinicEntityId: asoClinicEntityId }),
      });
      if (!validationResponse.ok) await readHrJsonResponse(validationResponse, 'Não foi possível preparar a solicitação do ASO.');
      const response = await fetch(`/api/hr/onboarding/${process.id}/aso-guide`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) await readHrJsonResponse(response, 'Falha ao gerar a guia do ASO.');
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/pdf')) {
        throw new Error('A guia foi gerada, mas o servidor não devolveu um PDF válido.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      previewWindow.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      await refreshAsoWorkflow(process.id);
    } catch (caught) {
      previewWindow.close();
      setError(caught instanceof Error ? caught.message : 'Falha ao gerar a guia do ASO.');
    } finally {
      setAsoGuideBusy(false);
    }
  }

  async function asoAction(action: string, body: Record<string, unknown> = {}) {
    if (!selectedProcess) return null;
    setAsoActionBusy(action); setError(null);
    try {
      const payload = await apiFetch(`/api/hr/onboarding/${selectedProcess.id}/aso-workflow`, getToken, { method: 'PATCH', body: JSON.stringify({ action, ...body }) }) as {
        result?: AsoProcessStartResult;
        warning?: string;
        advancedToAccountant?: boolean;
      };
      if (action === 'start_process' && payload.result) {
        setAsoStartResult({ ...payload.result, warning: payload.warning ?? null });
      }
      if (payload.advancedToAccountant) setPhaseId('accountant');
      await refreshAsoWorkflow(selectedProcess.id);
      if (payload.advancedToAccountant) onRefresh();
      return payload;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Falha ao atualizar o fluxo do ASO.';
      setError(message);
      return null;
    } finally { setAsoActionBusy(null); }
  }

  async function openAsoAsset(asset: 'guide' | 'aso' | 'payment_proof' | 'social_contract') {
    if (!selectedProcess) return;
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      setError('O navegador bloqueou a nova aba. Libere pop-ups para visualizar o PDF.');
      return;
    }
    try {
      const token = await getToken();
      const response = await fetch(`/api/hr/onboarding/${selectedProcess.id}/aso-workflow?asset=${asset}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) await readHrJsonResponse(response, 'Falha ao abrir o documento.');
      if (!isPreviewableDocumentContentType(response.headers.get('content-type'), { allowImage: asset === 'aso' })) {
        throw new Error('O servidor não devolveu um arquivo visualizável.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      previewWindow.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) { previewWindow?.close(); setError(caught instanceof Error ? caught.message : 'Falha ao abrir o documento.'); }
  }

  async function generateAccountantForm(process: OnboardingProcess, options: { openPreview?: boolean } = {}) {
    const openPreview = options.openPreview !== false;
    const previewWindow = openPreview ? window.open('', '_blank') : null;
    setAccountantActionBusy('generate_form'); setError(null);
    try {
      const token = await getToken();
      const response = await fetch(`/api/hr/onboarding/${process.id}/accountant-form`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const fallback = response.status === 503
          ? 'O serviço de geração de PDFs ficou temporariamente sem recursos. Tente novamente em instantes.'
          : 'Falha ao gerar o formulário do contador.';
        throw new Error(payload.error || fallback);
      }
      const url = URL.createObjectURL(await response.blob());
      if (previewWindow) previewWindow.location.href = url;
      else if (openPreview) window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000); onRefresh(); setPhaseId('accountant');
      return true;
    } catch (caught) { previewWindow?.close(); setError(caught instanceof Error ? caught.message : 'Falha ao gerar o formulário do contador.'); return false; }
    finally { setAccountantActionBusy(null); }
  }

  async function accountantAction(action: string, body: Record<string, unknown> = {}) {
    if (!selectedProcess) return false;
    setAccountantActionBusy(action); setError(null);
    try {
      await apiFetch(`/api/hr/onboarding/${selectedProcess.id}/accountant-workflow`, getToken, { method: 'PATCH', body: JSON.stringify({ action, ...body }) });
      if (action === 'validate_form') setAccountantActiveStep(2);
      if (action === 'confirm_documents') setAccountantActiveStep(3);
      onRefresh();
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Falha ao atualizar a etapa do contador.'); return false; }
    finally { setAccountantActionBusy(null); }
  }

  async function uploadAccountantRegistryByRh(file: File) {
    if (!selectedProcess) return false;
    setAccountantActionBusy('upload_registry');
    setError(null);
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.set('file', file);
      const response = await fetch(`/api/hr/onboarding/${selectedProcess.id}/accountant-workflow`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      await readHrJsonResponse(response, 'Falha ao anexar a Ficha de Registro.');
      setAccountantActiveStep(3);
      setPhaseId('accountant');
      onRefresh();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao anexar a Ficha de Registro.');
      return false;
    } finally {
      setAccountantActionBusy(null);
    }
  }

  function toggleAccountantStep(step: number) {
    setAccountantActiveStep(step);
  }

  async function saveAccountantFormFields() {
    if (!selectedProcess || !expectedAdmissionDateDraft) return;
    if (canManageAccountantProcess && !accountantFormTextValid) return;
    if (canManageAccountantProcess && canViewSensitiveData && (accountantSalaryDraftValue === null || !accountantSalaryDraftValid)) return;
    const admissionDateChanged = expectedAdmissionDateDraft !== selectedProcess.expectedAdmissionDate?.slice(0, 10);
    const shouldRegenerateForm = admissionDateChanged || accountantSalaryDraftChanged || accountantFormTextChanged;
    if (admissionDateChanged) {
      if (!canEditExpectedAdmissionDate) return;
      const savedDate = await patchProcess(selectedProcess.id, {
        action: 'update_expected_admission_date',
        expectedAdmissionDate: expectedAdmissionDateDraft,
      });
      if (!savedDate) return;
    }
    if (canViewSensitiveData && accountantSalaryDraftChanged && accountantSalaryDraftValue !== null) {
      if (!canManageAccountantProcess) return;
      const saved = await accountantAction('set_monthly_salary', { monthlySalary: accountantSalaryDraftValue });
      if (!saved) return;
    }
    if (accountantFormTextChanged) {
      if (!canManageAccountantProcess) return;
      const saved = await accountantAction('set_form_data', { formData: accountantFormTextDraft });
      if (!saved) return;
    }
    if (accountantSalaryDraftValue !== null) setAccountantSalaryDraft(formatBrlCurrency(accountantSalaryDraftValue));
    setAccountantFormEditing(false);
    if (shouldRegenerateForm) await generateAccountantForm(selectedProcess, { openPreview: false });
  }

  async function openAccountantAsset(asset: 'form' | 'registry') {
    if (!selectedProcess) return;
    const previewWindow = window.open('', '_blank');
    try {
      const token = await getToken();
      const response = await fetch(`/api/hr/onboarding/${selectedProcess.id}/accountant-workflow?asset=${asset}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || 'Falha ao abrir o documento.'); }
      const url = URL.createObjectURL(await response.blob()); if (previewWindow) previewWindow.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) { previewWindow?.close(); setError(caught instanceof Error ? caught.message : 'Falha ao abrir o documento.'); }
  }

  async function signatureAction(action: string, body: Record<string, unknown> = {}) {
    if (!selectedProcess) return null;
    setSignatureBusy(action);
    setError(null);
    try {
      const payload = await apiFetch(
        `/api/hr/onboarding/${selectedProcess.id}/signature-documents`,
        getToken,
        { method: 'POST', body: JSON.stringify({ action, ...body }) }
      ) as SignatureWorkflowPayload;
      setSignatureWorkflow(payload);
      onRefresh();
      return payload;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha no fluxo de assinatura.');
      return null;
    } finally {
      setSignatureBusy(null);
    }
  }

  async function participantSignatureAction(
    action: 'resend_participant' | 'create_signature_link' | 'replace_participant_email',
    participant: NonNullable<SignatureWorkflowPayload['signaturePackage']>['participants'][number],
    body: Record<string, unknown> = {},
  ) {
    if (!selectedProcess) return null;
    const busyKey = `participant:${participant.providerSignatureId}:${action}`;
    setSignatureBusy(busyKey);
    setError(null);
    try {
      const response = await apiFetch(
        `/api/hr/onboarding/${selectedProcess.id}/signature-documents`,
        getToken,
        {
          method: 'POST',
          body: JSON.stringify({
            action,
            actionRequestId: crypto.randomUUID(),
            providerSignatureId: participant.providerSignatureId,
            ...body,
          }),
        },
      ) as SignatureWorkflowPayload | { workflow: SignatureWorkflowPayload; shortLink: string };
      const workflow = 'workflow' in response ? response.workflow : response;
      setSignatureWorkflow(workflow);
      onRefresh();
      return {
        workflow,
        shortLink: 'workflow' in response ? response.shortLink : null,
      };
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha na ação sobre o signatário.');
      return null;
    } finally {
      setSignatureBusy(null);
    }
  }

  async function generateSignaturePackage() {
    if (!selectedProcess || !signatureWorkflow?.packageTemplateIds?.length) return;
    const selected = await signatureAction('select', {
      templateIds: signatureWorkflow.packageTemplateIds,
    });
    if (!selected) return;
    await signatureAction('generate');
  }

  async function openSignaturePlacement() {
    const prepared = await signatureAction('prepare_positions');
    if (!prepared?.signaturePackage?.layout) return;
    setSignaturePlacementOpen(true);
  }

  function closeSignaturePlacement() {
    setSignaturePlacementOpen(false);
    setPhaseId('signature_preparation');
  }

  async function sendPreparedSignaturePackage() {
    const packageHash = signatureWorkflow?.signaturePackage?.packageHash;
    if (!packageHash || !signatureWorkflow?.signaturePackage?.placementReady) return;
    const sent = await signatureAction('send', { expectedPackageHash: packageHash });
    if (!sent) return;
    setSignaturePlacementOpen(false);
    setPhaseId('signature');
  }

  async function viewSignatureDocument(documentId: string) {
    if (!selectedProcess) return;
    const previewWindow = window.open('', '_blank');
    setSignatureBusy(`preview:${documentId}`);
    setError(null);
    try {
      const token = await getToken();
      const response = await fetch(
        `/api/hr/onboarding/${selectedProcess.id}/signature-documents?documentId=${encodeURIComponent(documentId)}&download=preview`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Prévia indisponível.');
      }
      const url = URL.createObjectURL(await response.blob());
      if (previewWindow) previewWindow.location.href = url;
      else window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      previewWindow?.close();
      setError(caught instanceof Error ? caught.message : 'Falha ao visualizar documento.');
    } finally {
      setSignatureBusy(null);
    }
  }

  async function viewSignatureBundle() {
    if (!selectedProcess) return;
    const previewWindow = window.open('', '_blank');
    setSignatureBusy('preview_bundle');
    setError(null);
    try {
      const token = await getToken();
      const response = await fetch(
        `/api/hr/onboarding/${selectedProcess.id}/signature-documents`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'preview_bundle' }),
          cache: 'no-store',
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Pacote completo indisponível.');
      }
      const url = URL.createObjectURL(await response.blob());
      if (previewWindow) previewWindow.location.href = url;
      else window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      previewWindow?.close();
      setError(caught instanceof Error ? caught.message : 'Falha ao visualizar o pacote completo.');
    } finally {
      setSignatureBusy(null);
    }
  }

  async function viewSentSignaturePackage(kind: 'generated' | 'signed') {
    if (!selectedProcess) return;
    const previewWindow = window.open('', '_blank');
    setSignatureBusy(`preview_package:${kind}`);
    setError(null);
    try {
      const token = await getToken();
      const response = await fetch(
        `/api/hr/onboarding/${selectedProcess.id}/signature-documents?package=${kind}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Pacote indisponível.');
      }
      const url = URL.createObjectURL(await response.blob());
      if (previewWindow) previewWindow.location.href = url;
      else window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      previewWindow?.close();
      setError(caught instanceof Error ? caught.message : 'Falha ao visualizar o pacote.');
    } finally {
      setSignatureBusy(null);
    }
  }

  async function copyLink(copyId: string, link: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = link;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedLinkId(copyId);
    window.setTimeout(() => {
      setCopiedLinkId(current => current === copyId ? null : current);
    }, 1800);
  }

  async function saveFinalization(processId: string) {
    const payload = await patchProcess(processId, {
      action: 'save_finalization',
      finalizationSettings: finalizationDraft,
    });
    if (payload?.process?.currentStage === 'integration') setPhaseId('integration');
  }

  async function createCollaborator(processId: string) {
    await patchProcess(processId, { action: 'create_collaborator' });
  }

  async function createFirstAccessLink(processId: string) {
    await patchProcess(processId, { action: 'create_first_access_link' });
  }

  async function completeOnboarding(processId: string) {
    const payload = await patchProcess(processId, { action: 'complete' });
    if (payload?.process?.currentStage === 'done') setPhaseId('done');
  }

  function processDocProgress(process: OnboardingProcess) {
    const documents = (process.documents ?? []).filter(document => document.id !== 'aso_admission' && document.documentTypeCode !== 'ASO_ADMISSION');
    const required = documents.filter(document => document.required !== false);
    const base = required.length > 0 ? required : documents;
    const includeAso = process.employmentRelationshipType !== 'pj';
    const asoDocument = process.asoWorkflow?.asoDocument;
    const asoReceived = includeAso && Boolean(asoDocument?.storagePath);
    const asoApproved = includeAso && asoDocument?.status === 'approved';
    const received = base.filter(document => ['received', 'ai_approved', 'review_required', 'approved'].includes(document.status)).length + (asoReceived ? 1 : 0);
    const approved = base.filter(document => document.status === 'approved').length + (asoApproved ? 1 : 0);
    const total = base.length + (includeAso ? 1 : 0);
    const pending = Math.max(0, total - approved);
    return {
      received,
      approved,
      total,
      pending,
      percent: total > 0 ? Math.round((received / total) * 100) : 0,
    };
  }

  function stageOrderOf(process: OnboardingProcess, stageId?: OnboardingStageId | null) {
    if (!stageId) return -1;
    return consolidatedOnboardingStages(process).find(stage => stage.id === stageId)?.order ?? -1;
  }

  function stageState(process: OnboardingProcess, stageId: OnboardingStageId): 'done' | 'active' | 'pending' {
    if (process.status === 'completed') return 'done';
    const currentOrder = stageOrderOf(process, process.currentStage);
    const stageOrder = stageOrderOf(process, stageId);
    if (currentOrder < 0 || stageOrder < 0) return stageId === process.currentStage ? 'active' : 'pending';
    if (stageId === process.currentStage) return 'active';
    return stageOrder < currentOrder ? 'done' : 'pending';
  }

  function openProcess(process: OnboardingProcess) {
    setSelectedId(process.id);
    setPhaseId(process.currentStage ?? process.stages?.[0]?.id ?? null);
    setAsoPhaseIndex(null);
    setAsoCollapsed(false);
    setCandidateDataCollapsed(false);
    setAccountantActiveStep(accountantCurrentStepNumber(process));
    setView('detail');
    const url = new URL(window.location.href);
    url.searchParams.set('process', process.id);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function closeProcess() {
    setView('grid');
    setSelectedId(null);
    setPhaseId(null);
    setAsoPhaseIndex(null);
    setAsoCollapsed(false);
    setCandidateDataCollapsed(false);
    setAccountantActiveStep(1);
    const url = new URL(window.location.href);
    url.searchParams.delete('process');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function colorForProcess(processId: string) {
    const index = activeProcesses.findIndex(process => process.id === processId);
    return ONBOARDING_CARD_COLORS[(index < 0 ? 0 : index) % ONBOARDING_CARD_COLORS.length];
  }

  function processLinkActive(process: OnboardingProcess) {
    return !!process.publicToken &&
      !process.publicTokenClosedAt &&
      process.status !== 'cancelled' &&
      process.status !== 'completed' &&
      !onboardingPublicLinkExpired(process, new Date(linkClock));
  }

  function hasAuditableDocumentFile(document: OnboardingDocument) {
    return typeof document.fileUrl === 'string' && document.fileUrl.trim().length > 0;
  }

  // ── Grid landing ──────────────────────────────────────────────────────────
  if (view === 'grid' || !selectedProcess) {
    return (
      <>
        <OnboardingProductionLine
          processes={filtered}
          now={linkClock}
          processStateFilter={processStateFilter}
          phaseFilter={phaseFilter}
          healthFilter={healthFilter}
          sortMode={onboardingSortMode}
          search={search}
          canManage={canManage}
          hasMore={pageInfo[processStateFilter].hasMore}
          loadingMore={loadingMoreScope === processStateFilter}
          onProcessStateFilterChange={(next) => {
            setProcessStateFilter(next);
            setPhaseFilter('all');
            setHealthFilter('all');
          }}
          onPhaseFilterChange={setPhaseFilter}
          onHealthFilterChange={setHealthFilter}
          onSortModeChange={setOnboardingSortMode}
          onSearchChange={setSearch}
          onRefresh={onRefresh}
          onOpen={openProcess}
          onNew={() => setShowStartModal(true)}
          onLoadMore={() => onLoadMore(processStateFilter)}
        />
        {showStartModal ? (
          <StartOnboardingModal
            roles={roles}
            jobFunctions={jobFunctions}
            units={units}
            shiftDefinitions={shiftDefinitions}
            getToken={getToken}
            onClose={() => setShowStartModal(false)}
            onCreated={(process) => {
              setShowStartModal(false);
              onRefresh();
              openProcess(process);
            }}
          />
        ) : null}
      </>
    );

  }

  const canCancelSelectedProcess = canManage &&
    selectedProcess.status !== 'completed' && selectedProcess.status !== 'cancelled';
  const cancellationStage = consolidatedOnboardingPhaseId(selectedProcess.currentStage) === 'documents'
    ? 'Formalização · Dados, documentos e ASO'
    : consolidatedOnboardingPhaseId(selectedProcess.currentStage) === 'signature_preparation'
      ? 'Documentação admissional'
    : consolidatedOnboardingStages(selectedProcess).find(stage => stage.id === selectedProcess.currentStage)?.label
      ?? selectedProcess.currentStage
      ?? 'Etapa não informada';
  const cancellationModal = showCancelModal ? (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
      <div role="dialog" aria-modal="true" aria-labelledby="cancel-onboarding-title" className="w-full max-w-lg overflow-hidden rounded-3xl border border-rose-100 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.1em] text-rose-600">Encerramento sem finalização</p>
            <h2 id="cancel-onboarding-title" className="mt-1 text-xl font-black text-slate-950">Encerrar integração</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">{selectedProcess.candidateName ?? 'Candidato'} · {cancellationStage}</p>
          </div>
          <button type="button" onClick={() => setShowCancelModal(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-xs font-semibold leading-relaxed">O processo sairá da lista ativa, o link público será fechado e o registro ficará disponível em <strong>Encerradas</strong>, somente para consulta.</p>
          </div>
          <label className="block">
            <span className="text-sm font-black text-slate-800">Motivo detalhado <span className="text-rose-600">*</span></span>
            <textarea
              autoFocus
              value={cancelReasonDraft}
              onChange={event => setCancelReasonDraft(event.target.value.slice(0, 2000))}
              rows={5}
              placeholder="Explique por que esta integração está sendo encerrada sem chegar à finalização."
              className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
            />
            <span className={`mt-1.5 flex justify-between text-[11px] font-bold ${cancelReasonDraft.trim().length > 0 && cancelReasonDraft.trim().length < 10 ? 'text-rose-600' : 'text-slate-400'}`}>
              <span>{cancelReasonDraft.trim().length < 10 ? 'Informe pelo menos 10 caracteres.' : 'O motivo ficará no histórico do processo.'}</span>
              <span>{cancelReasonDraft.length}/2000</span>
            </span>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
          <button type="button" onClick={() => setShowCancelModal(false)} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 hover:bg-slate-50">Voltar</button>
          <button
            type="button"
            disabled={cancelReasonDraft.trim().length < 10 || updating === `${selectedProcess.id}:cancel`}
            onClick={() => void cancelOnboardingProcess(selectedProcess)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-black text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updating === `${selectedProcess.id}:cancel` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
            Confirmar encerramento
          </button>
        </div>
      </div>
    </div>
  ) : null;
  const asoStartResultModal = asoStartResult ? (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
      <div role="dialog" aria-modal="true" aria-labelledby="aso-start-result-title" className="w-full max-w-2xl overflow-hidden rounded-3xl border border-cyan-100 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.1em] text-cyan-700">Processo do ASO</p>
            <h2 id="aso-start-result-title" className="mt-1 text-xl font-black text-slate-950">Ações realizadas pelo sistema</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">{selectedProcess.candidateName ?? 'Colaboradora'}</p>
          </div>
          <button type="button" onClick={() => setAsoStartResult(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Fechar"><X className="h-5 w-5"/></button>
        </div>
        <div className="space-y-3 px-6 py-5">
          {asoStartResult.warning ? <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"/><p className="text-xs font-semibold leading-relaxed">{asoStartResult.warning}</p></div> : <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"/><p className="text-xs font-semibold leading-relaxed">A solicitação foi enviada à clínica. A entrega e a abertura continuarão sendo monitoradas na etapa do ASO.</p></div>}
          {asoStartResult.emails.map(item => {
            const failed = item.status === 'failed';
            return <div key={`${item.purpose}:${item.recipient}`} className={`rounded-2xl border p-4 ${failed ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}><div className="flex items-start gap-3">{failed ? <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600"/> : <Mail className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700"/>}<div className="min-w-0"><p className="text-sm font-black text-slate-900">E-mail para {item.recipientName}</p><p className="mt-0.5 break-all text-xs font-semibold text-slate-500">{item.recipient}</p><p className="mt-2 text-xs font-bold text-slate-700">Finalidade: {item.purpose}</p><p className={`mt-1 text-[11px] font-black ${failed ? 'text-rose-700' : 'text-emerald-700'}`}>{asoCommunicationStatusLabel(item.status)}{item.error ? ` · ${item.error}` : ''}</p></div></div></div>;
          })}
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4"><div className="flex items-start gap-3"><Wallet className="mt-0.5 h-5 w-5 shrink-0 text-blue-700"/><div><p className="text-sm font-black text-slate-900">Pagamento utilizado no envio</p><p className="mt-1 text-xs font-semibold text-slate-600">{asoStartResult.payment.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} para <strong>{asoStartResult.payment.beneficiary}</strong> · {asoStartResult.payment.maskedDestination}</p><p className="mt-2 text-xs font-black text-blue-800">{asoPaymentStatusLabel(asoStartResult.payment.status)}</p><p className="mt-1 text-[11px] font-semibold leading-relaxed text-blue-700">{asoStartResult.payment.message}</p></div></div></div>
        </div>
        <div className="flex justify-end border-t border-slate-100 bg-slate-50/70 px-6 py-4"><button type="button" onClick={() => setAsoStartResult(null)} className="h-10 rounded-xl bg-slate-950 px-5 text-sm font-black text-white hover:bg-slate-800">Entendi</button></div>
      </div>
    </div>
  ) : null;

  if (selectedProcess.employmentRelationshipType === 'pj') {
    return (
      <div className="space-y-3">
        {canCancelSelectedProcess ? (
          <div className="flex justify-end">
            <button type="button" onClick={() => { setCancelReasonDraft(''); setShowCancelModal(true); }} className="inline-flex h-9 items-center gap-2 rounded-xl border border-rose-200 bg-white px-3.5 text-xs font-black text-rose-700 hover:bg-rose-50">
              <Archive className="h-4 w-4" /> Encerrar integração
            </button>
          </div>
        ) : null}
        {selectedProcess.status === 'cancelled' ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5">
            <p className="text-xs font-black uppercase tracking-wide text-rose-700">Integração encerrada sem finalização</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed text-rose-950">{selectedProcess.cancelReason ?? 'Motivo não registrado.'}</p>
            <p className="mt-2 text-[11px] font-bold text-rose-600">
              {selectedProcess.cancelledAt ? `Encerrada em ${formatOnboardingDate(selectedProcess.cancelledAt)}` : 'Data não registrada'}
              {selectedProcess.cancelledByEmail ? ` · por ${selectedProcess.cancelledByEmail}` : ''}
              {` · etapa: ${cancellationStage}`}
            </p>
          </div>
        ) : null}
        <PjOnboardingDetailPanel
          process={selectedProcess}
          units={units}
          canManage={canManage && selectedProcess.status !== 'cancelled' && selectedProcess.status !== 'completed'}
          getToken={getToken}
          onRefresh={onRefresh}
          onBack={closeProcess}
        />
        {cancellationModal}
      </div>
    );
  }

  // ── Detail (drill-in) ─────────────────────────────────────────────────────
  const progress = processDocProgress(selectedProcess);
  const answers = selectedProcess.publicFormAnswers;
  const currentStageId = selectedProcess.currentStage ?? selectedProcess.stages?.[0]?.id ?? null;
  const requestedActivePhaseId = phaseId ?? currentStageId;
  const activePhaseId = requestedActivePhaseId === 'training'
    ? 'probation'
    : requestedActivePhaseId;
  const isProbationPhase = activePhaseId === 'probation';
  const isExperienceGroupPhase = isProbationPhase;
  // 'probation' não é mais reconstruída por consolidatedOnboardingStages (ver ONBOARDING_STAGE_IDS
  // em recruitment-onboarding.ts) — o acompanhamento de experiência é dirigido por `probationV2`,
  // exibido como uma linha sintética no grupo "Experiência", igual ao treinamento.
  const visibleStages = consolidatedOnboardingStages(selectedProcess);
  const probationV2 = selectedProcess.probationV2 ?? null;
  const probationReleased = probationIsReleasedAfterFormalization(selectedProcess);
  const activeDetails = isProbationPhase
      ? { owner: 'Liderança', focus: 'Trilhas de integração, avaliações dos primeiros 90 dias e decisão de efetivação.' }
      : (activePhaseId ? ONBOARDING_STAGE_DETAILS[activePhaseId as OnboardingStageId] : null);
  const activeKind = isProbationPhase
      ? 'experiencia' as const
      : (activePhaseId ? ONBOARDING_STAGE_KIND[activePhaseId as OnboardingStageId] : 'generico');
  const accent = colorForProcess(selectedProcess.id);
  const profilePhotoUrl = onboardingProfilePhotoUrl(selectedProcess);
  const processIsReadOnly = selectedProcess.status === 'completed' || selectedProcess.status === 'cancelled';
  const canManageAsoProcess = canManageAso && !processIsReadOnly;
  const canManageAccountantProcess = canManageAccountant && !processIsReadOnly;
  const canGenerateDocumentsProcess = canGenerateDocuments && !processIsReadOnly;

  const linkActive = processLinkActive(selectedProcess);
  const publicLink = linkActive && selectedProcess.publicToken
    ? `${PUBLIC_RECRUITMENT_URL}/onboarding/${selectedProcess.publicToken}`
    : null;
  const integrationAlerts = selectedProcess.integrationAlerts ?? [];
  const bizneoAlert = integrationAlerts.find(alert => alert.id === 'bizneo_id');
  const pdvAlert = integrationAlerts.find(alert => alert.id === 'pdv_id');
  const pdvFilialName = selectedProcess.pdvAccess?.filialName?.trim() || null;
  const pdvAwaitingPassword = selectedProcess.pdvAccess?.required === true
    && selectedProcess.pdvAccess?.status === 'pending_password'
    && selectedProcess.firstAccess?.status !== 'used';
  const pdvDisplayAlert = pdvAlert && pdvAwaitingPassword
    ? { ...pdvAlert, message: pdvPendingPasswordMessage(pdvFilialName) }
    : pdvAlert;
  const integrationsResolved = bizneoAlert?.status === 'resolved' && pdvAlert?.status === 'resolved';
  const finalizationSaved = !!selectedProcess.finalizationSettings;
  const userCreated = !!selectedProcess.collaboratorUserId;
  const readyToCreate = finalizationSaved &&
    selectedProcess.currentStage === 'integration';
  const canCreateCollaborator = canManage && !userCreated && readyToCreate &&
    selectedProcess.status !== 'cancelled' && selectedProcess.status !== 'completed';
  const canEditExpectedAdmissionDate = canManage &&
    canUpdateExpectedAdmissionDate(selectedProcess);
  const canEditAccountantFormFields = canEditExpectedAdmissionDate
    || canManageAccountantProcess;
  const deliveryStatus = selectedProcess.accessProvisioning?.email?.status ?? 'not_sent';
  const emailDelivered = deliveryStatus === 'delivered';
  const emailDeliveryFailed = ['bounced', 'failed', 'complained', 'suppressed'].includes(deliveryStatus);
  const passwordCreated = selectedProcess.firstAccess?.status === 'used';
  const firstAccessExpired = !!selectedProcess.firstAccess?.expiresAt &&
    new Date(selectedProcess.firstAccess.expiresAt).getTime() <= linkClock;
  const formalizationAccessCompleted = selectedProcess.accessProvisioning?.status === 'completed';
  const canComplete = canManage && userCreated && formalizationAccessCompleted && integrationsResolved &&
    selectedProcess.status !== 'completed' && selectedProcess.status !== 'cancelled';
  const transportVoucherServiceStatus = resolveTransportVoucherServiceStatus({
    needsTransportVoucher: selectedProcess.finalizationSettings?.needsTransportVoucher,
    publicAnswer: selectedProcess.publicFormAnswers?.wantsTransportVoucher,
    recordedCompleted: selectedProcess.accessProvisioning?.operationalChecks?.transportVoucherSystem?.completed === true,
  });
  const accessIndicators = [
    {
      label: 'Cadastro criado',
      detail: userCreated ? 'Usuária e permissões configuradas' : 'Aguardando envio do cadastro',
      state: userCreated ? 'done' : 'pending',
    },
    {
      label: 'E-mail entregue',
      detail: emailDelivered
        ? 'Confirmado pelo servidor de e-mail'
        : emailDeliveryFailed
          ? selectedProcess.accessProvisioning?.email?.lastError ?? 'A entrega falhou'
          : deliveryStatus === 'delayed'
            ? 'Entrega temporariamente atrasada'
            : userCreated
              ? 'Aguardando confirmação do Resend'
              : 'Ainda não enviado',
      state: emailDelivered ? 'done' : emailDeliveryFailed ? 'failed' : 'pending',
    },
    {
      label: 'Senha cadastrada',
      detail: passwordCreated
        ? 'Primeiro acesso confirmado'
        : firstAccessExpired
          ? 'O link de primeiro acesso venceu'
          : userCreated
            ? 'Aguardando a colaboradora'
            : 'Disponível após criar o cadastro',
      state: passwordCreated ? 'done' : firstAccessExpired ? 'failed' : 'pending',
    },
  ] as const;
  const currentStageOrder = stageOrderOf(selectedProcess, selectedProcess.currentStage);
  const activeStageOrder = stageOrderOf(selectedProcess, isExperienceGroupPhase ? null : activePhaseId);
  const isCurrentPhase = !!activePhaseId && activePhaseId === selectedProcess.currentStage;
  const isFuturePhase = activeStageOrder > currentStageOrder;
  const isPastPhase = activeStageOrder >= 0 && currentStageOrder >= 0 && activeStageOrder < currentStageOrder;
  const canActOnCurrentPhase = canManage && isCurrentPhase &&
    selectedProcess.status !== 'completed' && selectedProcess.status !== 'cancelled';
  const canActOnSignaturePhase = isCurrentPhase &&
    selectedProcess.status !== 'completed' && selectedProcess.status !== 'cancelled';
  const packageSignatureIds = new Set(signatureWorkflow?.packageTemplateIds ?? []);
  const signatureTemplates = (signatureWorkflow?.templates ?? []).filter((template) =>
    packageSignatureIds.has(template.id)
  );
  const selectedSignatureDocuments = (signatureWorkflow?.documents ?? []).filter(
    (document) => document.selected && packageSignatureIds.has(document.templateId)
  );
  const signaturePackageComplete = signatureTemplates.length > 0
    && selectedSignatureDocuments.length === signatureTemplates.length
    && signatureTemplates.every((template) =>
      selectedSignatureDocuments.some((document) => document.templateId === template.id)
    );
  const signatureGenerated = signaturePackageComplete
    && selectedSignatureDocuments.every(document => Boolean(document.generatedDocumentId));
  const selectedBundleDocuments = selectedSignatureDocuments.filter(
    document => document.signatureScope !== 'independent'
  );
  const signatureBundleReady = signaturePackageComplete
    && selectedBundleDocuments.length === selectedSignatureDocuments.length
    && selectedBundleDocuments.every(document => Boolean(document.generatedPdfStoragePath));
  const signaturePackageReviewable = signaturePackageComplete
    && selectedSignatureDocuments.every(document =>
      Boolean(document.generatedPdfStoragePath)
      && !document.missingRequired?.length
      && ['review_pending', 'ready_to_send'].includes(document.status)
    );
  const signaturePackageNeedsReview = signaturePackageReviewable
    && selectedSignatureDocuments.some(document => document.status === 'review_pending');
  const signatureReviewed = signaturePackageComplete
    && selectedSignatureDocuments.every(document => [
      'ready_to_send', 'sending', 'sent', 'viewed', 'partially_signed', 'signed',
      'signed_archived_pending_employee', 'archived',
    ].includes(document.status));
  const signatureSent = selectedSignatureDocuments.length > 0
    && selectedSignatureDocuments.every(document => [
      'sent', 'viewed', 'partially_signed', 'signed', 'signed_archived_pending_employee', 'archived',
    ].includes(document.status));
  const signatureCompleted = selectedSignatureDocuments.length > 0
    && selectedSignatureDocuments.every(document => ['signed', 'signed_archived_pending_employee', 'archived'].includes(document.status));
  const signaturePackageFailedDocument = selectedSignatureDocuments.find(document =>
    ['generation_failed', 'generation_blocked', 'send_failed', 'delivery_failed', 'rejected'].includes(document.status)
  );
  const signaturePackageReference = selectedSignatureDocuments.find(document => document.signatureRequestId)
    ?? selectedSignatureDocuments[0];
  const signaturePackageViewed = selectedSignatureDocuments.some(document =>
    ['viewed', 'partially_signed', 'signed', 'signed_archived_pending_employee', 'archived'].includes(document.status)
    || Boolean(document.viewedAt)
  );
  const signaturePackageArchived = signaturePackageComplete
    && selectedSignatureDocuments.every(document =>
      ['signed_archived_pending_employee', 'archived'].includes(document.status) || Boolean(document.archivedAt)
    );
  const signaturePackageSignedCount = signaturePackageReference?.providerSignedCount ?? 0;
  const signaturePackageSignaturesCount = signaturePackageReference?.providerSignaturesCount ?? 0;
  const signatureParticipants = signatureWorkflow?.signaturePackage?.participants ?? [];
  const signaturePackageTrackingLabel = signaturePackageFailedDocument
    ? SIGNATURE_WORKFLOW_STATUS_LABELS[signaturePackageFailedDocument.status] ?? signaturePackageFailedDocument.status
    : signaturePackageArchived
      ? 'Assinado e arquivado'
      : signatureCompleted
        ? 'Assinado, arquivando'
        : signaturePackageSignedCount > 0 && signaturePackageSignaturesCount > 0
          ? `${signaturePackageSignedCount} de ${signaturePackageSignaturesCount} assinaturas concluídas`
          : signaturePackageViewed
            ? 'Aberto pelos signatários'
            : signatureSent
              ? 'Enviado aos signatários'
              : 'Aguardando envio';
  const signatureMainSteps = [
    { label: 'Gerar pacote', done: signatureGenerated },
    { label: 'Revisar pacote', done: signatureReviewed },
    { label: 'Enviar', done: signatureSent },
    { label: 'Assinar e arquivar', done: signatureCompleted },
  ];
  const signatureCurrentStepIndex = signatureMainSteps.findIndex(step => !step.done);
  const signaturePackageEditable = canGenerateDocumentsProcess && canActOnSignaturePhase && activePhaseId === 'signature_preparation' &&
    !selectedSignatureDocuments.some(document => ['sent', 'viewed', 'partially_signed', 'signed', 'archived'].includes(document.status));
  let selectedOperationalStatus = resolveOnboardingOperationalStatus(selectedProcess, new Date(linkClock));
  if (selectedProcess.status !== 'completed' && selectedProcess.status !== 'cancelled' && signatureWorkflow && ['signature_preparation', 'signature'].includes(selectedProcess.currentStage ?? '')) {
    const selectedDocuments = signatureWorkflow.documents.filter(document => document.selected);
    const failedDocument = selectedDocuments.find(document => ['generation_failed', 'generation_blocked', 'send_failed', 'delivery_failed', 'rejected'].includes(document.status));
    const allSigned = selectedDocuments.length > 0 && selectedDocuments.every(document => ['signed', 'signed_archived_pending_employee', 'archived'].includes(document.status));
    const sent = selectedDocuments.some(document => ['sent', 'viewed', 'partially_signed'].includes(document.status));
    const readyToSend = selectedDocuments.some(document => document.status === 'ready_to_send');
    if (failedDocument) {
      selectedOperationalStatus = {
        ...selectedOperationalStatus,
        health: 'blocked',
        label: ONBOARDING_HEALTH_META.blocked.label,
        headline: 'Documento de assinatura precisa de correção',
        detail: failedDocument.lastError ?? `${failedDocument.documentName ?? failedDocument.templateName} está com falha.`,
        responsible: 'rh',
        priority: 100,
      };
    } else if (!allSigned && sent) {
      selectedOperationalStatus = {
        ...selectedOperationalStatus,
        ...(selectedOperationalStatus.health === 'overdue' ? {} : { health: 'waiting_person' as const, label: ONBOARDING_HEALTH_META.waiting_person.label, priority: 60 }),
        headline: 'Aguardando assinaturas',
        detail: 'Os documentos foram enviados e ainda não estão totalmente assinados.',
        responsible: 'person',
      };
    } else if (readyToSend) {
      selectedOperationalStatus = {
        ...selectedOperationalStatus,
        headline: 'Enviar documentos para assinatura',
        detail: 'A revisão foi concluída e os documentos estão prontos para envio.',
        responsible: 'rh',
      };
    }
  }
  const selectedHealthMeta = ONBOARDING_HEALTH_META[selectedOperationalStatus.health];

  const foodRestrictionRows: Array<[string, string]> = [];
  if (answers?.hasFoodRestriction === 'yes') {
    const foodRestrictions = readOnboardingList(answers, 'foodRestrictions');
    const foodRestrictionOther = readOnboardingAnswer(answers, 'foodRestrictionOther');
    foodRestrictionRows.push(
      [
        'Restrições informadas',
        foodRestrictions === 'Aguardando'
          ? foodRestrictions
          : foodRestrictions.replace('Outro ingrediente', foodRestrictionOther === 'Aguardando' ? 'Outro ingrediente' : `Outro ingrediente: ${foodRestrictionOther}`),
      ],
      ['Impacto na atividade', readOnboardingList(answers, 'foodRestrictionActivityEffects')],
    );
  }
  const probationConfig = selectedProcess.probationV2?.config;
  const probationPeriodLabel = probationConfig
    ? [
        `1º período: ${probationConfig.firstPeriodDays} dias`,
        probationConfig.secondPeriodDays > 0 ? `2º período: ${probationConfig.secondPeriodDays} dias` : null,
        `Total: ${probationConfig.firstPeriodDays + probationConfig.secondPeriodDays} dias`,
      ].filter(Boolean).join('\n')
    : 'Aguardando';
  const formRows: Array<[string, string]> = [
    ['Identificação', readOnboardingChoice(answers, 'identityDocumentType', { identity: 'RG / CIN', cnh: 'CNH' })],
    ['Possui CNH?', readOnboardingChoice(answers, 'hasCnh', { yes: 'Sim', no: 'Não' })],
    ['Vale-transporte', readOnboardingChoice(answers, 'wantsTransportVoucher', { yes: 'Sim', no: 'Não' })],
    ['PIX', readOnboardingAnswer(answers, 'pixKey')],
    ['Uniforme', [
      readOnboardingAnswer(answers, 'uniformShirtSize'),
      readOnboardingAnswer(answers, 'uniformPantsSize'),
      readOnboardingAnswer(answers, 'uniformShoeSize'),
    ].filter(value => value !== 'Aguardando').join(' / ') || 'Aguardando'],
    ['Período de experiência', probationPeriodLabel],
    ['Filhos', readOnboardingChildren(answers)],
    ['Alergia/intolerância alimentar', readOnboardingChoice(answers, 'hasFoodRestriction', { yes: 'Sim', no: 'Não' })],
    ...foodRestrictionRows,
  ];
  const privacyAcceptance = selectedProcess.publicPrivacyAcceptance ?? null;
  const imageVoiceConsent = selectedProcess.consentimento_imagem_voz ?? null;
  const consentDecisions = [
    {
      label: 'Aviso de privacidade',
      answered: Boolean(privacyAcceptance),
      accepted: privacyAcceptance?.acknowledged === true,
      acceptedLabel: 'Ciência confirmada',
      deniedLabel: 'Ciência não confirmada',
    },
    {
      label: 'Tratamento de alergias e restrições',
      answered: typeof privacyAcceptance?.allergyAcknowledged === 'boolean',
      accepted: privacyAcceptance?.allergyAcknowledged === true,
      acceptedLabel: 'Ciência confirmada',
      deniedLabel: 'Ciência não confirmada',
    },
    {
      label: 'Uso de imagem e voz',
      answered: typeof imageVoiceConsent?.autorizado === 'boolean',
      accepted: imageVoiceConsent?.autorizado === true,
      acceptedLabel: 'Autorizado',
      deniedLabel: 'Não autorizado',
    },
  ];
  const showConsentDecisions = Boolean(selectedProcess.publicFormSubmittedAt && (privacyAcceptance || imageVoiceConsent));
  const availableEmployerUnits = units
    .filter(unit => unit.isArchived !== true && CnpjValidator.validate(unit.cnpj ?? '').valid)
    .sort((a, b) => a.name.localeCompare(b.name));

  const okAlert = integrationsResolved;
  const selectedProcessId = selectedProcess.id;
  const reviewDocuments = applicableOnboardingDocuments(
    selectedProcess.documents ?? [],
    answers,
  )
    .map(document => presentOnboardingDocumentForAnswers(document, answers))
    .filter(document => document.id !== 'aso_admission' && document.documentTypeCode !== 'ASO_ADMISSION');
  const accountantRequiredDocuments = reviewDocuments.filter(document => document.required !== false && document.id !== 'aso_admission' && document.documentTypeCode !== 'ASO_ADMISSION');
  const accountantAttachedDocuments = reviewDocuments.filter(document => hasAuditableDocumentFile(document) && document.id !== 'aso_admission' && document.documentTypeCode !== 'ASO_ADMISSION');
  const accountantAutomaticDocuments = accountantAttachedDocuments.filter(document => isAutomaticAccountantDocument(document) && document.status === 'approved');
  const accountantOptionalDocuments = accountantAttachedDocuments.filter(document => !isAutomaticAccountantDocument(document));
  const accountantSelectableDocuments = accountantOptionalDocuments.filter(document => document.status === 'approved');
  const accountantDocumentsReady = accountantRequiredDocuments.every(document => document.status === 'approved');
  const accountantAsoReady = selectedProcess.asoWorkflow?.asoDocument?.status === 'approved';
  const accountantAdmissionDateReady = Boolean(selectedProcess.expectedAdmissionDate);
  const accountantConfiguredSalary = selectedProcess.monthlySalary ?? selectedProcess.accountantWorkflow?.formData?.monthlySalary ?? null;
  const accountantSalaryReady = selectedProcess.monthlySalaryConfigured === true
    || (typeof accountantConfiguredSalary === 'number' && accountantConfiguredSalary > 0);
  const accountantSalaryDraftValue = parseBrlCurrency(accountantSalaryDraft);
  const accountantSalaryDraftValid = accountantSalaryDraftValue !== null && accountantSalaryDraftValue > 0 && accountantSalaryDraftValue <= 1_000_000;
  const accountantSalaryDraftChanged = accountantSalaryDraftValid
    && Math.round(accountantSalaryDraftValue * 100) !== Math.round((accountantConfiguredSalary ?? 0) * 100);
  const accountantSavedFormText = accountantFormTextDraftFrom(selectedProcess, roles, jobFunctions);
  const accountantFormTextValid = ACCOUNTANT_FORM_TEXT_FIELDS.every((key) => accountantFormTextDraft[key].trim().length > 0)
    && maritalStatusIsInformed(accountantFormTextDraft.maritalStatus);
  const accountantFormTextChanged = ACCOUNTANT_FORM_TEXT_FIELDS.some((key) => accountantFormTextDraft[key].trim() !== accountantSavedFormText[key].trim());
  const accountantPrerequisitesReady = accountantDocumentsReady && accountantAsoReady && accountantAdmissionDateReady && accountantSalaryReady;
  const accountantFormRequiresRegeneration = selectedProcess.accountantWorkflow?.latestFormRequiresRegeneration === true;
  const accountantFormValidated = Boolean(
    accountantSalaryReady
    && !accountantFormRequiresRegeneration
    && selectedProcess.accountantWorkflow?.latestFormId
    && selectedProcess.accountantWorkflow.formValidation?.documentId === selectedProcess.accountantWorkflow.latestFormId,
  );
  const confirmedAccountantDocumentIds = selectedProcess.accountantWorkflow?.documentSelection?.selectedDocumentIds ?? [];
  const currentAccountantDocumentIds = [...accountantSelectedDocumentIds].sort();
  const accountantDocumentSelectionConfirmed = Boolean(
    selectedProcess.accountantWorkflow?.email?.sentAt
    || (
      accountantFormValidated
      && selectedProcess.accountantWorkflow?.documentSelection?.documentId === selectedProcess.accountantWorkflow?.latestFormId
      && confirmedAccountantDocumentIds.length === currentAccountantDocumentIds.length
      && [...confirmedAccountantDocumentIds].sort().every((documentId, index) => documentId === currentAccountantDocumentIds[index])
    ),
  );
  const asoWorkflow = selectedProcess.asoWorkflow;
  const asoRequest = asoWorkflow?.requestValidation;
  const asoProcessStarted = Boolean(asoWorkflow?.startedAt);
  const asoConfigurationLocked = Boolean(asoWorkflow?.paymentRequestId || asoProcessStarted);
  const asoFormDataReady = essentialPublicFormDataReady({
    publicFormSubmittedAt: selectedProcess.publicFormSubmittedAt,
    candidateName: selectedProcess.candidateName,
    publicFormAnswers: selectedProcess.publicFormAnswers,
  });
  const asoPaymentReady = asoWorkflow?.paymentStatus === 'paid' && Boolean(asoWorkflow.paymentProofStoragePath);
  const asoSchedulingEmailSent = Boolean(asoWorkflow?.candidateNotification?.sentAt);
  const asoGuideRevisionMatches = !asoWorkflow?.latestGuidePublicFormRevision
    || !selectedProcess.publicFormRevision
    || asoWorkflow.latestGuidePublicFormRevision === selectedProcess.publicFormRevision;
  const asoGuideIsCurrent = asoWorkflow?.latestGuideTemplateVersion === ASO_GUIDE_TEMPLATE_VERSION
    && asoWorkflow?.latestGuideRequiresRegeneration !== true
    && (asoSchedulingEmailSent || asoGuideRevisionMatches);
  const asoEmailPrerequisitesReady = asoFormDataReady && accountantAdmissionDateReady && asoPaymentReady && asoGuideIsCurrent;
  const asoSelectedClinic = asoClinics.find(clinic => clinic.id === asoClinicEntityId) ?? null;
  const asoClinicLocation = asoWorkflow?.clinic?.location
    ?? asoRequest?.clinicLocation
    ?? clinicLocationFromConfig(asoSelectedClinic?.entity?.name, asoSelectedClinic?.address);
  const asoClinicLocationText = clinicLocationLabel(asoClinicLocation);
  const asoRequestMatchesDraft = Boolean(asoRequest) && (asoSchedulingEmailSent || (
    asoRequest?.clinicEntityId === asoClinicEntityId
    && CnpjValidator.clean(asoRequest?.companyCnpj ?? '') === CnpjValidator.clean(selectedProcess.employerCnpj ?? '')
    && (asoRequest?.expectedAdmissionDate ?? null) === (selectedProcess.expectedAdmissionDate ?? null)
    && (asoRequest?.candidateName ?? '').trim() === (selectedProcess.candidateName ?? '').trim()
    && String(asoRequest?.candidateCpf ?? '').replace(/\D/g, '') === String(answers?.cpf ?? '').replace(/\D/g, '')
  ));
  const asoClinicCommunicationFailed = ['failed', 'bounced', 'complained', 'suppressed'].includes(asoWorkflow?.clinic?.emailStatus ?? '');
  const asoHasPendingStartDelivery = asoClinicCommunicationFailed;
  const asoAppointmentAfterAdmission = isAsoAppointmentAfterAdmission(
    asoWorkflow?.appointment?.date,
    selectedProcess.expectedAdmissionDate,
  );
  const asoAppointmentDraftAfterAdmission = isAsoAppointmentAfterAdmission(
    asoAppointmentDraft.date,
    selectedProcess.expectedAdmissionDate,
  );
  const asoRequestReady = Boolean(asoRequest && asoRequestMatchesDraft && asoFormDataReady && accountantAdmissionDateReady);
  const asoPaymentPolling = shouldPollAsoPayment(asoWorkflow?.paymentRequestId, asoWorkflow?.paymentStatus);
  const asoEmailTrackingReady = Boolean(asoSchedulingEmailSent);
  const asoDocumentReady = asoWorkflow?.asoDocument?.status === 'approved';
  const asoDataReviewReady = asoFormDataReady && accountantAdmissionDateReady;
  const asoProgressSteps = [asoRequestReady, asoPaymentReady, asoDataReviewReady, asoEmailTrackingReady, asoDocumentReady];
  const asoCompletedStepCount = asoProgressSteps.filter(Boolean).length;
  const asoCurrentStep = Math.min(
    asoProgressSteps.findIndex(done => !done) + 1 || asoProgressSteps.length,
    asoProgressSteps.length,
  );
  const asoSelectedStepIndex = Math.max(
    0,
    Math.min(asoPhaseIndex ?? asoCurrentStep - 1, asoProgressSteps.length - 1),
  );
  const asoStepLabels = ['Solicitação', 'PIX', 'Conferência', 'Agendamento', 'ASO'] as const;
  const asoStepStates = asoProgressSteps.map((done, index) => (
    done ? 'done' : index === asoCurrentStep - 1 ? 'current' : 'upcoming'
  )) as Array<'done' | 'current' | 'upcoming'>;
  const asoSelectedStepState = asoStepStates[asoSelectedStepIndex] ?? 'upcoming';
  const pendingRequiredDocumentCount = accountantRequiredDocuments.filter(document => document.status !== 'approved').length;
  const firstStageChecklist = [
    {
      label: selectedProcess.publicFormSubmittedAt ? 'Dados do formulário recebidos' : 'Dados do formulário aguardando envio',
      done: Boolean(selectedProcess.publicFormSubmittedAt),
    },
    {
      label: accountantDocumentsReady
        ? 'Documentos obrigatórios aprovados'
        : `${pendingRequiredDocumentCount} documento${pendingRequiredDocumentCount === 1 ? '' : 's'} aguardando aprovação`,
      done: accountantDocumentsReady,
    },
    {
      label: accountantAsoReady
        ? 'ASO admissional aprovado'
        : asoWorkflow?.asoDocument?.status === 'rejected'
          ? 'ASO admissional reprovado — reenvio necessário'
          : asoProcessStarted
            ? 'ASO admissional em andamento'
            : 'ASO admissional ainda não iniciado',
      done: accountantAsoReady,
    },
  ];

  let genericStatus = 'Etapa concluída';
  let genericDesc = activeDetails?.focus ?? '';
  if (activePhaseId === 'signature_preparation') {
    const generated = stageOrderOf(selectedProcess, selectedProcess.currentStage) > stageOrderOf(selectedProcess, 'signature_preparation');
    genericStatus = generated ? 'Documentos gerados' : 'Aguardando geração';
    genericDesc = 'RH gera contrato, termos e anexos a partir dos dados validados e revisa antes de enviar para assinatura.';
  } else if (activePhaseId === 'done') {
    genericStatus = selectedProcess.status === 'completed' ? 'Integração finalizada' : 'Ainda em andamento';
    genericDesc = 'Colaborador ativo no sistema, com acesso liberado e integrações sincronizadas.';
  } else if (activeKind === 'experiencia') {
    genericStatus = selectedProcess.status === 'completed' ? 'Concluído' : 'Acompanhamento de experiência';
    genericDesc = 'Liderança acompanha os primeiros 90 dias. Avaliações e feedbacks registrados neste período contam para a efetivação.';
  }

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-hidden" style={{ animation: 'none' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={closeProcess}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-[13px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar aos candidatos
        </button>
        {canCancelSelectedProcess ? (
          <button
            type="button"
            onClick={() => { setCancelReasonDraft(''); setShowCancelModal(true); }}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-rose-200 bg-white px-3.5 text-[12.5px] font-black text-rose-700 hover:bg-rose-50"
          >
            <Archive className="h-4 w-4" />
            Encerrar integração
          </button>
        ) : null}
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_8px_30px_-14px_rgba(15,23,42,0.2)]">
        <div className="flex flex-wrap items-start justify-between gap-5 border-b border-slate-100 p-6">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10.5px] font-black uppercase tracking-wide text-slate-600">
                {ONBOARDING_STATUS_LABELS[selectedProcess.status] ?? selectedProcess.status}
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10.5px] font-black uppercase tracking-wide ${selectedHealthMeta.badgeClass}`}>
                <span className={`h-2 w-2 rounded-full ${selectedHealthMeta.dotClass}`} />
                {selectedHealthMeta.label}
              </span>
              <span className={`rounded-full px-3 py-1 text-[10.5px] font-black uppercase tracking-wide ${
                linkActive ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-400'
              }`}>
                {linkActive
                  ? formatOnboardingLinkRemaining(selectedProcess, linkClock)
                  : selectedProcess.status === 'cancelled' ? 'Link encerrado' : 'Prazo expirado'}
              </span>
            </div>
            <div className="mt-3.5 flex items-center gap-3">
              <span
                className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl text-[15px] font-black text-white"
                style={{ backgroundColor: accent }}
              >
                {profilePhotoUrl ? (
                  <img src={profilePhotoUrl} alt={selectedProcess.candidateName ?? 'Foto da candidata'} className="h-full w-full object-cover" />
                ) : candidateInitials(selectedProcess.candidateName)}
              </span>
              <div className="min-w-0">
                <h2 className="text-xl font-black tracking-tight text-slate-900">{selectedProcess.candidateName ?? 'Candidato sem nome'}</h2>
                <p className="mt-0.5 text-[13.5px] font-medium text-slate-500">{selectedProcess.candidateEmail ?? 'E-mail não informado'}</p>
              </div>
            </div>
            <p className="mt-3 text-[13.5px] font-bold text-slate-600">
              {selectedProcess.jobRoleName ?? 'Cargo não informado'}
              {selectedProcess.functionName ? ` · ${selectedProcess.functionName}` : ''}
              {selectedProcess.unitName ? ` · ${selectedProcess.unitName}` : ''}
            </p>
            <span className={`mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-black ${selectedProcess.expectedAdmissionDate ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              Data de admissão: {formatOnboardingDateOnly(selectedProcess.expectedAdmissionDate)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="min-w-[92px] rounded-2xl border border-[#eeebe4] bg-[#faf9f6] px-4 py-2.5">
              <div className="text-[9.5px] font-black uppercase tracking-wide text-stone-400">Documentos</div>
              <div className="mt-1 text-[19px] font-black text-emerald-600">{progress.approved}/{progress.total}</div>
              <div className="text-[10px] font-semibold text-stone-400">aprovados</div>
            </div>
            <div className="min-w-[92px] rounded-2xl border border-[#eeebe4] bg-[#faf9f6] px-4 py-2.5">
              <div className="text-[9.5px] font-black uppercase tracking-wide text-stone-400">Etapa</div>
              <div className="mt-1 text-[19px] font-black text-slate-950">{onboardingConceptualStageNumber(selectedProcess)}/7</div>
              <div className="text-[10px] font-semibold text-stone-400">do processo</div>
            </div>
            <div className="min-w-[92px] rounded-2xl border border-[#eeebe4] bg-[#faf9f6] px-4 py-2.5">
              <div className="text-[9.5px] font-black uppercase tracking-wide text-stone-400">Parada</div>
              <div className={`mt-1 text-[19px] font-black ${selectedOperationalStatus.daysInStage > 2 ? 'text-amber-600' : 'text-slate-950'}`}>{selectedOperationalStatus.daysInStage}d</div>
              <div className="text-[10px] font-semibold text-stone-400">nesta etapa</div>
            </div>
            <div className="min-w-[92px] rounded-2xl border border-[#eeebe4] bg-[#faf9f6] px-4 py-2.5">
              <div className="text-[9.5px] font-black uppercase tracking-wide text-stone-400">Responsável</div>
              <div className="mt-2 text-[13px] font-black text-slate-950">{selectedOperationalStatus.responsible === 'rh' ? 'RH' : selectedOperationalStatus.responsible === 'person' ? 'Pessoa' : selectedOperationalStatus.responsible === 'third_party' ? 'Terceiro' : selectedOperationalStatus.responsible === 'system' ? 'Sistema' : 'Concluído'}</div>
              <div className="mt-1 text-[10px] font-semibold text-stone-400">próxima ação</div>
            </div>
          </div>
        </div>

        {error && <div className="px-6 pt-4"><ErrorLine msg={error} /></div>}

        {selectedProcess.status === 'cancelled' ? (
          <div className="px-6 pt-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5">
              <div className="flex items-start gap-3">
                <Archive className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-wide text-rose-700">Integração encerrada sem finalização</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed text-rose-950">{selectedProcess.cancelReason ?? 'Motivo não registrado.'}</p>
                  <p className="mt-2 text-[11px] font-bold text-rose-600">
                    {selectedProcess.cancelledAt ? `Encerrada em ${formatOnboardingDate(selectedProcess.cancelledAt)}` : 'Data não registrada'}
                    {selectedProcess.cancelledByEmail ? ` · por ${selectedProcess.cancelledByEmail}` : ''}
                    {` · etapa: ${cancellationStage}`}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="px-6 pt-4">
          <OnboardingDetailNavigation
            process={selectedProcess}
            activePhaseId={activePhaseId}
            onSelect={setPhaseId}
          />
        </div>

        <div className="px-6 pt-4">
          <section className={`rounded-2xl border p-4 ${selectedHealthMeta.badgeClass}`} aria-labelledby="onboarding-next-action-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${selectedHealthMeta.dotClass}`} />
                <div className="min-w-0">
                  <p id="onboarding-next-action-title" className="text-[10px] font-black uppercase tracking-[0.09em] opacity-70">O que falta para avançar</p>
                  <h3 className="mt-1 text-sm font-black">{selectedOperationalStatus.headline}</h3>
                  <p className="mt-1 text-xs font-semibold leading-relaxed opacity-80">{selectedOperationalStatus.detail}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-[10.5px] font-black">
                {selectedOperationalStatus.responsible !== 'none' ? (
                  <span className="rounded-lg border border-current/20 bg-white/70 px-2.5 py-1.5">
                    Responsável: {selectedOperationalStatus.responsible === 'rh'
                      ? 'RH'
                      : selectedOperationalStatus.responsible === 'person'
                        ? 'Pessoa'
                        : selectedOperationalStatus.responsible === 'third_party'
                          ? 'Terceiro'
                          : 'Sistema'}
                  </span>
                ) : null}
                {selectedOperationalStatus.daysInStage > 0 ? (
                  <span className="rounded-lg border border-current/20 bg-white/70 px-2.5 py-1.5">
                    {selectedOperationalStatus.daysInStage}d na etapa
                  </span>
                ) : null}
              </div>
            </div>
            {['documents', 'document_review'].includes(selectedProcess.currentStage ?? 'documents') ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {firstStageChecklist.map(item => (
                  <div key={item.label} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${item.done ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-current/20 bg-white/70'}`}>
                    {item.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <Clock className="h-4 w-4 shrink-0 opacity-70" />}
                    <span className="min-w-0 flex-1 text-[11.5px] font-black leading-snug">{item.label}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${item.done ? 'bg-emerald-100 text-emerald-700' : 'bg-white/80'}`}>{item.done ? 'Concluído' : 'Pendente'}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <div className="flex flex-wrap items-start gap-5 p-6">
          {/* timeline */}

          {/* phase panel */}
          <div className="min-w-0 flex-1">
            {isFuturePhase ? (
              <div role="alert" className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3.5 text-amber-950 shadow-sm">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-wide">Etapa bloqueada</p>
                  <p className="mt-1 text-xs font-semibold leading-relaxed text-amber-800">
                    Esta etapa ainda não está liberada. Conclua os requisitos das etapas anteriores para habilitar as ações.
                  </p>
                </div>
              </div>
            ) : null}

            {/* PRIMEIRA FASE CONSOLIDADA: COLETA, CONFERÊNCIA E ASO */}
            {(activeKind === 'coleta' || activeKind === 'revisao') && (
              <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
                <div className="order-2 flex min-w-0 flex-col gap-4 lg:col-start-2">
                <section className="order-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <button
                  type="button"
                  onClick={() => setCandidateDataCollapsed(current => !current)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-left"
                  aria-expanded={!candidateDataCollapsed}
                >
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">Dados fornecidos pelo candidato</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${
                      selectedProcess.publicFormSubmittedAt ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {selectedProcess.publicFormSubmittedAt ? 'Enviado' : 'Aguardando'}
                    </span>
                    <span className={`grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-transform ${candidateDataCollapsed ? '-rotate-90' : ''}`}>
                      <ChevronDown className="h-4 w-4" />
                    </span>
                  </span>
                </button>
                {!candidateDataCollapsed ? <>
                <div className="mt-3 grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
                  {formRows.map(([label, value]) => (
                    <div key={label} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                      <div className="break-words text-[10.5px] font-black uppercase leading-tight tracking-wide text-slate-400 [overflow-wrap:anywhere]">{label}</div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-[13px] font-bold text-slate-700">{value}</div>
                    </div>
                  ))}
                </div>
                {showConsentDecisions ? (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <p className="text-[10.5px] font-black uppercase tracking-wide text-slate-500">Autorizações e ciências</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      {consentDecisions.map(decision => (
                        <div key={decision.label} className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 ${decision.accepted ? 'border-emerald-200 bg-emerald-50' : decision.answered ? 'border-rose-300 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}>
                          {decision.accepted ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : decision.answered ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /> : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                          <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{decision.label}</p>
                            <p className={`mt-0.5 text-xs font-black ${decision.accepted ? 'text-emerald-800' : decision.answered ? 'text-rose-700' : 'text-amber-700'}`}>{decision.accepted ? decision.acceptedLabel : decision.answered ? decision.deniedLabel : 'Sem registro'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                </> : null}
                </section>

                {canViewAso ? <div className="order-1 rounded-2xl border border-cyan-300 bg-cyan-50/70 p-4 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setAsoCollapsed(current => !current)}
                    className="grid w-full grid-cols-1 items-start gap-3 text-left sm:grid-cols-[minmax(0,1fr)_auto]"
                    aria-expanded={!asoCollapsed}
                  >
                    <div className="min-w-0">
                      <p className="text-[10.5px] font-black uppercase tracking-wide text-cyan-700">ASO admissional · etapa obrigatória</p>
                      <h4 className="mt-1 text-sm font-black text-slate-900">Solicitação e acompanhamento do exame</h4>
                      <p className="mt-1 max-w-2xl text-xs font-semibold leading-relaxed text-slate-600">O PDF da solicitação segue anexado ao e-mail da clínica. A clínica confirma a data do exame; a empresa define a data de admissão.</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2 sm:justify-self-end">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${asoWorkflow?.asoDocument?.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : asoProcessStarted ? 'bg-blue-100 text-blue-700' : asoRequest ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700'}`}>
                        {asoWorkflow?.asoDocument?.status === 'approved' ? 'Concluído' : asoProcessStarted ? 'Em andamento' : asoRequestReady ? 'Pronto para envio' : 'Em preparação'}
                      </span>
                      <span className={`grid h-8 w-8 place-items-center rounded-lg border border-cyan-200 bg-white text-cyan-700 transition-transform ${asoCollapsed ? '-rotate-90' : ''}`}>
                        <ChevronDown className="h-4 w-4" />
                      </span>
                    </span>
                  </button>

                  {asoCollapsed ? (
                    <div className="mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(112px,1fr))]" aria-label={`${asoCompletedStepCount} de ${asoProgressSteps.length} etapas do ASO concluídas`}>
                      {asoStepLabels.map((label, index) => {
                        const state = asoStepStates[index];
                        const stateLabel = state === 'done' ? 'Concluído' : state === 'current' ? 'Em andamento' : 'Pendente';
                        return (
                          <button
                            key={label}
                            type="button"
                            onClick={() => {
                              setAsoPhaseIndex(index);
                              setAsoCollapsed(false);
                            }}
                            className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition hover:bg-white ${
                              state === 'done'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                : state === 'current'
                                  ? 'border-cyan-300 bg-white text-cyan-800'
                                  : 'border-slate-200 bg-white/70 text-slate-500'
                            }`}
                            aria-label={`Abrir etapa ${label}: ${stateLabel}`}
                          >
                            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                              state === 'done'
                                ? 'bg-emerald-600 text-white'
                                : state === 'current'
                                  ? 'bg-cyan-600 text-white'
                                  : 'bg-slate-100 text-slate-500'
                            }`}>
                              {state === 'done' ? <Check className="h-3.5 w-3.5" /> : index + 1}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[10.5px] font-black uppercase tracking-wide">{label}</span>
                              <span className="mt-0.5 block text-[9.5px] font-bold opacity-80">{stateLabel}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : <>
                    <div className="mt-4 flex items-start" aria-label={`${asoCompletedStepCount} de ${asoProgressSteps.length} etapas do ASO concluídas`}>
                      {asoStepLabels.map((label, index) => {
                        const state = asoStepStates[index];
                        const selected = index === asoSelectedStepIndex;
                        return <React.Fragment key={label}>
                          <button
                            type="button"
                            onClick={() => setAsoPhaseIndex(index)}
                            className="flex shrink-0 flex-col items-center gap-1.5"
                            aria-current={selected ? 'step' : undefined}
                          >
                            <span className={`grid h-9 w-9 place-items-center rounded-full border-2 text-xs font-black transition ${
                              state === 'done'
                                ? 'border-emerald-600 bg-emerald-600 text-white'
                                : state === 'current'
                                  ? 'border-cyan-600 bg-cyan-600 text-white'
                                  : 'border-slate-200 bg-white text-slate-400'
                            } ${selected ? 'ring-4 ring-slate-200' : state === 'current' ? 'ring-4 ring-cyan-100' : ''}`}>
                              {state === 'done' ? <Check className="h-4 w-4" /> : index + 1}
                            </span>
                            <span className={`max-w-[76px] text-center text-[9px] font-black uppercase tracking-wide ${selected ? 'text-slate-900' : state === 'upcoming' ? 'text-slate-400' : 'text-slate-600'}`}>{label}</span>
                          </button>
                          {index < asoStepLabels.length - 1 ? (
                            <span className={`mx-1 mt-[17px] h-[3px] min-w-4 flex-1 rounded-full ${state === 'done' ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                          ) : null}
                        </React.Fragment>;
                      })}
                    </div>

                    {asoSelectedStepIndex === 0 ? <section className={`mt-4 rounded-xl border border-l-4 p-4 ${asoSelectedStepState === 'done' ? 'border-emerald-300 border-l-emerald-600 bg-emerald-50/40' : asoSelectedStepState === 'current' ? 'border-cyan-300 border-l-cyan-600 bg-cyan-50/60' : 'border-slate-200 border-l-slate-300 bg-slate-50/80'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cyan-100 text-[10px] font-black text-cyan-700">1</span>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-700">Solicitação à clínica</p>
                          <p className="mt-1 text-[11px] font-semibold text-slate-500">Confira a solicitação, os dados do formulário e a data de admissão antes de iniciar.</p>
                        </div>
                      </div>
                      <span aria-label={asoRequestReady ? 'Etapa concluída' : 'Etapa pendente'} className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${asoRequestReady ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-transparent'}`}><Check className="h-3.5 w-3.5" /></span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><span className="text-[9.5px] font-black uppercase text-slate-400">Colaboradora</span><p className="mt-1 text-xs font-black text-slate-800">{asoRequest?.candidateName ?? selectedProcess.candidateName}</p><p className="mt-0.5 break-all text-[10.5px] font-semibold text-slate-500">{asoRequest?.candidateEmail ?? selectedProcess.candidateEmail}</p></div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><span className="text-[9.5px] font-black uppercase text-slate-400">CPF e função</span><p className="mt-1 text-xs font-black text-slate-800">{formatOnboardingCpf(asoRequest?.candidateCpf ?? answers?.cpf)}</p><p className="mt-0.5 text-[10.5px] font-semibold text-slate-500">{asoRequest?.jobFunction ?? selectedProcess.functionName ?? selectedProcess.jobRoleName}</p></div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><span className="text-[9.5px] font-black uppercase text-slate-400">Exame e admissão</span><p className="mt-1 text-xs font-black text-slate-800">ASO {asoRequest?.examType === 'dismissal' ? 'demissional' : 'admissional'}</p><p className="mt-0.5 text-[10.5px] font-semibold text-slate-500">Data de admissão: {formatOnboardingDateOnly(asoRequest?.expectedAdmissionDate ?? selectedProcess.expectedAdmissionDate)}</p></div>
                      <label className="rounded-xl border border-slate-100 bg-slate-50 p-3 sm:col-span-2"><span className="text-[9.5px] font-black uppercase text-slate-400">CNPJ responsável</span>{canManageAsoProcess && !asoConfigurationLocked ? <select value={selectedProcess.employerUnitId ?? ''} disabled={updating === `${selectedProcess.id}:set_employer_unit`} onChange={event => { if (event.target.value) void patchProcess(selectedProcess.id, { action: 'set_employer_unit', employerUnitId: event.target.value }); }} className="mt-1 h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-bold text-slate-700"><option value="">Selecione o CNPJ responsável</option>{availableEmployerUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name} · {CnpjValidator.format(unit.cnpj ?? '')}</option>)}</select> : <p className="mt-1 text-xs font-black text-slate-800">{asoRequest?.companyName ?? selectedProcess.employerUnitName ?? 'Não selecionado'} · {CnpjValidator.format(asoRequest?.companyCnpj ?? selectedProcess.employerCnpj ?? '')}</p>}</label>
                      <label className="rounded-xl border border-slate-100 bg-slate-50 p-3"><span className="text-[9.5px] font-black uppercase text-slate-400">Clínica do ASO</span>{canManageAsoProcess && !asoConfigurationLocked ? <><select value={asoClinicEntityId} disabled={asoClinicsLoading || asoClinics.length === 0} onChange={event => setAsoClinicEntityId(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-bold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"><option value="">{asoClinicsLoading ? 'Carregando clínicas...' : asoClinicsError ? 'Clínicas indisponíveis' : asoClinics.length === 0 ? 'Nenhuma clínica configurada' : 'Selecione a clínica'}</option>{asoClinics.map(clinic => <option key={clinic.id} value={clinic.id} disabled={!clinic.paymentProfile?.configured || !clinic.paymentProfile?.validated}>{clinic.entity?.name ?? 'Clínica'} · {Number(clinic.asoPrice).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}{!clinic.paymentProfile?.validated ? ' · PIX pendente' : ''}</option>)}</select>{asoClinicsError ? <span className="mt-1 block text-[10px] font-semibold text-rose-600">{asoClinicsError}</span> : null}</> : <p className="mt-1 text-xs font-black text-slate-800">{asoRequest?.clinicName ?? asoWorkflow?.clinic?.name ?? 'Não selecionada'}</p>}</label>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 sm:col-span-2"><span className="text-[9.5px] font-black uppercase text-slate-400">Envio à clínica</span><p className="mt-1 break-all text-xs font-black text-slate-800">{asoRequest?.clinicEmail ?? asoSelectedClinic?.schedulingEmail ?? 'Selecione a clínica'}</p><p className="mt-0.5 text-[10.5px] font-semibold text-slate-500">A solicitação em PDF seguirá anexada ao e-mail da clínica.</p></div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><span className="text-[9.5px] font-black uppercase text-slate-400">Valor do ASO</span><p className="mt-1 text-xs font-black text-slate-800">{Number(asoRequest?.clinicPrice ?? asoSelectedClinic?.asoPrice ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p><p className="mt-0.5 text-[10.5px] font-semibold text-slate-500">PIX conforme cadastro validado da clínica</p></div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {canManageAsoProcess && !asoProcessStarted ? <button type="button" disabled={asoGuideBusy || !selectedProcess.employerCnpj || !selectedProcess.publicFormSubmittedAt || !asoClinicEntityId} onClick={() => void generateAsoGuide(selectedProcess)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-cyan-200 bg-white px-3.5 text-xs font-black text-cyan-800 disabled:opacity-50">{asoGuideBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <FileText className="h-3.5 w-3.5"/>}{asoWorkflow?.latestGuideId ? 'Atualizar guias' : 'Gerar solicitação em PDF'}</button> : null}
                      {asoWorkflow?.latestGuideId && !asoGuideIsCurrent ? <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-black text-amber-700"><AlertTriangle className="h-3.5 w-3.5"/>PDF anterior desatualizado; atualize as guias</span> : null}
                    </div>
                    </section> : null}

                    {asoSelectedStepIndex === 1 ? <section className={`mt-4 rounded-xl border border-l-4 p-4 ${asoSelectedStepState === 'done' ? 'border-emerald-300 border-l-emerald-600 bg-emerald-50/40' : asoSelectedStepState === 'current' ? 'border-cyan-300 border-l-cyan-600 bg-cyan-50/60' : 'border-slate-200 border-l-slate-300 bg-slate-50/80'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cyan-100 text-[10px] font-black text-cyan-700">2</span>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-700">Pagamento (PIX) do ASO</p>
                          <p className="mt-1 text-[11px] font-semibold text-slate-500">O PIX usa o valor e os dados bancários validados no cadastro da clínica.</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2"><span aria-label={asoPaymentReady ? 'Etapa concluída' : 'Etapa pendente'} className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${asoPaymentReady ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-transparent'}`}><Check className="h-3.5 w-3.5" /></span>{asoPaymentPolling ? <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 text-[11px] font-black text-cyan-800"><RefreshCw className="h-3.5 w-3.5 animate-spin"/>Atualização automática</span> : null}</div>
                    </div>
                    <div className={`mt-3 flex items-start gap-3 rounded-xl border p-3 ${asoPaymentReady ? 'border-emerald-200 bg-emerald-50' : asoWorkflow?.paymentRequestId ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                      <Wallet className={`mt-0.5 h-4 w-4 shrink-0 ${asoPaymentReady ? 'text-emerald-600' : asoWorkflow?.paymentRequestId ? 'text-amber-600' : 'text-slate-400'}`}/>
                      <div className="min-w-0"><p className="text-xs font-black text-slate-800">{asoPaymentReady ? 'Pagamento confirmado' : asoWorkflow?.paymentRequestId ? asoPaymentStatusLabel(asoWorkflow.paymentStatus) : 'Pagamento ainda não solicitado'} · {Number(asoRequest?.clinicPrice ?? asoSelectedClinic?.asoPrice ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p><p className="mt-1 text-[10.5px] font-semibold text-slate-500">{asoPaymentReady ? `Confirmado em ${formatOnboardingDate(asoWorkflow?.paymentConfirmedAt)}` : asoWorkflow?.paymentRequestId ? 'Acompanhe a autorização e a confirmação pelo Banco Inter.' : 'Atualize as guias antes de enviar o PIX ao Financeiro.'}</p></div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!asoWorkflow?.paymentRequestId && canManageAsoProcess ? <button type="button" disabled={!!asoActionBusy || !asoRequest || !asoRequestMatchesDraft} onClick={() => void asoAction('request_payment')} className="inline-flex h-9 items-center gap-2 rounded-lg bg-cyan-700 px-3.5 text-xs font-black text-white disabled:opacity-50">{asoActionBusy === 'request_payment' ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Send className="h-3.5 w-3.5"/>}Enviar para pagamento</button> : null}
                      {asoPaymentReady ? <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 text-xs font-black text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5"/>Pagamento confirmado</span> : null}
                    </div>
                    </section> : null}

                    {asoSelectedStepIndex === 2 ? (
                      <section className={`mt-4 rounded-xl border border-l-4 p-4 ${asoSelectedStepState === 'done' ? 'border-emerald-300 border-l-emerald-600 bg-emerald-50/40' : asoSelectedStepState === 'current' ? 'border-cyan-300 border-l-cyan-600 bg-cyan-50/60' : 'border-slate-200 border-l-slate-300 bg-slate-50/80'}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-start gap-2.5">
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-200 text-[10px] font-black text-slate-600">3</span>
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-700">Conferência dos dados essenciais</p>
                              <p className="mt-1 text-[11px] font-semibold text-slate-500">Valide os dados que seguem para a clínica. A conferência dos demais documentos continua em paralelo e não bloqueia o ASO.</p>
                            </div>
                          </div>
                          <span aria-label={asoDataReviewReady ? 'Etapa concluída' : 'Etapa pendente'} className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${asoDataReviewReady ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-transparent'}`}><Check className="h-3.5 w-3.5" /></span>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          {[
                            { label: 'Dados essenciais do formulário', done: asoFormDataReady, detail: asoFormDataReady ? 'Nome, CPF e função disponíveis' : 'Complete nome, CPF e função' },
                            { label: 'Data de admissão', done: accountantAdmissionDateReady, detail: accountantAdmissionDateReady ? formatOnboardingDateOnly(selectedProcess.expectedAdmissionDate) : 'Defina a data de admissão' },
                            { label: 'Documentos obrigatórios', done: accountantDocumentsReady, detail: accountantDocumentsReady ? 'Todos aprovados' : `${pendingRequiredDocumentCount} em conferência paralela` },
                          ].map(item => (
                            <div key={item.label} className={`rounded-xl border p-3 ${item.done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                              <div className="flex items-start gap-2">
                                {item.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
                                <div className="min-w-0"><p className="text-[11px] font-black text-slate-800">{item.label}</p><p className="mt-0.5 text-[10.5px] font-semibold leading-relaxed text-slate-500">{item.detail}</p></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}

                    {asoSelectedStepIndex === 3 ? <section className={`mt-4 rounded-xl border border-l-4 p-4 ${asoSelectedStepState === 'done' ? 'border-emerald-300 border-l-emerald-600 bg-emerald-50/40' : asoSelectedStepState === 'current' ? 'border-cyan-300 border-l-cyan-600 bg-cyan-50/60' : 'border-slate-200 border-l-slate-300 bg-slate-50/80'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-start gap-2.5"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-200 text-[10px] font-black text-slate-600">4</span><div><p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-700">Envio e acompanhamento</p><p className="mt-1 text-[11px] font-semibold text-slate-500">O sistema registra o envio à clínica, o agendamento, o aviso ao candidato(a) e o recebimento do ASO.</p></div></div><div className="flex items-center gap-2"><span aria-label={asoEmailTrackingReady ? 'Etapa concluída' : 'Etapa pendente'} className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${asoEmailTrackingReady ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-transparent'}`}><Check className="h-3.5 w-3.5" /></span>{canManageAsoProcess && asoRequest && (!asoProcessStarted || asoHasPendingStartDelivery) ? <button type="button" disabled={!!asoActionBusy || !asoRequestMatchesDraft || !asoEmailPrerequisitesReady} onClick={() => void asoAction('start_process')} className="inline-flex h-9 items-center gap-2 rounded-lg bg-cyan-700 px-3.5 text-xs font-black text-white disabled:opacity-50">{asoActionBusy === 'start_process' ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Send className="h-3.5 w-3.5"/>}{asoProcessStarted ? 'Tentar envio à clínica' : 'Enviar solicitação à clínica'}</button> : null}</div></div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" disabled={!asoWorkflow?.latestGuideId || !asoGuideIsCurrent} onClick={() => void openAsoAsset('guide')} className="inline-flex h-9 items-center gap-2 rounded-lg border border-cyan-200 bg-white px-3 text-xs font-black text-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"><Eye className="h-3.5 w-3.5"/>Ver solicitação</button>
                      <button type="button" disabled={!asoWorkflow?.paymentProofStoragePath} onClick={() => void openAsoAsset('payment_proof')} className="inline-flex h-9 items-center gap-2 rounded-lg border border-cyan-200 bg-white px-3 text-xs font-black text-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"><Eye className="h-3.5 w-3.5"/>Ver comprovante de pagamento</button>
                      <button type="button" onClick={() => void openAsoAsset('social_contract')} className="inline-flex h-9 items-center gap-2 rounded-lg border border-cyan-200 bg-white px-3 text-xs font-black text-cyan-800"><Eye className="h-3.5 w-3.5"/>Ver contrato social</button>
                    </div>
                    {!asoProcessStarted ? <div className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-xs font-semibold ${asoEmailPrerequisitesReady ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>{asoEmailPrerequisitesReady ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0"/> : <Clock className="mt-0.5 h-4 w-4 shrink-0"/>}{asoEmailPrerequisitesReady ? 'Pré-requisitos concluídos. O envio da solicitação à clínica está liberado.' : 'Aguardando solicitação em PDF, pagamento, dados essenciais e data de admissão.'}</div> : <>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {[
                          {
                            label: 'Solicitação à clínica',
                            done: Boolean(asoWorkflow?.clinic?.sentAt),
                            failed: asoClinicCommunicationFailed,
                            detail: asoClinicCommunicationFailed
                              ? asoWorkflow?.clinic?.lastError || asoCommunicationStatusLabel(asoWorkflow?.clinic?.emailStatus)
                              : asoWorkflow?.clinic?.email || asoCommunicationStatusLabel(asoWorkflow?.clinic?.emailStatus),
                            tracking: asoWorkflow?.clinic,
                            includeReply: true,
                            appointmentControls: false,
                          },
                          {
                            label: 'Agendamento da clínica',
                            done: Boolean(asoWorkflow?.appointment?.proposedAt || asoWorkflow?.appointmentStatus === 'confirmed'),
                            failed: false,
                            detail: asoWorkflow?.appointmentStatus === 'confirmed'
                              ? `${formatOnboardingDateOnly(asoWorkflow.appointment?.date)} às ${asoWorkflow.appointment?.time}`
                              : asoWorkflow?.appointment?.proposedAt
                                ? `Informado via ${asoWorkflow.appointment.source === 'clinic_form' ? 'link da clínica' : asoWorkflow.appointment.source === 'inbound_email' ? 'resposta por e-mail' : 'registro manual'}`
                                : 'Aguardando retorno pelo link ou e-mail',
                            tracking: null,
                            includeReply: false,
                            appointmentControls: true,
                          },
                          {
                            label: 'Agendamento enviado ao candidato(a)',
                            done: Boolean(asoWorkflow?.candidateNotification?.sentAt),
                            failed: ['failed', 'bounced', 'complained', 'suppressed'].includes(asoWorkflow?.candidateNotification?.emailStatus ?? ''),
                            detail: ['failed', 'bounced', 'complained', 'suppressed'].includes(asoWorkflow?.candidateNotification?.emailStatus ?? '')
                              ? asoWorkflow?.candidateNotification?.lastError || asoCommunicationStatusLabel(asoWorkflow?.candidateNotification?.emailStatus)
                              : selectedProcess.candidateEmail,
                            tracking: asoWorkflow?.candidateNotification,
                            includeReply: false,
                            appointmentControls: false,
                          },
                        ].map(item => <div key={item.label} className={`rounded-xl border p-3 ${item.failed ? 'border-rose-200 bg-rose-50' : item.done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}><div className="flex items-start gap-2">{item.failed ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600"/> : item.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"/> : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"/>}<div className="min-w-0"><p className="text-[11px] font-black text-slate-800">{item.label}</p><p className="mt-0.5 break-words text-[10.5px] font-semibold leading-relaxed text-slate-500">{item.detail}</p></div></div>{item.tracking ? <AsoEmailTrackingMilestones communication={item.tracking} includeReply={item.includeReply} /> : null}{item.appointmentControls ? <div className="mt-3 border-t border-slate-200 pt-3"><p className="text-[9px] font-black uppercase tracking-wide text-violet-700">Retorno e confirmação</p><p className="mt-1 text-[10px] font-semibold leading-relaxed text-slate-500">O link enviado à clínica preenche data e horário automaticamente. Se necessário, o RH pode informar os dados antes de confirmar.</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><input type="date" value={asoAppointmentDraft.date} onChange={event => setAsoAppointmentDraft(current => ({ ...current, date: event.target.value }))} className="h-9 min-w-0 rounded-lg border bg-white px-3 text-xs"/><input type="time" value={asoAppointmentDraft.time} onChange={event => setAsoAppointmentDraft(current => ({ ...current, time: event.target.value }))} className="h-9 min-w-0 rounded-lg border bg-white px-3 text-xs"/></div><div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-violet-100 bg-white px-3 py-2"><p className="text-[9px] font-black uppercase tracking-wide text-violet-600">Local do exame</p>{asoClinicLocationText ? <TooltipProvider delayDuration={150}><Tooltip><TooltipTrigger asChild><button type="button" aria-label="Ver endereço completo da clínica" className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-violet-100 text-violet-600 hover:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-300"><Info className="h-3 w-3"/></button></TooltipTrigger><TooltipContent side="top" align="end" className="max-w-[320px] text-xs font-semibold leading-relaxed"><p>{asoClinicLocationText}</p></TooltipContent></Tooltip></TooltipProvider> : null}</div>{asoAppointmentDraftAfterAdmission ? <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/><p className="text-[10px] font-bold leading-relaxed">O exame está depois da admissão prevista para {formatOnboardingDateOnly(selectedProcess.expectedAdmissionDate)}. O registro será permitido, mas o RH deverá revisar o cronograma.</p></div> : null}{canManageAsoProcess ? <div className="mt-2 flex justify-end"><button type="button" disabled={!!asoActionBusy || !asoAppointmentDraft.date || !asoAppointmentDraft.time} onClick={() => void asoAction('confirm_appointment', asoAppointmentDraft)} className="h-8 rounded-md bg-violet-700 px-2.5 text-[9px] font-black text-white disabled:opacity-50">{asoActionBusy === 'confirm_appointment' ? 'Enviando aviso...' : 'Confirmar e avisar candidato(a)'}</button></div> : null}</div> : null}</div>)}
                      </div>
                      {asoAppointmentAfterAdmission ? <div role="alert" className="mt-3 flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-rose-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600"/><div><p className="text-xs font-black">Exame marcado depois da data de admissão</p><p className="mt-1 text-[11px] font-semibold leading-relaxed">A clínica informou {formatOnboardingDateOnly(asoWorkflow?.appointment?.date)}, mas a empresa definiu a admissão para {formatOnboardingDateOnly(selectedProcess.expectedAdmissionDate)}. Revise a admissão ou solicite um exame anterior.</p></div></div> : null}
                    </>}
                    </section> : null}

                    {asoSelectedStepIndex === 4 ? (
                      <section className={`mt-4 rounded-xl border border-l-4 p-4 ${asoSelectedStepState === 'done' ? 'border-emerald-300 border-l-emerald-600 bg-emerald-50/40' : asoSelectedStepState === 'current' ? 'border-cyan-300 border-l-cyan-600 bg-cyan-50/60' : 'border-slate-200 border-l-slate-300 bg-slate-50/80'}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-start gap-2.5">
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-200 text-[10px] font-black text-slate-600">5</span>
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-700">ASO recebido e validado</p>
                              <p className="mt-1 text-[11px] font-semibold text-slate-500">
                                {asoWorkflow?.asoDocument?.storagePath
                                  ? 'Confira o arquivo recebido e registre a decisão do RH.'
                                  : 'Aguardando o upload do ASO após a realização do exame.'}
                              </p>
                            </div>
                          </div>
                          <span
                            aria-label={asoDocumentReady ? 'Etapa concluída' : 'Etapa pendente'}
                            className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${asoDocumentReady ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-transparent'}`}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        </div>

                        {asoWorkflow?.asoDocument?.storagePath ? (
                          <div className={`mt-3 rounded-xl border p-3 ${asoDocumentReady ? 'border-emerald-200 bg-emerald-50' : asoWorkflow.asoDocument.status === 'rejected' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}>
                            <p className="text-xs font-black text-slate-800">{asoWorkflow.asoDocument.fileName}</p>
                            <p className="mt-1 text-[11px] font-semibold text-slate-600">Situação: {asoWorkflow.asoDocument.status}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button type="button" onClick={() => void openAsoAsset('aso')} className="h-9 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-black text-emerald-700">Ver ASO anexado</button>
                              {canManageAsoProcess && asoWorkflow.asoDocument.status !== 'approved' ? (
                                <>
                                  <button type="button" disabled={!!asoActionBusy} onClick={() => void asoAction('review_aso', { decision: 'approved' })} className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50">Aprovar ASO</button>
                                  <button type="button" disabled={!!asoActionBusy} onClick={() => { const reason = window.prompt('Motivo da rejeição:'); if (reason) void asoAction('review_aso', { decision: 'rejected', reason }); }} className="h-9 rounded-lg bg-rose-600 px-3 text-xs font-black text-white disabled:opacity-50">Rejeitar</button>
                                </>
                              ) : null}
                            </div>
                            {asoDocumentReady ? <p className="mt-2 text-[10.5px] font-semibold text-emerald-700">Documento aprovado pelo RH.</p> : null}
                          </div>
                        ) : (
                          <div className="mt-3 flex items-start gap-2 rounded-xl border border-dashed border-slate-300 bg-white/70 p-3 text-xs font-semibold text-slate-600">
                            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                            <span>Aguardando o upload do ASO pelo candidato(a) após a realização do exame.</span>
                          </div>
                        )}
                      </section>
                    ) : null}
                  </>}
                </div> : null}

                <div className="order-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 shadow-sm">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-black text-slate-900">Link do formulário público</div>
                    <div className={`mt-0.5 text-xs font-bold ${linkActive ? 'text-blue-600' : 'text-slate-400'}`}>
                      {linkActive
                        ? `${formatOnboardingLinkRemaining(selectedProcess, linkClock)} · validade inicial de 72h`
                        : selectedProcess.publicTokenClosedAt ? 'Link encerrado' : 'Prazo expirado'}
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-500">
                      {selectedProcess.publicTokenClosedAt && selectedProcess.publicFormSubmittedAt
                        ? 'Envio concluído. Para corrigir nome ou CPF, gere uma liberação específica com um novo link.'
                        : onboardingPublicLinkExtensionUsed(selectedProcess)
                        ? 'A prorrogação única de 24h já foi utilizada.'
                        : 'O RH pode conceder uma única prorrogação de 24h. Dados e documentos são preservados.'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canManage && selectedProcess.publicFormSubmittedAt && selectedProcess.identityCorrection?.status !== 'authorized' && !processIsReadOnly ? (
                      <button
                        type="button"
                        disabled={updating === `${selectedProcess.id}:allow_identity_correction`}
                        onClick={() => void allowIdentityCorrection(selectedProcess)}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3.5 text-[12.5px] font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                      >
                        {updating === `${selectedProcess.id}:allow_identity_correction` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                        Permitir correção de nome/CPF
                      </button>
                    ) : selectedProcess.identityCorrection?.status === 'authorized' ? (
                      <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 text-[12.5px] font-bold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Correção de nome/CPF liberada
                      </span>
                    ) : null}
                    {publicLink ? (
                      <button
                        type="button"
                        onClick={() => copyLink(`${selectedProcess.id}:public`, publicLink)}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-[12.5px] font-bold text-slate-600 hover:bg-slate-100"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copiedLinkId === `${selectedProcess.id}:public` ? 'Copiado' : 'Copiar link'}
                      </button>
                    ) : null}
                    {canManage && selectedProcess.publicToken && !selectedProcess.publicTokenClosedAt && !onboardingPublicLinkExtensionUsed(selectedProcess) ? (
                      <button
                        type="button"
                        disabled={updating === `${selectedProcess.id}:extend_public_link`}
                        onClick={() => patchProcess(selectedProcess.id, { action: 'extend_public_link' })}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 text-[12.5px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                      >
                        {updating === `${selectedProcess.id}:extend_public_link` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                        Prorrogar 24h
                      </button>
                    ) : null}
                  </div>
                </div>
                </div>

                <div className="order-1 min-w-0 lg:col-start-1">
                  <OnboardingDocumentWorkbench
                    documents={reviewDocuments}
                    canReview={canReviewDocuments}
                    disabled={activeKind !== 'revisao' || !canActOnCurrentPhase || processIsReadOnly}
                    busyAction={updating}
                    onStatusChange={(documentId, status, note) => patchProcess(selectedProcess.id, {
                      action: 'document_status',
                      documentId,
                      status,
                      note,
                    })}
                    onBulkStatusChange={(documentIds, status, note) => patchProcess(selectedProcess.id, {
                      action: 'document_status_bulk',
                      documentIds,
                      status,
                      note,
                    })}
                    onConfirmField={(documentId, fieldKey) => patchProcess(selectedProcess.id, {
                      action: 'confirm_document_field',
                      documentId,
                      fieldKey,
                    })}
                    onCorrectField={(documentId, fieldKey, value) => patchProcess(selectedProcess.id, {
                      action: 'correct_document_field',
                      documentId,
                      fieldKey,
                      value,
                    })}
                  />
                </div>
              </div>
            )}

            {/* CONTADOR */}
            {activeKind === 'contador' && canViewAccountant && (
              <div className="mt-4 space-y-4">
                <div className="flex flex-col items-stretch gap-2 md:flex-row md:gap-0" aria-label="Etapas do envio para a contabilidade">
                  {[
                    {
                      number: 1,
                      label: 'Formulário admissional',
                      hint: 'conferir e editar os dados',
                      state: accountantFormValidated ? 'Concluído' : 'Em andamento',
                      done: accountantFormValidated,
                      current: !accountantFormValidated,
                    },
                    {
                      number: 2,
                      label: 'Documentos do pacote',
                      hint: 'anexos automáticos e opcionais',
                      state: accountantDocumentSelectionConfirmed ? 'Concluído' : accountantFormValidated ? 'Em andamento' : 'A seguir',
                      done: accountantDocumentSelectionConfirmed,
                      current: accountantFormValidated && !accountantDocumentSelectionConfirmed,
                    },
                    {
                      number: 3,
                      label: 'Envio e Ficha de Registro',
                      hint: 'e-mail, acompanhamento e retorno',
                      state: selectedProcess.accountantWorkflow?.registryDocument?.status === 'approved'
                        ? 'Concluído'
                        : accountantDocumentSelectionConfirmed ? 'Em andamento' : 'A seguir',
                      done: selectedProcess.accountantWorkflow?.registryDocument?.status === 'approved',
                      current: accountantDocumentSelectionConfirmed
                        && selectedProcess.accountantWorkflow?.registryDocument?.status !== 'approved',
                    },
                  ].map((step, index) => {
                    const selected = accountantActiveStep === step.number;
                    return <React.Fragment key={step.number}>
                      <button
                        type="button"
                        onClick={() => toggleAccountantStep(step.number)}
                        aria-current={selected ? 'step' : undefined}
                        className={`min-w-0 flex-1 rounded-xl border border-b-[3px] px-3 py-3 text-left transition ${
                          selected
                            ? 'border-slate-900 border-b-slate-900 bg-white shadow-sm'
                            : step.done
                              ? 'border-emerald-100 border-b-emerald-400 bg-emerald-50/50 hover:bg-emerald-50'
                              : 'border-stone-200 border-b-stone-200 bg-stone-50/70 hover:bg-white'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg font-mono text-[11px] font-bold ${
                            step.done
                              ? 'bg-emerald-100 text-emerald-700'
                              : step.current
                                ? 'bg-slate-900 text-white'
                                : 'bg-stone-200 text-stone-500'
                          }`}>{step.number}</span>
                          <span className={`min-w-0 truncate text-[12.5px] font-black ${selected ? 'text-slate-950' : 'text-stone-700'}`}>{step.label}</span>
                        </span>
                        <span className="mt-1.5 block text-[10.5px] font-semibold leading-snug text-stone-500">{step.hint}</span>
                        <span className={`mt-1 block text-[9.5px] font-black uppercase tracking-wide ${step.done ? 'text-emerald-600' : step.current ? 'text-slate-900' : 'text-stone-400'}`}>{step.state}</span>
                      </button>
                      {index < 2 ? <span className="hidden w-6 shrink-0 items-center justify-center text-stone-300 md:flex"><ChevronRight className="h-4 w-4" /></span> : null}
                    </React.Fragment>;
                  })}
                </div>

                {accountantActiveStep === 1 ? <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.08em] text-stone-500">Formulário admissional</p>
                    <h4 className="mt-1 text-sm font-black text-slate-900">Dados que vão para o contador</h4>
                    <p className="mt-1 text-xs font-semibold text-slate-600">Os campos começam bloqueados. Use “Editar” para alterar e confirme em “OK”; o PDF timbrado será atualizado automaticamente em uma única nova versão, preservada para auditoria.</p>
                  </div>
                  {canEditAccountantFormFields ? <div className="mt-3 flex justify-end">
                    {accountantFormEditing ? <button type="button" disabled={!!accountantActionBusy || !!updating || !expectedAdmissionDateDraft || (canManageAccountantProcess && !accountantFormTextValid) || (canManageAccountantProcess && canViewSensitiveData && !accountantSalaryDraftValid)} onClick={() => void saveAccountantFormFields()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50">{accountantActionBusy === 'set_monthly_salary' || accountantActionBusy === 'set_form_data' || updating === `${selectedProcess.id}:update_expected_admission_date` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}OK</button> : <button type="button" disabled={!!accountantActionBusy || !!updating} onClick={() => setAccountantFormEditing(true)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-blue-700 disabled:opacity-50"><Pencil className="h-3.5 w-3.5" />Editar</button>}
                  </div> : null}
                  <div className="mt-2 grid gap-2 rounded-xl border border-blue-200 bg-white p-3 sm:grid-cols-2">
                    {ACCOUNTANT_FORM_TEXT_FIELD_CONFIG.map((field) => <label key={field.key} className={`min-w-0 text-[10px] font-black uppercase tracking-wide text-slate-600 ${field.wide ? 'sm:col-span-2' : ''}`}>{field.label}
                      {field.wide ? <textarea value={accountantFormTextDraft[field.key]} onChange={event => setAccountantFormTextDraft(previous => ({ ...previous, [field.key]: event.target.value }))} disabled={!accountantFormEditing || !canManageAccountantProcess || !!accountantActionBusy} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold normal-case text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700" /> : field.options ? <select value={accountantFormTextDraft[field.key]} onChange={event => setAccountantFormTextDraft(previous => ({ ...previous, [field.key]: event.target.value }))} disabled={!accountantFormEditing || !canManageAccountantProcess || !!accountantActionBusy} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold normal-case text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"><option value="Não informado">Selecione</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select> : <input value={accountantFormTextDraft[field.key]} onChange={event => setAccountantFormTextDraft(previous => ({ ...previous, [field.key]: event.target.value }))} onBlur={() => {
                        if (field.key === 'employerCnpj') setAccountantFormTextDraft(previous => ({ ...previous, employerCnpj: CnpjValidator.format(previous.employerCnpj) }));
                        if (field.key === 'employeeCpf') setAccountantFormTextDraft(previous => ({ ...previous, employeeCpf: formatOnboardingCpf(previous.employeeCpf) }));
                      }} disabled={!accountantFormEditing || !canManageAccountantProcess || !!accountantActionBusy} type="text" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold normal-case text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700" />}
                    </label>)}
                    <label className="min-w-0 text-[10px] font-black uppercase tracking-wide text-slate-600">Data de admissão
                      <input value={expectedAdmissionDateDraft} onChange={event => setExpectedAdmissionDateDraft(event.target.value)} disabled={!accountantFormEditing || !canEditExpectedAdmissionDate || !!accountantActionBusy} type="date" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700" />
                    </label>
                    {canViewSensitiveData ? <label className="min-w-0 flex-1 text-[10px] font-black uppercase tracking-wide text-slate-600">Remuneração mensal
                      <input value={accountantSalaryDraft} onChange={event => setAccountantSalaryDraft(event.target.value)} onBlur={() => { if (accountantSalaryDraftValue !== null) setAccountantSalaryDraft(formatBrlCurrency(accountantSalaryDraftValue)); }} disabled={!accountantFormEditing || !canManageAccountantProcess || !!accountantActionBusy} type="text" inputMode="decimal" placeholder="R$ 0,00" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700" />
                    </label> : null}
                  </div>
                  {!canViewSensitiveData && !accountantSalaryReady ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">A remuneração precisa ser preenchida por alguém com acesso a dados sensíveis.</p> : null}
                  {!maritalStatusIsInformed(accountantFormTextDraft.maritalStatus) ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">O formulário inicial não coletou o estado civil desta candidata. Clique em “Editar”, confirme o estado civil e pressione “OK” antes de gerar o formulário.</p> : null}
                  {accountantFormRequiresRegeneration ? <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-900">A versão anterior ficou desatualizada após alteração dos dados. Gere uma nova versão para validar e enviar.</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canManageAccountantProcess ? <button type="button" disabled={!!accountantActionBusy || !accountantPrerequisitesReady || !accountantFormTextValid} onClick={() => void generateAccountantForm(selectedProcess)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-700 px-3 text-xs font-black text-white disabled:opacity-50">{accountantActionBusy === 'generate_form' ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <FileText className="h-3.5 w-3.5"/>}Gerar/atualizar formulário</button> : null}
                    {selectedProcess.accountantWorkflow?.latestFormId ? <button type="button" disabled={accountantFormRequiresRegeneration} title={accountantFormRequiresRegeneration ? 'Gere/atualize o formulário para visualizar a versão atual.' : undefined} onClick={() => void openAccountantAsset('form')} className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-blue-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"><Eye className="h-3.5 w-3.5"/>Visualizar</button> : null}
                    {selectedProcess.accountantWorkflow?.latestFormId && !accountantFormRequiresRegeneration && !accountantFormValidated && canManageAccountantProcess ? <button type="button" disabled={!!accountantActionBusy || !accountantSalaryReady} onClick={() => void accountantAction('validate_form')} className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5"/>{accountantActionBusy === 'validate_form' ? 'Validando...' : 'Validar e avançar para documentos'}</button> : null}
                    {accountantFormValidated ? <span className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-100 px-3 text-xs font-black text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5"/>Versão validada</span> : null}
                  </div>
                </div> : null}

                  {accountantActiveStep === 2 ? <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                    <p className="text-[10px] font-black uppercase tracking-[0.08em] text-stone-500">Pacote admissional</p>
                    <h4 className="mt-1 text-sm font-black text-slate-900">O que vai no e-mail do contador</h4>
                    <p className="mt-1 text-xs font-semibold text-slate-600">O formulário, o ASO, a identificação da candidata e os documentos dos filhos são anexos automáticos. O RH seleciona abaixo somente os demais documentos; itens ainda não aprovados ficam visíveis, mas bloqueados.</p>
                    {!accountantFormValidated ? <p className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 p-3 text-xs font-bold text-slate-600"><LockKeyhole className="h-4 w-4 shrink-0"/>Gere e valide o formulário na etapa 1 para liberar a confirmação dos documentos.</p> : null}
                    <section className="mt-4 rounded-2xl border border-emerald-200 bg-white/80 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h5 className="text-xs font-black text-emerald-900">Anexos obrigatórios</h5>
                          <p className="mt-0.5 text-[11px] font-semibold text-emerald-800">Já estão incluídos automaticamente e não precisam ser selecionados.</p>
                        </div>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[9px] font-black uppercase text-emerald-700">Inclusão automática</span>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {[
                          { label: 'Formulário de admissão para a contabilidade', onOpen: accountantFormRequiresRegeneration ? null : () => openAccountantAsset('form') },
                          { label: 'ASO admissional finalizado', onOpen: canViewAso ? () => openAsoAsset('aso') : null },
                        ].map(item => <div key={item.label} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
                          <CheckCircle2 className="h-4 w-4 shrink-0"/>
                          <span className="min-w-0 flex-1">{item.label}</span>
                          {item.onOpen ? <button type="button" onClick={() => void item.onOpen?.()} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-[10px] font-black text-emerald-800 hover:bg-emerald-100">
                            <Eye className="h-3.5 w-3.5" /> Visualizar
                          </button> : null}
                        </div>)}
                        {accountantAutomaticDocuments.map(document => <div key={document.id} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
                          <CheckCircle2 className="h-4 w-4 shrink-0"/>
                          <span className="min-w-0 flex-1">{document.label}</span>
                          <a href={document.fileUrl!} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-[10px] font-black text-emerald-800 hover:bg-emerald-100" aria-label={`Visualizar ${document.label}`}>
                            <Eye className="h-3.5 w-3.5" /> Visualizar
                          </a>
                        </div>)}
                      </div>
                    </section>
                    <section className="mt-3 rounded-2xl border border-cyan-200 bg-white/80 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h5 className="text-xs font-black text-cyan-950">Documentos opcionais</h5>
                          <p className="mt-0.5 text-[11px] font-semibold text-cyan-900">Marque somente os documentos adicionais que deseja enviar ao contador.</p>
                        </div>
                        <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-[9px] font-black uppercase text-cyan-800">Seleção do RH</span>
                      </div>
                    {accountantOptionalDocuments.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {accountantOptionalDocuments.map(document => {
                        const checked = accountantSelectedDocumentIds.includes(document.id);
                        const approved = document.status === 'approved';
                        return <div key={document.id} className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 transition ${checked ? 'border-cyan-400 bg-white text-slate-900' : 'border-slate-200 bg-white/70 text-slate-600'}`}>
                          <label className={`flex min-w-0 flex-1 items-start gap-2 ${approved ? 'cursor-pointer' : 'cursor-not-allowed opacity-65'}`}>
                            <input type="checkbox" checked={checked && approved} disabled={!accountantFormValidated || !canManageAccountantProcess || !!accountantActionBusy || !approved} onChange={event => setAccountantSelectedDocumentIds(current => event.target.checked ? [...new Set([...current, document.id])] : current.filter(id => id !== document.id))} className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-700" />
                            <span className="min-w-0"><span className="block text-xs font-black">{document.label}</span><span className={`mt-0.5 block text-[10px] font-bold ${approved ? 'text-emerald-700' : 'text-amber-700'}`}>{approved ? 'Aprovado · arquivo auditável disponível' : 'Aguardando aprovação do RH'}</span></span>
                          </label>
                          <a href={document.fileUrl!} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-cyan-200 bg-white px-2 py-1.5 text-[10px] font-black text-cyan-800 hover:bg-cyan-50" aria-label={`Visualizar ${document.label}`}>
                            <Eye className="h-3.5 w-3.5" /> Visualizar
                          </a>
                        </div>;
                      })}
                    </div> : <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white/70 p-3 text-xs font-semibold text-slate-500">Nenhum outro documento opcional com arquivo está disponível.</p>}
                    <p className="mt-2 text-[11px] font-bold text-cyan-900">Selecionados pelo RH: {accountantSelectedDocumentIds.length} de {accountantSelectableDocuments.length} documentos opcionais.</p>
                    {canManageAccountantProcess ? <button type="button" disabled={!!accountantActionBusy || !accountantFormValidated} onClick={() => void accountantAction('confirm_documents', { selectedDocumentIds: accountantSelectedDocumentIds })} className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-cyan-700 px-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{accountantActionBusy === 'confirm_documents' ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <CheckCircle2 className="h-3.5 w-3.5"/>}{accountantDocumentSelectionConfirmed ? 'Documentos confirmados' : 'Confirmar documentos e avançar'}</button> : null}
                    </section>
                  </div> : null}

                  {accountantActiveStep === 3 ? <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.08em] text-stone-500">Envio ao contador</p>
                      <h4 className="mt-1 text-sm font-black text-slate-900">E-mail com o pacote admissional</h4>
                    </div>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <section className="rounded-2xl border border-stone-200 bg-stone-50/50 p-4">
                        <p className="text-xs font-semibold leading-relaxed text-slate-600">O e-mail levará {2 + accountantAutomaticDocuments.length} anexos automáticos e somente os documentos opcionais marcados. Depois do envio, o retorno fica registrado ao lado.</p>
                        {!accountantDocumentSelectionConfirmed ? <p className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 p-3 text-xs font-bold text-slate-600"><LockKeyhole className="h-4 w-4 shrink-0"/>Confirme os documentos na etapa 2 para liberar o envio ao contador.</p> : null}
                        <label className="mt-3 block text-[9.5px] font-black uppercase tracking-wide text-stone-500">
                          Destinatário
                          <span className="mt-1 flex flex-col gap-2 normal-case sm:flex-row">
                            <input value={accountantEmail} onChange={event => setAccountantEmail(event.target.value)} disabled={!accountantDocumentSelectionConfirmed || !!accountantActionBusy} type="email" placeholder="E-mail do contador" className="h-9 min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-3 text-xs font-semibold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100" />
                            {canManageAccountantProcess ? <button type="button" disabled={!!accountantActionBusy || !accountantEmail || !accountantDocumentSelectionConfirmed} onClick={() => void accountantAction('send_email', { accountantEmail, selectedDocumentIds: accountantSelectedDocumentIds })} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-violet-700 px-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-3.5 w-3.5"/>{accountantActionBusy === 'send_email' ? 'Enviando...' : selectedProcess.accountantWorkflow?.email?.sentAt ? 'Reenviar pacote' : 'Enviar ao contador'}</button> : null}
                          </span>
                        </label>
                        {selectedProcess.accountantWorkflow?.suggestedRecipientEmail ? <p className="mt-2 text-[11px] font-semibold text-violet-700">Contato sugerido pelo cadastro: {selectedProcess.accountantWorkflow.suggestedRecipientDepartment ?? 'Setor'} · {selectedProcess.accountantWorkflow.suggestedRecipientCompanyName ?? 'Empresa'}.</p> : null}
                        {selectedProcess.accountantWorkflow?.email?.sentAt ? <p className="mt-2 text-[11px] font-bold text-slate-600">E-mail: {selectedProcess.accountantWorkflow.email.status ?? 'accepted'}{selectedProcess.accountantWorkflow.email.deliveredAt ? ' · entregue' : ''}{selectedProcess.accountantWorkflow.email.openedAt ? ' · aberto' : ''}{selectedProcess.accountantWorkflow.email.clickedAt ? ' · link acessado' : ''}.</p> : null}
                        {selectedProcess.accountantWorkflow?.package?.attachmentCount ? <p className="mt-1 text-[11px] font-semibold text-slate-500">Último pacote: {selectedProcess.accountantWorkflow.package.attachmentCount} anexos, com {selectedProcess.accountantWorkflow.package.selectedDocumentIds?.length ?? 0} selecionados pelo RH.</p> : null}
                      </section>

                      <section className="rounded-2xl border border-stone-200 bg-white p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.08em] text-stone-500">Acompanhamento</p>
                        <AsoEmailTrackingMilestones
                          communication={{
                            emailStatus: selectedProcess.accountantWorkflow?.email?.status,
                            sentAt: selectedProcess.accountantWorkflow?.email?.sentAt,
                            deliveredAt: selectedProcess.accountantWorkflow?.email?.deliveredAt,
                            openedAt: selectedProcess.accountantWorkflow?.email?.openedAt,
                            clickedAt: selectedProcess.accountantWorkflow?.email?.clickedAt,
                            repliedAt: selectedProcess.accountantWorkflow?.registryDocument?.uploadedAt,
                          }}
                          includeReply
                          replyLabel="Ficha anexada"
                        />
                        {selectedProcess.accountantWorkflow?.registryDocument?.storagePath ? <div className="mt-3 rounded-xl border border-pink-200 bg-pink-50/60 p-3">
                          <p className="text-[10px] font-black uppercase tracking-wide text-pink-700">4 · Ficha de Registro de Empregado</p>
                          <p className="mt-1 text-sm font-black text-slate-900">{selectedProcess.accountantWorkflow.registryDocument.uploadSource === 'rh' ? 'Ficha anexada pelo RH' : 'Ficha recebida da contabilidade'}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-600">{selectedProcess.accountantWorkflow.registryDocument.fileName} · situação: {selectedProcess.accountantWorkflow.registryDocument.status}</p>
                          {selectedProcess.accountantWorkflow.registryDocument.rejectionReason ? <p className="mt-2 rounded-lg bg-rose-100 p-2 text-xs font-bold text-rose-700">Motivo: {selectedProcess.accountantWorkflow.registryDocument.rejectionReason}</p> : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" onClick={() => void openAccountantAsset('registry')} className="h-9 rounded-lg border border-pink-200 bg-white px-3 text-xs font-black text-pink-700">Abrir ficha</button>
                            {canManageAccountantProcess && selectedProcess.accountantWorkflow.registryDocument.status !== 'approved' ? <>
                              <button type="button" disabled={!!accountantActionBusy} onClick={() => void accountantAction('review_registry', { decision: 'approved' })} className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50">Aprovar ficha</button>
                              <button type="button" disabled={!!accountantActionBusy} onClick={() => { const reason = window.prompt('Motivo da rejeição:'); if (reason) void accountantAction('review_registry', { decision: 'rejected', reason }); }} className="h-9 rounded-lg bg-rose-600 px-3 text-xs font-black text-white disabled:opacity-50">Rejeitar</button>
                            </> : null}
                            {canManageAccountantProcess && selectedProcess.accountantWorkflow.registryDocument.status === 'rejected' ? <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-pink-200 bg-white px-3 text-xs font-black text-pink-700 hover:bg-pink-50">
                              {accountantActionBusy === 'upload_registry' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                              {accountantActionBusy === 'upload_registry' ? 'Anexando...' : 'Substituir pelo RH'}
                              <input type="file" accept="application/pdf,.pdf" disabled={!!accountantActionBusy} className="hidden" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void uploadAccountantRegistryByRh(file); }} />
                            </label> : null}
                          </div>
                        </div> : accountantDocumentSelectionConfirmed ? <div className="mt-3 rounded-xl border border-dashed border-pink-200 bg-pink-50/40 p-3">
                          <p className="text-[10px] font-black uppercase tracking-wide text-pink-700">4 · Ficha de Registro de Empregado</p>
                          <p className="mt-1 text-xs font-semibold leading-relaxed text-pink-800">Aguardando o contador enviar a ficha pelo link exclusivo. Se o RH receber o documento por outro canal, também pode anexá-lo aqui.</p>
                          {canManageAccountantProcess ? <div className="mt-3 flex flex-wrap items-center gap-2">
                            <label className={`inline-flex h-9 items-center gap-2 rounded-lg bg-pink-600 px-3 text-xs font-black text-white ${accountantActionBusy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-pink-700'}`}>
                              {accountantActionBusy === 'upload_registry' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                              {accountantActionBusy === 'upload_registry' ? 'Anexando...' : 'Anexar ficha pelo RH'}
                              <input type="file" accept="application/pdf,.pdf" disabled={!!accountantActionBusy} className="hidden" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void uploadAccountantRegistryByRh(file); }} />
                            </label>
                            <span className="text-[10.5px] font-semibold text-pink-700">PDF de até 15 MB · o anexo conclui esta etapa automaticamente.</span>
                          </div> : null}
                        </div> : null}
                      </section>
                    </div>
                  </div> : null}
              </div>
            )}

            {/* VALIDACAO */}
            {activeKind === 'validacao' && (
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-slate-500">Configurações finais do colaborador</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      Confirma a resposta de VT e salva turno, operação, metas e regra de acesso. Isso não finaliza a integração.
                    </p>
                  </div>
                  {finalizationSaved ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-black text-emerald-700">Salvo</span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-black text-amber-700">Pendente</span>
                  )}
                </div>
                <OnboardingFinalizationControls
                  value={finalizationDraft}
                  onChange={setFinalizationDraft}
                  shiftDefinitions={shiftDefinitions}
                  unitId={selectedProcess.unitId}
                  disabled={!canActOnCurrentPhase || userCreated}
                  compact
                  transportVoucherMode="summary"
                  transportVoucherAnswered={selectedProcess.publicFormAnswers?.wantsTransportVoucher === 'yes' || selectedProcess.publicFormAnswers?.wantsTransportVoucher === 'no'}
                />
                {canManage && !userCreated ? (
                  <button
                    type="button"
                    disabled={!canActOnCurrentPhase || updating === `${selectedProcess.id}:save_finalization`}
                    onClick={() => saveFinalization(selectedProcess.id)}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-[13px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    title={!canActOnCurrentPhase ? 'Esta etapa só pode ser salva quando for a fase atual.' : undefined}
                  >
                    {updating === `${selectedProcess.id}:save_finalization`
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                    Confirmar validação e avançar para acessos
                  </button>
                ) : null}
              </div>
            )}

            {/* INTEGRACAO */}
            {activeKind === 'integracao' && (
              <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-slate-700">Cadastro e primeiro acesso</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">Crie o colaborador, envie o acesso e acompanhe a ativação da conta.</p>
                    </div>
                    {formalizationAccessCompleted ? (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">Concluído</span>
                    ) : null}
                  </div>

                  <div className="mt-3 space-y-2">
                    {accessIndicators.map(indicator => (
                      <div key={indicator.label} className={`rounded-xl border px-3 py-3 ${indicator.state === 'done' ? 'border-emerald-200 bg-emerald-50' : indicator.state === 'failed' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
                        <div className="flex items-center gap-2">
                          {indicator.state === 'done' ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          ) : indicator.state === 'failed' ? (
                            <XCircle className="h-4 w-4 shrink-0 text-rose-600" />
                          ) : (
                            <Clock className="h-4 w-4 shrink-0 text-amber-500" />
                          )}
                          <span className="text-[12px] font-black text-slate-900">{indicator.label}</span>
                        </div>
                        <p className={`mt-1.5 text-[10.5px] font-semibold ${indicator.state === 'failed' ? 'text-rose-600' : indicator.state === 'done' ? 'text-emerald-700' : 'text-slate-500'}`}>{indicator.detail}</p>
                      </div>
                    ))}
                  </div>

                  {selectedProcess.candidateEmail ? (
                    <p className="mt-3 break-all text-[11px] font-semibold text-slate-500">Destinatário: <span className="font-black text-slate-700">{selectedProcess.candidateEmail}</span></p>
                  ) : null}

                  {canManage && !userCreated ? (
                    <button
                      type="button"
                      disabled={!canCreateCollaborator || updating === `${selectedProcess.id}:create_collaborator`}
                      onClick={() => createCollaborator(selectedProcess.id)}
                      className={`mt-3 inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-bold text-white ${canCreateCollaborator ? 'bg-pink-600 shadow-lg shadow-pink-600/25 hover:bg-pink-700' : 'cursor-not-allowed bg-slate-300'}`}
                    >
                      {updating === `${selectedProcess.id}:create_collaborator` ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                      {canCreateCollaborator ? 'Criar cadastro e enviar acesso' : 'Conclua a validação para criar o acesso'}
                    </button>
                  ) : null}

                  {canManage && userCreated && !passwordCreated && !formalizationAccessCompleted ? (
                    <button
                      type="button"
                      disabled={updating === `${selectedProcess.id}:create_first_access_link`}
                      onClick={() => createFirstAccessLink(selectedProcess.id)}
                      className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-[12.5px] font-black text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      {updating === `${selectedProcess.id}:create_first_access_link` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                      {firstAccessExpired || emailDeliveryFailed ? 'Gerar novo link e reenviar acesso' : 'Reenviar e-mail de acesso'}
                    </button>
                  ) : null}
                </section>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3.5">
                  <p className="text-[14px] font-black text-slate-950">Integrações externas</p>
                  <p className="mt-0.5 text-[11.5px] font-semibold text-slate-500">
                    Cadastre, acompanhe e sincronize os acessos do novo colaborador.
                  </p>
                </div>
                <div className="space-y-3 p-4">
                <div className={`rounded-2xl border px-4 py-3.5 ${okAlert ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                  {!okAlert ? ([bizneoAlert, pdvDisplayAlert].filter(Boolean) as NonNullable<typeof bizneoAlert>[]).map(alert => (
                    <div key={alert.id} className="[&:not(:first-child)]:mt-2">
                      <p className={`text-[13px] font-black ${alert.status === 'resolved' ? 'text-emerald-800' : 'text-amber-800'}`}>{alert.label}</p>
                      <p className={`mt-1 text-[11.5px] font-semibold ${alert.status === 'resolved' ? 'text-emerald-700' : 'text-amber-700'}`}>{alert.message ?? 'Verificação pendente.'}</p>
                    </div>
                  )) : (
                    <>
                      <p className="text-[13px] font-black text-emerald-800">Acessos sincronizados</p>
                      <p className="mt-1 text-[11.5px] font-semibold text-emerald-700">Bizneo HR e PDV Legal foram confirmados.</p>
                    </>
                  )}
                  {!bizneoAlert || !pdvAlert ? (
                    <div className="[&:not(:first-child)]:mt-2">
                      <p className="text-[13px] font-black text-amber-800">Verificação necessária</p>
                      <p className="mt-1 text-[11.5px] font-semibold text-amber-700">Procure os cadastros antes de avançar.</p>
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {[
                    { name: 'Bizneo HR', desc: 'Sincroniza dados cadastrais e ponto.', alert: bizneoAlert },
                    {
                      name: 'PDV Legal',
                      desc: pdvAwaitingPassword
                        ? `Aguardando senha para cadastro em ${pdvFilialName ?? 'filial vinculada'}.`
                        : pdvFilialName
                          ? `Cadastro vinculado à filial ${pdvFilialName}.`
                          : 'Habilita operação no ponto de venda.',
                      alert: pdvDisplayAlert,
                    },
                  ].map(({ name, desc, alert }) => {
                    const resolved = alert?.status === 'resolved';
                    return (
                    <div key={name} className={`rounded-xl border px-3.5 py-3 ${resolved ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${resolved ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        <span className="text-[12.5px] font-black text-slate-900">{name}</span>
                      </div>
                      <div className="mt-1 text-[11.5px] font-semibold text-slate-500">{resolved ? 'Sincronizado' : alert ? 'Pendente' : 'Não verificado'} · {desc}</div>
                    </div>
                  )})}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-[12.5px] font-black text-slate-900">Benefícios e serviços</p>
                  <p className="mt-1 text-[11.5px] font-semibold text-slate-500">
                    Marque cada cadastro quando a inclusão do colaborador estiver concluída.
                  </p>
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                    {[
                      {
                        id: 'odontoprev' as const,
                        label: 'Plano de saúde Odontoprev',
                        description: 'Inclusão confirmada no plano.',
                        completed: selectedProcess.accessProvisioning?.operationalChecks?.odontoprev?.completed === true,
                        notApplicable: false,
                      },
                      {
                        id: 'transportVoucherSystem' as const,
                        label: 'Sistema de vale-transporte',
                        ...transportVoucherServiceStatus,
                      },
                    ].map(check => (
                      <label
                        key={check.id}
                        className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 transition ${
                          check.completed
                            ? 'border-emerald-200 bg-emerald-50'
                            : 'border-slate-200 bg-slate-50'
                        } ${canManage && canActOnCurrentPhase && userCreated && !check.notApplicable ? 'cursor-pointer hover:border-pink-200' : 'cursor-not-allowed opacity-70'}`}
                      >
                        <input
                          type="checkbox"
                          checked={check.completed}
                          disabled={check.notApplicable || !canManage || !canActOnCurrentPhase || !userCreated || updating === `${selectedProcess.id}:set_access_operational_check`}
                          onChange={event => void patchProcess(selectedProcess.id, {
                            action: 'set_access_operational_check',
                            checkId: check.id,
                            completed: event.target.checked,
                          })}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-pink-600 accent-pink-600 focus:ring-pink-500"
                        />
                        <span className="min-w-0">
                          <span className="block text-[12.5px] font-black text-slate-900">{check.label}</span>
                          <span className={`mt-0.5 block text-[11.5px] font-semibold ${
                            check.completed ? 'text-emerald-700' : 'text-slate-500'
                          }`}>
                            {check.notApplicable ? check.description : check.completed ? 'Concluído' : check.description}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                {userCreated && canManage ? (
                  <button
                    type="button"
                    disabled={!canActOnCurrentPhase || updating === `${selectedProcess.id}:verify_integrations`}
                    onClick={() => patchProcess(selectedProcess.id, { action: 'verify_integrations' })}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCw className={`h-3.5 w-3.5 ${updating === `${selectedProcess.id}:verify_integrations` ? 'animate-spin' : ''}`} />
                    {updating === `${selectedProcess.id}:verify_integrations` ? 'Sincronizando códigos...' : 'Sincronizar acessos'}
                  </button>
                ) : null}
                {canManage && (
                  <>
                    {!finalizationSaved && !userCreated ? (
                      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-bold text-amber-800">
                        Salve a validação final antes de criar o colaborador.
                      </p>
                    ) : null}
                    {userCreated ? (
                      <button
                        type="button"
                        disabled={!canComplete || updating === `${selectedProcess.id}:complete`}
                        onClick={() => void completeOnboarding(selectedProcess.id)}
                        className="inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-[13.5px] font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {updating === `${selectedProcess.id}:complete`
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <CheckCircle2 className="h-4 w-4" />}
                        {selectedProcess.status === 'completed'
                          ? 'Integração finalizada'
                          : !formalizationAccessCompleted
                            ? 'Aguardando primeiro acesso'
                            : integrationsResolved
                              ? 'Finalizar integração'
                              : 'Sincronize Bizneo e PDV para avançar'}
                      </button>
                    ) : null}
                  </>
                )}
                </div>
              </div>
              </div>
            )}

            {/* ASSINATURA */}
            {activeKind === 'assinatura' && (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-violet-800">Documentação admissional</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">Gere e revise o pacote completo, envie-o para assinatura e acompanhe o arquivamento.</p>
                    </div>
                    <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-black text-violet-700">
                      {signatureMainSteps.filter(step => step.done).length} de {signatureMainSteps.length} subetapas
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {signatureMainSteps.map((step, index) => {
                      const current = !step.done && index === (signatureCurrentStepIndex < 0 ? signatureMainSteps.length - 1 : signatureCurrentStepIndex);
                      return (
                        <div key={step.label} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${
                          step.done
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : current
                              ? 'border-violet-300 bg-violet-50 text-violet-800'
                              : 'border-slate-200 bg-slate-50 text-slate-500'
                        }`}>
                          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                            step.done
                              ? 'bg-emerald-600 text-white'
                              : current
                                ? 'bg-violet-600 text-white'
                                : 'bg-white text-slate-400 ring-1 ring-slate-200'
                          }`}>
                            {step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[10.5px] font-black leading-tight">{step.label}</span>
                            <span className="mt-0.5 block text-[9px] font-bold opacity-75">{step.done ? 'Concluída' : current ? 'Em andamento' : 'A seguir'}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {activePhaseId === 'signature_preparation' ? (
                  <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-wide text-violet-800">1. Documentos do pacote</p>
                        <p className="mt-1 text-xs font-semibold text-violet-700">Todos os componentes aplicáveis são gerados, revisados e enviados como uma única unidade.</p>
                      </div>
                      <span className="rounded-full border border-violet-200 bg-white px-3 py-1.5 text-[10px] font-black text-violet-700">
                        {signatureTemplates.length} componentes obrigatórios
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {signatureTemplates.map((template, index) => {
                        const workflowDocument = selectedSignatureDocuments.find(document => document.templateId === template.id);
                        const failed = workflowDocument
                          ? ['generation_failed', 'generation_blocked', 'send_failed', 'delivery_failed', 'rejected'].includes(workflowDocument.status)
                          : false;
                        return (
                          <div key={template.id} className="rounded-xl border border-violet-300 bg-white p-3">
                            <div className="flex items-start gap-2.5">
                              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-violet-100 text-[9px] font-black text-violet-700">{index + 1}</span>
                              <span className="min-w-0">
                                <span className="block truncate text-[12.5px] font-black text-slate-900">{template.name}</span>
                                <span className="mt-0.5 block text-[10.5px] font-semibold text-slate-500">{template.category} · versão {template.version}</span>
                              </span>
                            </div>
                            {workflowDocument ? (
                              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                                <div className="min-w-0">
                                  <p className={`text-[10.5px] font-black ${failed ? 'text-rose-600' : workflowDocument.status === 'ready_to_send' ? 'text-emerald-700' : 'text-slate-500'}`}>
                                    {SIGNATURE_WORKFLOW_STATUS_LABELS[workflowDocument.status] ?? workflowDocument.status}
                                  </p>
                                  {workflowDocument.lastError ? <p className="mt-1 text-[10px] font-semibold text-rose-600">{workflowDocument.lastError}</p> : null}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {workflowDocument.generatedPdfStoragePath ? (
                                    <button
                                      type="button"
                                      disabled={!!signatureBusy}
                                      onClick={() => void viewSignatureDocument(workflowDocument.id)}
                                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-[10.5px] font-black text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                                    >
                                      <Eye className="h-3.5 w-3.5" />Visualizar
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      {signatureTemplates.length === 0 ? (
                        <p className="col-span-full rounded-xl border border-dashed bg-white p-4 text-xs font-semibold text-slate-500">
                          Nenhum modelo DOCX publicado. Cadastre em Documentos → Modelos.
                        </p>
                      ) : null}
                    </div>
                    {canGenerateDocumentsProcess || (canReviewDocuments && canActOnSignaturePhase && signaturePackageNeedsReview) || (canSendSignatures && canActOnSignaturePhase && signatureReviewed) ? (
                      <div className="mt-3 flex justify-end">
                        <div className="flex flex-col items-end gap-2">
                          {canGenerateDocumentsProcess ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              {signatureBundleReady ? (
                                <button
                                  type="button"
                                  disabled={!!signatureBusy}
                                  onClick={() => void viewSignatureBundle()}
                                  className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white px-4 text-[11px] font-black text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                                >
                                  {signatureBusy === 'preview_bundle' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                                  Ver pacote completo
                                </button>
                              ) : null}
                              <button
                                type="button"
                                disabled={!signaturePackageEditable || !signatureWorkflow?.packageTemplateIds?.length || !!signatureBusy}
                                onClick={() => void generateSignaturePackage()}
                                className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 text-[11px] font-black text-white hover:bg-violet-600 disabled:opacity-50"
                              >
                                {signatureBusy === 'select' || signatureBusy === 'generate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                                {signatureGenerated ? 'Gerar novamente' : 'Gerar pacote'}
                              </button>
                            </div>
                          ) : null}
                          {canReviewDocuments && canActOnSignaturePhase && signaturePackageNeedsReview ? (
                            <button
                              type="button"
                              disabled={!!signatureBusy}
                              onClick={() => void signatureAction('approve')}
                              className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-[11px] font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {signatureBusy === 'approve' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                              Marcar pacote como revisado
                            </button>
                          ) : null}
                          {canSendSignatures && canActOnSignaturePhase && signatureReviewed ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                disabled={!!signatureBusy}
                                onClick={() => void openSignaturePlacement()}
                                className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl px-4 text-[11px] font-black disabled:opacity-50 ${signatureWorkflow?.signaturePackage?.placementReady ? 'border border-pink-200 bg-white text-pink-700 hover:bg-pink-50' : 'bg-pink-600 text-white shadow-sm shadow-pink-600/20 hover:bg-pink-700'}`}
                              >
                                {signatureBusy === 'prepare_positions' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCheck2 className="h-3.5 w-3.5" />}
                                {signatureWorkflow?.signaturePackage?.placementReady ? 'Ajustar posições' : 'Posicionar assinaturas'}
                              </button>
                              {signatureWorkflow?.signaturePackage?.placementReady ? (
                                <button
                                  type="button"
                                  disabled={!!signatureBusy}
                                  onClick={() => void sendPreparedSignaturePackage()}
                                  className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-pink-600 px-4 text-[11px] font-black text-white shadow-sm shadow-pink-600/20 hover:bg-pink-700 disabled:opacity-50"
                                >
                                  {signatureBusy === 'send' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                  Enviar para assinatura
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activePhaseId !== 'signature_preparation' ? selectedSignatureDocuments.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-black uppercase tracking-wide text-slate-600">Acompanhamento da assinatura</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">O kit completo é uma única solicitação no Autentique.</p>
                      </div>
                      <button type="button" disabled={!!signatureBusy} onClick={() => void signatureAction('reconcile')} className="grid h-8 w-8 place-items-center rounded-lg border bg-white text-slate-500 disabled:opacity-50" title="Conferir agora no Autentique">
                        <RotateCw className={`h-3.5 w-3.5 ${signatureBusy === 'reconcile' ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      {signatureWorkflow?.signaturePackage?.sandbox ? (
                        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
                          Documento de teste (sandbox). Ele não aparece no painel de produção do Autentique e não possui validade para o fluxo oficial.
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13.5px] font-black text-slate-900">Kit admissional completo</p>
                          <p className="mt-0.5 text-[10.5px] font-semibold text-slate-500">{selectedSignatureDocuments.length} componentes · uma única solicitação</p>
                          <p className={`mt-1 text-[11px] font-bold ${signaturePackageFailedDocument ? 'text-rose-600' : signaturePackageArchived ? 'text-emerald-700' : 'text-slate-500'}`}>
                            {signaturePackageTrackingLabel}
                          </p>
                          {signaturePackageFailedDocument?.lastError ? <p className="mt-1 text-[10.5px] font-semibold text-rose-600">{signaturePackageFailedDocument.lastError}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {signatureSent ? (
                            <button type="button" disabled={!!signatureBusy} onClick={() => void viewSentSignaturePackage('generated')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-[10.5px] font-black text-violet-700">
                              <Eye className="h-3.5 w-3.5" />Visualizar pacote
                            </button>
                          ) : null}
                          {signaturePackageArchived ? (
                            <button type="button" disabled={!!signatureBusy} onClick={() => void viewSentSignaturePackage('signed')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[10.5px] font-black text-emerald-700">
                              <Download className="h-3.5 w-3.5" />PDF assinado
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {signatureParticipants.length ? (
                        <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 md:grid-cols-2">
                          {signatureParticipants.map(participant => (
                            <SignatureParticipantCard
                              key={participant.providerSignatureId}
                              participant={participant}
                              canManage={canSendSignatures && canActOnSignaturePhase}
                              busyAction={signatureBusy}
                              onResend={async (target) => Boolean(await participantSignatureAction('resend_participant', target))}
                              onCreateLink={async (target) => (
                                await participantSignatureAction('create_signature_link', target)
                              )?.shortLink ?? null}
                              onReplaceEmail={async (target, email) => Boolean(await participantSignatureAction(
                                'replace_participant_email',
                                target,
                                { email },
                              ))}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5">
                    <p className="text-sm font-black text-slate-800">Nenhum documento selecionado.</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Selecione os modelos na preparação para iniciar a geração.</p>
                  </div>
                ) : null}

                {selectedSignatureDocuments.length > 0 && selectedSignatureDocuments.every(document => ['signed', 'signed_archived_pending_employee', 'archived'].includes(document.status)) ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
                    O kit admissional foi assinado. O sistema arquivou o pacote e liberou automaticamente a próxima fase.
                  </div>
                ) : null}
              </div>
            )}

            {/* GENERICO */}
            {activeKind === 'generico' && activePhaseId === 'done' ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                  <CheckCircle2 className="h-7 w-7" />
                </span>
                <h3 className="mt-3 text-lg font-black tracking-tight text-slate-950">Integração finalizada</h3>
                <p className="mx-auto mt-1.5 max-w-2xl text-[13px] font-medium leading-relaxed text-slate-600">
                  Formalização concluída, acessos ativos e histórico consolidado. Documentos, comunicações e decisões permanecem preservados no processo para consulta e auditoria.
                </p>
                <span className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700">
                  <ShieldCheck className="h-4 w-4" /> Histórico auditável preservado
                </span>
              </div>
            ) : activeKind === 'generico' ? (
              <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-5 py-[18px]">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                  <div className="text-sm font-black text-slate-900">{genericStatus}</div>
                </div>
                <p className="mt-3 text-[13px] font-medium leading-relaxed text-slate-500">{genericDesc}</p>
              </div>
            ) : null}

            {/* EXPERIÊNCIA E TREINAMENTO */}
            {activeKind === 'experiencia' && (
              <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
                {selectedProcess.probationV2 ? (
                  <ProbationV2Panel
                    process={selectedProcess}
                    getToken={getToken}
                    canManage={canManage && selectedProcess.status !== 'cancelled'}
                    formalizationComplete={probationReleased}
                    onRefresh={onRefresh}
                  />
                ) : (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 px-5 py-[18px]">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                    <div className="text-sm font-black text-slate-900">{genericStatus}</div>
                  </div>
                  <p className="mt-3 text-[13px] font-medium leading-relaxed text-slate-500">{genericDesc}</p>
                  </div>
                )}

                <section className="overflow-hidden rounded-2xl border border-violet-200 bg-white">
                  <div className="border-b border-violet-100 bg-violet-50/70 px-5 py-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.08em] text-violet-700">Treinamento</p>
                    <h3 className="mt-1 text-base font-black text-slate-950">Trilhas atribuídas</h3>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Acompanhe as atividades de capacitação dos primeiros dias.</p>
                  </div>
                  <TrainingPanel
                    process={selectedProcess}
                    getToken={getToken}
                    canManage={canManage && selectedProcess.status !== 'cancelled'}
                    onRefresh={onRefresh}
                  />
                </section>
              </div>
            )}
          </div>
        </div>
      </section>

      {signaturePlacementOpen && selectedProcess && signatureWorkflow?.signaturePackage?.layout ? (
        <SignaturePlacementEditor
          onboardingId={selectedProcess.id}
          getToken={getToken}
          workflow={signatureWorkflow}
          onClose={closeSignaturePlacement}
          onWorkflowUpdated={(workflow) => setSignatureWorkflow(workflow as SignatureWorkflowPayload)}
        />
      ) : null}
      {showStartModal && (
        <StartOnboardingModal
          roles={roles}
          jobFunctions={jobFunctions}
          units={units}
          shiftDefinitions={shiftDefinitions}
          getToken={getToken}
          onClose={() => setShowStartModal(false)}
          onCreated={(process) => {
            setShowStartModal(false);
            onRefresh();
            openProcess(process);
          }}
        />
      )}
      {asoStartResultModal}
      {cancellationModal}
    </div>
  );
}
