"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '@/hooks/use-auth';
import { fetchHrBootstrap } from '@/features/hr/lib/client';
import { IntegrationSubfieldEditor, IntegrationTemplateManager } from '@/features/hr/integration/IntegrationTemplateManager';
import type { IntegrationTemplateMetadataClient } from '@/features/hr/integration/client';
import { simulateIntegrationTemplate } from '@/features/hr/integration/engine';
import { IntegrationRulesPanel } from '@/features/hr/integration/IntegrationRulePanels';
import {
  buildProbationSchedule,
  DEFAULT_PROBATION_FIRST_PERIOD_DAYS,
  probationConfigForFirstPeriod,
} from '@/features/hr/integration/probation';
import { probationIsReleasedAfterFormalization } from '@/features/hr/integration/probation-process';
import { PjOnboardingDetailPanel } from '@/features/hr/onboarding-pj/detail-panel';
import type { IntegrationBlock, IntegrationRule, IntegrationStage, IntegrationSubfield, IntegrationTemplateVersion } from '@/features/hr/integration/schemas';
import type {
  Candidate,
  CandidateDecisionAction,
  CandidateStageHistoryEntry,
  CandidateStatus,
  DPShiftDefinition,
  DPUnit,
  HrFormQuestion,
  HrQuestionWeight,
  JobFunction,
  JobRole,
  JobRoleSalaryRange,
  JobOpening,
  JobOpeningStatus,
  OnboardingDocument,
  OnboardingFinalizationSettings,
  OnboardingProcess,
  OnboardingStage,
  OnboardingStageId,
  OnboardingTrainingItem,
  RecruitmentCompositionPreset,
  RecruitmentCriterionCategory,
  RecruitmentQuestionCondition,
  RecruitmentQuestionConditionOperator,
  RecruitmentQuestionScoringUse,
  RecruitmentScoringSourceLayer,
  RecruitmentFormConfig,
  RecruitmentStage,
} from '@/types';
import {
  buildRecruitmentQuestionTree,
  DEFAULT_TALENT_POOL_FORM,
  groupRecruitmentQuestionsBySection,
  getRecruitmentQuestionOptions,
  makeRecruitmentSectionId,
  mergeRecruitmentQuestionModels,
  type RecruitmentQuestionTreeNode,
} from '@/lib/recruitment-forms';
import {
  applyRecruitmentScoring,
  RECRUITMENT_CATEGORY_BASE_WEIGHTS,
  RECRUITMENT_CATEGORY_LABELS,
  RECRUITMENT_COMPOSITION_PRESETS,
  RECRUITMENT_DEFAULT_RUBRICS,
  STANDARD_RECRUITMENT_CRITERIA,
} from '@/lib/recruitment-scoring';
import {
  createCandidateStageHistoryEntry,
  mergeRecruitmentStageModels,
  normalizeRecruitmentStages,
  RECRUITMENT_PIPELINE_STATUSES,
} from '@/lib/recruitment-pipeline';
import {
  applyOnboardingSignatureMode,
  DEFAULT_ONBOARDING_DOCUMENTS,
  normalizeOnboardingStages,
} from '@/lib/recruitment-onboarding';
import { shiftDefinitionMatchesUnit } from '@/lib/dp-shift-definitions';
import { formatPersonName } from '@/lib/person-name';
import { essentialPublicFormDataReady } from '@/features/hr/onboarding/public-form-revision';
import { maritalStatusIsInformed, ONBOARDING_MARITAL_STATUSES } from '@/features/hr/onboarding/marital-status';
import { canUpdateExpectedAdmissionDate } from '@/features/hr/onboarding-lifecycle';
import { formatBrlCurrency, parseBrlCurrency } from '@/features/hr/compensation/brl-currency';
import { isAutomaticAccountantDocument } from '@/features/hr/accountant/document-selection';
import { isPreviewableDocumentContentType } from '@/features/hr/documents/preview-content-type';
import { isAdmissionSignatureTemplateApplicable } from '@/features/hr/documents/admission-signature-order';
import { hasFormalizationPermission } from '@/lib/hr-formalization-permissions';
import {
  ONBOARDING_HEALTH_META,
  onboardingProgress,
  resolveOnboardingOperationalStatus,
  sortOnboardingProcesses,
  type OnboardingHealth,
  type OnboardingSortMode,
} from '@/features/hr/onboarding/operational-status';
import { isAsoAppointmentAfterAdmission } from '@/features/hr/aso/dates';
import { clinicLocationFromConfig, clinicLocationLabel } from '@/features/hr/aso/clinic-location';
import { ASO_GUIDE_TEMPLATE_VERSION } from '@/features/hr/aso/guide-version';
import { shouldPollAsoPayment } from '@/features/hr/aso/payment-status';
import { OnboardingProductionLine } from '@/features/hr/onboarding/production-line';
import {
  OnboardingDetailNavigation,
  onboardingConceptualStageNumber,
} from '@/features/hr/onboarding/detail-navigation';
import { OnboardingDocumentWorkbench } from '@/features/hr/onboarding/document-workbench';
import { readHrJsonResponse } from '@/features/hr/lib/client-response';
import {
  applicableOnboardingDocuments,
  presentOnboardingDocumentForAnswers,
} from '@/features/hr/onboarding/document-applicability';
import {
  onboardingPublicLinkExpiresAt,
  onboardingPublicLinkExpired,
  onboardingPublicLinkExtensionUsed,
} from '@/lib/hr/onboarding-public-link';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import {
  UserPlus, Search, Filter, MoreHorizontal, Mail, Phone,
  FileText, Calendar, Star, Clock, CheckCircle2, XCircle,
  ArrowRight, Kanban, List, Loader2, X, Trash2, AlertTriangle,
  Briefcase, ChevronDown, ChevronRight, ExternalLink, Paperclip,
  Globe, PauseCircle, Archive, Plus, Pencil, SlidersHorizontal,
  FolderOpen, Copy, ArrowLeft, MapPin, Sparkles, Users, RotateCw,
  Download, Send, Eye, Wallet, RefreshCw, GraduationCap, Check, FileCheck2,
  Info, LockKeyhole, ShieldCheck,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<CandidateStatus, { label: string; color: string; icon: React.ElementType }> = {
  applied:        { label: 'Inscrito',      color: 'bg-blue-500',   icon: Clock },
  screening:      { label: 'Triagem',       color: 'bg-indigo-500', icon: Filter },
  interview:      { label: 'Entrevista',    color: 'bg-purple-500', icon: Calendar },
  technical_test: { label: 'Avaliação Prática', color: 'bg-pink-500',   icon: FileText },
  offer:          { label: 'Proposta',      color: 'bg-yellow-500', icon: Star },
  hired:          { label: 'Contratado',    color: 'bg-green-500',  icon: CheckCircle2 },
  rejected:       { label: 'Reprovado',     color: 'bg-red-500',    icon: XCircle },
  withdrawn:      { label: 'Desistência',   color: 'bg-slate-500',  icon: ArrowRight },
  talent_pool:    { label: 'Banco de talentos', color: 'bg-cyan-500', icon: Star },
};

const PIPELINE_STATUSES: CandidateStatus[] = [...RECRUITMENT_PIPELINE_STATUSES];
const ARCHIVED_STATUSES: CandidateStatus[] = ['rejected', 'withdrawn'];
const TALENT_POOL_STATUS: CandidateStatus = 'talent_pool';
const ALL_STATUSES = Object.keys(STATUS_CONFIG) as CandidateStatus[];

const DECISION_ACTION_LABELS: Record<CandidateDecisionAction, string> = {
  created: 'Criado',
  advanced: 'Avançou',
  status_changed: 'Status alterado',
  hired: 'Contratação',
  rejected: 'Reprovação',
  withdrawn: 'Desistência',
  talent_pool: 'Banco de talentos',
};

const OPENING_STATUS_CONFIG: Record<JobOpeningStatus, { label: string; color: string; icon: React.ElementType }> = {
  open:   { label: 'Aberta',   color: 'text-green-400 bg-green-500/10 border-green-500/20',  icon: Globe },
  paused: { label: 'Pausada',  color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20', icon: PauseCircle },
  closed: { label: 'Encerrada',color: 'text-slate-400 bg-slate-500/10 border-slate-500/20',  icon: Archive },
};

const SOURCE_OPTIONS = ['LinkedIn', 'Indicação', 'Site', 'Indeed', 'Catho', 'Espontâneo', 'Outro'];
const PUBLIC_RECRUITMENT_URL = 'https://vagas.coalashakes.com';
const PUBLIC_APPLY_BUTTON_LABEL = 'Enviar candidatura';
const WORK_TYPE_OPTIONS = [
  { value: 'presencial', label: 'Presencial' },
  { value: 'remoto',     label: 'Remoto' },
  { value: 'hibrido',    label: 'Híbrido' },
];

const QUESTION_TYPES: Array<{ value: HrFormQuestion['type']; label: string }> = [
  { value: 'text', label: 'Texto' },
  { value: 'yes_no', label: 'Sim/Não' },
  { value: 'select', label: 'Seleção única' },
  { value: 'multi_select', label: 'Múltipla escolha' },
  { value: 'date', label: 'Data' },
  { value: 'number_range', label: 'Número' },
];

type QuestionDraftConditionValue = 'true' | 'false' | 'always';

const EMPTY_QUESTION_DRAFT = {
  text: '',
  type: 'text' as HrFormQuestion['type'],
  sectionTitle: '',
  parentQuestionId: '',
  conditionValue: 'true' as QuestionDraftConditionValue,
  optionsText: '',
  required: false,
  eliminatory: false,
  criterionCode: '',
  scoringUse: 'informational' as RecruitmentQuestionScoringUse,
  importance: 'medium' as HrQuestionWeight,
};

type QuestionDraft = typeof EMPTY_QUESTION_DRAFT;

const SCORING_USE_OPTIONS: Array<{ value: RecruitmentQuestionScoringUse; label: string }> = [
  { value: 'informational', label: 'Informativa' },
  { value: 'scored', label: 'Pontuável' },
  { value: 'eliminatory', label: 'Eliminatória' },
];

const IMPORTANCE_OPTIONS: Array<{ value: HrQuestionWeight; label: string }> = [
  { value: 'low', label: 'Baixa' },
  { value: 'medium', label: 'Média' },
  { value: 'high', label: 'Alta' },
  { value: 'critical', label: 'Crítica' },
];

const COMPOSITION_PRESET_OPTIONS = Object.entries(RECRUITMENT_COMPOSITION_PRESETS)
  .map(([value, config]) => ({ value: value as RecruitmentCompositionPreset, label: config.label }));

const RECRUITMENT_CRITERIA_GROUPS = Object.entries(RECRUITMENT_CATEGORY_LABELS).map(([category, label]) => ({
  category: category as keyof typeof RECRUITMENT_CATEGORY_LABELS,
  label,
  criteria: STANDARD_RECRUITMENT_CRITERIA.filter(criterion => criterion.category === category),
}));

const MANDATORY_RECRUITMENT_SECTIONS = Object.entries(RECRUITMENT_CATEGORY_LABELS).map(([category, label]) => ({
  category: category as RecruitmentCriterionCategory,
  title: label,
  baseWeight: RECRUITMENT_CATEGORY_BASE_WEIGHTS[category as RecruitmentCriterionCategory],
  defaultCriterionCode: STANDARD_RECRUITMENT_CRITERIA.find(criterion => criterion.category === category)?.code ?? '',
}));

type RecruitmentModelEditorStep = 'general' | 'public' | 'form';
type TalentPoolEditorStep = 'general' | 'fixed' | 'form';

const MODEL_EDITOR_STEPS: Array<{ value: RecruitmentModelEditorStep; label: string }> = [
  { value: 'general', label: 'Geral' },
  { value: 'public', label: 'Público' },
  { value: 'form', label: 'Formulário' },
];

const TALENT_POOL_EDITOR_STEPS: Array<{ value: TalentPoolEditorStep; label: string }> = [
  { value: 'general', label: 'Geral' },
  { value: 'fixed', label: 'Campos fixos' },
  { value: 'form', label: 'Formulário' },
];

function getStandardRecruitmentCriterion(code: string) {
  return STANDARD_RECRUITMENT_CRITERIA.find(criterion => criterion.code === code);
}

function getRecruitmentSectionCriterionCode(sectionTitle: string) {
  const normalized = sectionTitle.trim().toLowerCase();
  return MANDATORY_RECRUITMENT_SECTIONS.find(section => section.title.toLowerCase() === normalized)?.defaultCriterionCode ?? '';
}

function getQuestionScoringUse(question: HrFormQuestion): RecruitmentQuestionScoringUse {
  if (question.eliminatory || question.scoring?.use === 'eliminatory') return 'eliminatory';
  if (question.scored || question.scoring?.use === 'scored') return 'scored';
  return question.scoring?.use ?? 'informational';
}

function getQuestionImportance(question: HrFormQuestion): HrQuestionWeight {
  return question.scoring?.importance ?? question.weight ?? 'medium';
}

function formatAnswerFactors(factors?: Record<string, number>) {
  if (!factors || typeof factors !== 'object') return '';
  return Object.entries(factors as Record<string, number>)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function parseAnswerFactors(value: string) {
  const entries = value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [rawKey, rawValue] = line.split('=');
      const key = rawKey?.trim();
      const number = Number(rawValue?.trim());
      if (!key || !Number.isFinite(number)) return null;
      return [key, Math.max(0, Math.min(1, number))] as const;
    })
    .filter((entry): entry is readonly [string, number] => !!entry);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function listToText(value?: string[]) {
  return (value ?? []).join('\n');
}

function textToList(value: string) {
  return value
    .split('\n')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function salaryRangeFromText(label: string, visible: boolean): JobRoleSalaryRange | undefined {
  const trimmed = label.trim();
  if (!trimmed && !visible) return undefined;
  return {
    currency: 'BRL',
    visible,
    ...(trimmed ? { label: trimmed } : {}),
  };
}

function formatSalaryRange(range?: JobRoleSalaryRange) {
  if (!range?.visible) return '';
  if (range.label?.trim()) return range.label.trim();
  const formatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: range.currency || 'BRL',
    maximumFractionDigits: 0,
  });
  if (range.min !== undefined && range.max !== undefined) {
    return `${formatter.format(range.min)}-${formatter.format(range.max)}`;
  }
  if (range.min !== undefined) return `a partir de ${formatter.format(range.min)}`;
  if (range.max !== undefined) return `até ${formatter.format(range.max)}`;
  return 'Salário a combinar';
}

function salaryTextFromRange(range?: JobRoleSalaryRange) {
  return range?.label?.trim() || formatSalaryRange(range);
}

function withQuestionScoring(
  question: HrFormQuestion,
  patch: Partial<NonNullable<HrFormQuestion['scoring']>>
): Partial<HrFormQuestion> {
  const scoring = { ...(question.scoring ?? {}), ...patch };
  const use = patch.use ?? scoring.use ?? getQuestionScoringUse(question);
  const importance = patch.importance ?? scoring.importance ?? getQuestionImportance(question);
  return {
    scoring: {
      ...scoring,
      use,
      importance,
    },
    scored: use === 'scored',
    eliminatory: use === 'eliminatory',
    weight: importance,
  };
}

function getDraftScoringUse(draft: QuestionDraft): RecruitmentQuestionScoringUse {
  return draft.eliminatory ? 'eliminatory' : draft.scoringUse;
}

function questionScoringFromDraft(
  draft: QuestionDraft,
  sourceLayer: RecruitmentScoringSourceLayer
): Pick<HrFormQuestion, 'scored' | 'weight' | 'eliminatory' | 'scoring'> {
  const use = getDraftScoringUse(draft);
  const criterion = getStandardRecruitmentCriterion(draft.criterionCode);
  return {
    scored: use === 'scored',
    weight: draft.importance,
    eliminatory: use === 'eliminatory',
    scoring: {
      use,
      importance: draft.importance,
      sourceLayer,
      ...(criterion ? {
        criterionCode: criterion.code,
        criterionLabel: criterion.label,
        category: criterion.category,
        groupId: criterion.category,
        groupName: RECRUITMENT_CATEGORY_LABELS[criterion.category],
        rubric: RECRUITMENT_DEFAULT_RUBRICS[criterion.code],
      } : {}),
    },
  };
}

function scoringFromCriterion(question: HrFormQuestion, criterionCode: string): Partial<HrFormQuestion> {
  const criterion = STANDARD_RECRUITMENT_CRITERIA.find(item => item.code === criterionCode);
  if (!criterion) {
    return withQuestionScoring(question, {
      criterionCode: undefined,
      criterionLabel: undefined,
      category: undefined,
      rubric: undefined,
    });
  }
  return withQuestionScoring(question, {
    criterionCode: criterion.code,
    criterionLabel: criterion.label,
    category: criterion.category,
    groupName: question.scoring?.groupName || RECRUITMENT_CATEGORY_LABELS[criterion.category],
    groupId: question.scoring?.groupId || criterion.category,
    rubric: RECRUITMENT_DEFAULT_RUBRICS[criterion.code],
  });
}

function getQuestionOptions(question: HrFormQuestion) {
  const options = question.config?.options;
  return Array.isArray(options)
    ? options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
    : [];
}

function conditionValueToInput(value: unknown) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function parseConditionValue(parent: HrFormQuestion | undefined, value: string) {
  if (parent?.type === 'yes_no') return value === 'true';
  if (parent?.type === 'number_range') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }
  return value;
}

function QuestionConditionEditor({
  question,
  availableQuestions,
  onChange,
  canManage = true,
  variant = 'dark',
}: {
  question: HrFormQuestion;
  availableQuestions: HrFormQuestion[];
  onChange: (patch: Partial<HrFormQuestion>) => void;
  canManage?: boolean;
  variant?: 'dark' | 'light';
}) {
  const condition = question.conditions?.[0] ?? null;
  const parentQuestion = condition
    ? availableQuestions.find(item => item.id === condition.questionId)
    : undefined;
  const parentOptions = parentQuestion ? getQuestionOptions(parentQuestion) : [];
  const isDark = variant === 'dark';
  const fieldClass = isDark
    ? 'rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50'
    : 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60';
  const labelClass = isDark
    ? 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-600'
    : 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400';
  const mutedClass = isDark ? 'text-slate-500' : 'text-slate-500';
  const operator = condition?.operator ?? 'equals';
  const needsValue = operator !== 'answered' && operator !== 'not_answered';

  const patchCondition = (patch: Partial<RecruitmentQuestionCondition>) => {
    const next: RecruitmentQuestionCondition = {
      questionId: patch.questionId ?? condition?.questionId ?? '',
      operator: patch.operator ?? condition?.operator ?? 'equals',
      value: patch.value ?? condition?.value,
    };
    if (!next.questionId) {
      onChange({ conditions: undefined });
      return;
    }
    onChange({ conditions: [next] });
  };

  return (
    <details className={`group mt-3 rounded-xl border ${isDark ? 'border-slate-800 bg-slate-900/25' : 'border-slate-100 bg-white'}`}>
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
        <span className="truncate">
          Condicional: {condition ? `depende de "${parentQuestion?.text ?? 'pergunta'}"` : 'sempre exibir'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className={`border-t p-3 ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
        <div className="grid gap-3 md:grid-cols-[1fr_0.8fr_1fr]">
        <div>
          <label className={labelClass}>Exibição condicional</label>
          <select
            value={condition?.questionId ?? ''}
            onChange={event => {
              const parent = availableQuestions.find(item => item.id === event.target.value);
              const options = parent ? getQuestionOptions(parent) : [];
              patchCondition({
                questionId: event.target.value,
                operator: 'equals',
                value: parent?.type === 'yes_no' ? true : options[0] ?? '',
              });
            }}
            disabled={!canManage || availableQuestions.length === 0}
            className={`${fieldClass} w-full`}
          >
            <option value="">Sempre exibir</option>
            {availableQuestions.map(item => (
              <option key={item.id} value={item.id}>{item.text}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Regra</label>
          <select
            value={operator}
            onChange={event => patchCondition({ operator: event.target.value as RecruitmentQuestionConditionOperator })}
            disabled={!canManage || !condition}
            className={`${fieldClass} w-full`}
          >
            <option value="equals">Resposta igual a</option>
            <option value="not_equals">Resposta diferente de</option>
            <option value="includes">Contém opção</option>
            <option value="answered">Está respondida</option>
            <option value="not_answered">Não está respondida</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Resposta</label>
          {parentQuestion?.type === 'yes_no' ? (
            <select
              value={conditionValueToInput(condition?.value)}
              onChange={event => patchCondition({ value: parseConditionValue(parentQuestion, event.target.value) })}
              disabled={!canManage || !condition || !needsValue}
              className={`${fieldClass} w-full`}
            >
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </select>
          ) : parentOptions.length > 0 ? (
            <select
              value={conditionValueToInput(condition?.value)}
              onChange={event => patchCondition({ value: parseConditionValue(parentQuestion, event.target.value) })}
              disabled={!canManage || !condition || !needsValue}
              className={`${fieldClass} w-full`}
            >
              <option value="">Selecione</option>
              {parentOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          ) : (
            <input
              value={conditionValueToInput(condition?.value)}
              onChange={event => patchCondition({ value: parseConditionValue(parentQuestion, event.target.value) })}
              disabled={!canManage || !condition || !needsValue}
              placeholder={needsValue ? 'Valor esperado' : 'Sem valor'}
              className={`${fieldClass} w-full`}
            />
          )}
        </div>
        </div>
        <p className={`mt-2 text-[10px] ${mutedClass}`}>
          Use para mostrar esta pergunta apenas quando uma resposta anterior justificar o campo.
        </p>
      </div>
    </details>
  );
}

function questionSectionPatch(value: string): Pick<HrFormQuestion, 'sectionId' | 'sectionTitle'> {
  const sectionTitle = value.trim().slice(0, 120);
  return {
    sectionTitle: sectionTitle || undefined,
    sectionId: sectionTitle ? makeRecruitmentSectionId(sectionTitle) : undefined,
  };
}

function questionSectionFromDraft(sectionTitle: string): Pick<HrFormQuestion, 'sectionId' | 'sectionTitle'> {
  return questionSectionPatch(sectionTitle);
}

function conditionFromDraft(parent: HrFormQuestion | undefined, value: QuestionDraftConditionValue) {
  if (!parent || value === 'always') return undefined;
  if (parent.type !== 'yes_no') return undefined;
  return [{
    questionId: parent.id,
    operator: 'equals' as RecruitmentQuestionConditionOperator,
    value: parseConditionValue(parent, value),
  }];
}

function QuestionSectionEditor({
  question,
  onChange,
  canManage = true,
  variant = 'dark',
}: {
  question: HrFormQuestion;
  onChange: (patch: Partial<HrFormQuestion>) => void;
  canManage?: boolean;
  variant?: 'dark' | 'light';
}) {
  const isDark = variant === 'dark';
  const labelClass = isDark
    ? 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-600'
    : 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400';
  const fieldClass = isDark
    ? 'rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50'
    : 'rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60';

  return (
    <div className="mt-2">
      <label className={labelClass}>Seção</label>
      <input
        value={question.sectionTitle ?? ''}
        onChange={event => onChange(questionSectionPatch(event.target.value))}
        disabled={!canManage}
        placeholder="Ex: Disponibilidade, Experiência, Preferências"
        className={`${fieldClass} w-full`}
      />
    </div>
  );
}

function questionParentPatch(value: string): Pick<HrFormQuestion, 'parentQuestionId'> {
  return { parentQuestionId: value.trim() || undefined };
}

function QuestionParentEditor({
  question,
  availableQuestions,
  onChange,
  canManage = true,
  variant = 'dark',
}: {
  question: HrFormQuestion;
  availableQuestions: HrFormQuestion[];
  onChange: (patch: Partial<HrFormQuestion>) => void;
  canManage?: boolean;
  variant?: 'dark' | 'light';
}) {
  const isDark = variant === 'dark';
  const labelClass = isDark
    ? 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-600'
    : 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400';
  const fieldClass = isDark
    ? 'rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50'
    : 'rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60';

  return (
    <div className="mt-2">
      <label className={labelClass}>Subpergunta de</label>
      <select
        value={question.parentQuestionId ?? ''}
        onChange={event => onChange(questionParentPatch(event.target.value))}
        disabled={!canManage || availableQuestions.length === 0}
        className={`${fieldClass} w-full`}
      >
        <option value="">Pergunta principal</option>
        {availableQuestions.map(item => (
          <option key={item.id} value={item.id}>{item.text}</option>
        ))}
      </select>
    </div>
  );
}

function QuestionDraftConditionControls({
  draft,
  parentQuestion,
  onChange,
}: {
  draft: QuestionDraft;
  parentQuestion?: HrFormQuestion;
  onChange: (patch: Partial<QuestionDraft>) => void;
}) {
  if (!draft.parentQuestionId) return null;

  if (!parentQuestion || parentQuestion.type !== 'yes_no') return null;
  const label = parentQuestion.text;

  return (
    <div className="rounded-lg border border-pink-100 bg-pink-50/70 p-3 lg:col-span-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#993556]">
        Subpergunta
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span className="min-w-0 truncate">Aparece abaixo de “{label}” quando a resposta for</span>
        {([
          { value: 'true', label: 'Sim' },
          { value: 'false', label: 'Não' },
          { value: 'always', label: 'Sempre' },
        ] as const).map(item => (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange({ conditionValue: item.value })}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
              draft.conditionValue === item.value
                ? 'bg-[#EE6FA8] text-white'
                : 'bg-white text-slate-500 hover:text-[#993556]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuestionDraftSectionControls({
  draft,
  questions,
  onChange,
}: {
  draft: QuestionDraft;
  questions: HrFormQuestion[];
  onChange: (patch: Partial<QuestionDraft>) => void;
}) {
  const customSections = Array.from(new Set(
    questions
      .map(question => question.sectionTitle?.trim())
      .filter((section): section is string => Boolean(section))
      .filter(section => !MANDATORY_RECRUITMENT_SECTIONS.some(item => item.title === section))
  ));

  const selectSection = (sectionTitle: string, criterionCode?: string) => {
    const nextCriterionCode = (criterionCode ?? draft.criterionCode) || getRecruitmentSectionCriterionCode(sectionTitle);
    onChange({
      sectionTitle,
      criterionCode: nextCriterionCode,
      scoringUse: nextCriterionCode ? 'scored' : draft.scoringUse,
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 lg:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Seção / critério</p>
          <p className="mt-1 text-xs text-slate-500">
            Escolha uma seção antes de criar a pergunta. Os pontos-base aparecem ao lado de cada critério.
          </p>
        </div>
        {draft.sectionTitle ? (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
            {draft.sectionTitle}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {MANDATORY_RECRUITMENT_SECTIONS.map(section => {
          const selected = draft.sectionTitle === section.title;
          return (
            <button
              key={section.category}
              type="button"
              onClick={() => selectSection(section.title, section.defaultCriterionCode)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                selected
                  ? 'border-[#EE6FA8] bg-[#EE6FA8] text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-pink-200 hover:bg-white hover:text-[#993556]'
              }`}
            >
              {section.title} · {section.baseWeight} pts
            </button>
          );
        })}
        {customSections.map(section => (
          <button
            key={section}
            type="button"
            onClick={() => selectSection(section)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              draft.sectionTitle === section
                ? 'border-[#EE6FA8] bg-[#EE6FA8] text-white'
                : 'border-pink-100 bg-pink-50 text-[#993556] hover:border-pink-200'
            }`}
          >
            {section}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Nova seção personalizada</label>
        <input
          value={MANDATORY_RECRUITMENT_SECTIONS.some(section => section.title === draft.sectionTitle) ? '' : draft.sectionTitle}
          onChange={event => onChange({
            sectionTitle: event.target.value,
            criterionCode: getRecruitmentSectionCriterionCode(event.target.value) || draft.criterionCode,
          })}
          placeholder="Ex: Teste prático, Cultura, Disponibilidade local"
          className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </div>
    </div>
  );
}

function QuestionDraftScoringControls({
  draft,
  onChange,
  variant = 'light',
  className = 'lg:col-span-3',
}: {
  draft: QuestionDraft;
  onChange: (patch: Partial<QuestionDraft>) => void;
  variant?: 'dark' | 'light';
  className?: string;
}) {
  const use = getDraftScoringUse(draft);
  const criterion = getStandardRecruitmentCriterion(draft.criterionCode);
  const scoringUseOptions = criterion
    ? SCORING_USE_OPTIONS.filter(option => criterion.allowedUses.includes(option.value))
    : SCORING_USE_OPTIONS;
  const categoryWeight = criterion ? RECRUITMENT_CATEGORY_BASE_WEIGHTS[criterion.category] : null;
  const isDark = variant === 'dark';
  const labelClass = isDark
    ? 'mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400'
    : 'mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400';
  const fieldClass = isDark
    ? 'h-10 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50'
    : 'h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60';

  return (
    <div className={`grid gap-3 rounded-xl border p-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,180px)_minmax(0,180px)] ${
      isDark ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-white'
    } ${className}`}>
      <div>
        <label className={labelClass}>
          Critério / agrupamento
        </label>
        <select
          value={draft.criterionCode}
          onChange={event => {
            const criterionCode = event.target.value;
            const nextCriterion = getStandardRecruitmentCriterion(criterionCode);
            let nextUse = getDraftScoringUse(draft);
            if (nextCriterion && nextUse === 'informational' && nextCriterion.allowedUses.includes('scored')) {
              nextUse = 'scored';
            }
            if (nextCriterion && !nextCriterion.allowedUses.includes(nextUse)) {
              nextUse = nextCriterion.allowedUses.includes('scored') ? 'scored' : nextCriterion.allowedUses[0] ?? 'informational';
            }
            onChange({
              criterionCode,
              scoringUse: nextUse,
              eliminatory: nextUse === 'eliminatory',
            });
          }}
          className={fieldClass}
        >
          <option value="">Sem agrupamento</option>
          {RECRUITMENT_CRITERIA_GROUPS.map(group => (
            <optgroup
              key={group.category}
              label={`${group.label} · ${RECRUITMENT_CATEGORY_BASE_WEIGHTS[group.category]} pts base`}
            >
              {group.criteria.map(option => (
                <option key={option.code} value={option.code}>{option.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>
          Pontuação
        </label>
        <select
          value={use}
          onChange={event => {
            const nextUse = event.target.value as RecruitmentQuestionScoringUse;
            onChange({
              scoringUse: nextUse,
              eliminatory: nextUse === 'eliminatory',
            });
          }}
          className={fieldClass}
        >
          {scoringUseOptions.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>
          Peso
        </label>
        <select
          value={draft.importance}
          onChange={event => onChange({ importance: event.target.value as HrQuestionWeight })}
          disabled={use === 'informational'}
          className={fieldClass}
        >
          {IMPORTANCE_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <p className={`text-xs md:col-span-3 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
        {criterion && categoryWeight !== null
          ? `${RECRUITMENT_CATEGORY_LABELS[criterion.category]} tem ${categoryWeight} pts base dentro da camada. O sistema redistribui esse peso entre as perguntas desse agrupamento conforme a importância.`
          : 'Sem agrupamento, a pergunta não entra no cálculo final. Escolha um critério para usar os pesos predefinidos.'}
      </p>
    </div>
  );
}

type RecruitmentSection = 'jobs' | 'talents' | 'integration';
type RecruitmentJobViewMode = 'kanban' | 'list' | 'openings';
type CandidateEligibilityFilter = '' | 'eligible' | 'not_eligible' | 'scored';
type CandidateSortMode = 'recent' | 'score_desc' | 'score_asc' | 'name';

const RECRUITMENT_SECTION_META: Record<RecruitmentSection, { eyebrow: string; title: string; description: string }> = {
  jobs: {
    eyebrow: 'Gestão da vaga',
    title: 'Recrutamento',
    description: 'Crie vagas, filtre processos em andamento e abra o Kanban de cada vaga.',
  },
  talents: {
    eyebrow: 'Banco de talentos',
    title: 'Talentos',
    description: 'Gerencie candidatos disponíveis para futuras oportunidades.',
  },
  integration: {
    eyebrow: 'Integração',
    title: 'Integração',
    description: 'Acompanhe documentação, criação do colaborador e finalização da integração.',
  },
};

const MS_DAY = 86_400_000;

function dateInputToIso(value: string, endOfDay = false) {
  if (!value) return null;
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).toISOString();
}

function safeDateTime(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function getCandidateStageStartedAt(candidate: Candidate, status = candidate.status) {
  const history = [
    ...(candidate.latestApplication?.stageHistory ?? []),
    ...(candidate.recruitmentHistory ?? []),
  ]
    .filter((entry): entry is CandidateStageHistoryEntry => !!entry?.createdAt && entry.toStatus === status)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return safeDateTime(history[0]?.createdAt) ?? safeDateTime(candidate.appliedAt) ?? safeDateTime(candidate.updatedAt) ?? Date.now();
}

function getCandidateStageTiming(candidate: Candidate, stage?: RecruitmentStage, now = Date.now()) {
  if (!stage || stage.dueDays === null || stage.dueDays === undefined) {
    return { daysInStage: 0, daysLeft: null as number | null, overdueDays: 0, isOverdue: false };
  }

  const startedAt = getCandidateStageStartedAt(candidate, stage.id);
  const daysInStage = Math.max(0, Math.floor((now - startedAt) / MS_DAY));
  const deadline = startedAt + stage.dueDays * MS_DAY;
  const rawDaysLeft = Math.ceil((deadline - now) / MS_DAY);
  const overdueDays = rawDaysLeft < 0 ? Math.abs(rawDaysLeft) : 0;

  return {
    daysInStage,
    daysLeft: rawDaysLeft,
    overdueDays,
    isOverdue: rawDaysLeft < 0,
  };
}

// ─── API helpers ──────────────────────────────────────────────────────────────

// The HR endpoints have several response shapes; callers may opt into a precise type.
// Keep the legacy default for the existing call sites while centralizing safe parsing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function apiFetch<T = any>(path: string, getToken: () => Promise<string>, init?: RequestInit): Promise<T> {
  const token = await getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  return readHrJsonResponse<T>(res, 'Falha ao concluir a operação.');
}

type ResumeUpload = {
  url: string;
  path?: string;
};

type CandidateProfileApplication = {
  id: string;
  jobOpeningId?: string | null;
  jobRoleName?: string | null;
  functionName?: string | null;
  unitName?: string | null;
  stage?: CandidateStatus;
  status?: string | null;
  source?: string | null;
  notes?: string | null;
  appliedAt?: string | null;
  updatedAt?: string | null;
  formAnswers?: Record<string, unknown>;
  formQuestionSnapshot?: HrFormQuestion[];
};

type CandidateProfilePayload = {
  candidate: Candidate;
  applications: CandidateProfileApplication[];
  onboardingProcesses: OnboardingProcess[];
};

async function uploadResume(file: File, getToken: () => Promise<string>): Promise<ResumeUpload> {
  const token = await getToken();
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/hr/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error ?? 'Falha ao enviar currículo.');
  }
  const { url, path } = await res.json();
  return { url: url as string, path: typeof path === 'string' ? path : undefined };
}

// ─── Small shared components ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: CandidateStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border border-current/20">
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.color} opacity-80`} />
      <span className="text-slate-300">{cfg.label}</span>
    </span>
  );
}

function RatingStars({ value, onChange, readonly }: {
  value: number; onChange?: (v: number) => void; readonly?: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star} type="button" disabled={readonly}
          onClick={() => onChange?.(star)}
          className={`transition-transform ${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'}`}
        >
          <Star className={`h-3 w-3 ${star <= value ? 'fill-yellow-400 text-yellow-400' : 'text-slate-700'}`} />
        </button>
      ))}
    </div>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  return (
    <p className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" /> {msg}
    </p>
  );
}

function QuestionScoringEditor({
  question,
  onChange,
  canManage = true,
  sourceLayer,
  variant = 'dark',
}: {
  question: HrFormQuestion;
  onChange: (patch: Partial<HrFormQuestion>) => void;
  canManage?: boolean;
  sourceLayer?: 'role' | 'function' | 'opening';
  variant?: 'dark' | 'light';
}) {
  const criterion = question.scoring?.criterionCode
    ? STANDARD_RECRUITMENT_CRITERIA.find(item => item.code === question.scoring?.criterionCode)
    : null;
  const category = question.scoring?.category ?? criterion?.category;
  const rubric = question.scoring?.rubric ?? (question.scoring?.criterionCode ? RECRUITMENT_DEFAULT_RUBRICS[question.scoring.criterionCode] : undefined);
  const isDark = variant === 'dark';
  const fieldClass = isDark
    ? 'rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50'
    : 'rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60';
  const labelClass = isDark
    ? 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-600'
    : 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400';
  const mutedClass = isDark ? 'text-slate-500' : 'text-slate-500';

  function patchScoring(patch: Partial<NonNullable<HrFormQuestion['scoring']>>) {
    onChange(withQuestionScoring(question, {
      sourceLayer: sourceLayer ?? question.scoring?.sourceLayer,
      ...patch,
    }));
  }

  return (
    <details className={`group mt-3 rounded-xl border ${isDark ? 'border-slate-800 bg-slate-900/35' : 'border-slate-100 bg-slate-50/60'}`}>
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
        <span className="truncate">
          Score: {SCORING_USE_OPTIONS.find(option => option.value === getQuestionScoringUse(question))?.label ?? 'Informativa'}
          {criterion ? ` · ${criterion.label}` : ''}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className={`border-t p-3 ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
        <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
        <div>
          <label className={labelClass}>Critério</label>
          <select
            value={question.scoring?.criterionCode ?? ''}
            onChange={event => onChange({
              ...scoringFromCriterion(question, event.target.value),
              scoring: {
                ...(question.scoring ?? {}),
                ...(scoringFromCriterion(question, event.target.value).scoring ?? {}),
                sourceLayer: sourceLayer ?? question.scoring?.sourceLayer,
              },
            })}
            disabled={!canManage}
            className={`${fieldClass} w-full`}
          >
            <option value="">Sem critério</option>
            {STANDARD_RECRUITMENT_CRITERIA.map(item => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>
          {category ? (
            <p className={`mt-1 text-[10px] ${mutedClass}`}>
              Categoria: {RECRUITMENT_CATEGORY_LABELS[category]} · {RECRUITMENT_CATEGORY_BASE_WEIGHTS[category]} pts base
            </p>
          ) : null}
        </div>
        <div>
          <label className={labelClass}>Uso</label>
          <select
            value={getQuestionScoringUse(question)}
            onChange={event => patchScoring({ use: event.target.value as RecruitmentQuestionScoringUse })}
            disabled={!canManage}
            className={`${fieldClass} w-full`}
          >
            {SCORING_USE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Importância</label>
          <select
            value={getQuestionImportance(question)}
            onChange={event => patchScoring({ importance: event.target.value as HrQuestionWeight })}
            disabled={!canManage || getQuestionScoringUse(question) === 'informational'}
            className={`${fieldClass} w-full`}
          >
            {IMPORTANCE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Grupo</label>
          <input
            value={question.scoring?.groupName ?? ''}
            onChange={event => patchScoring({
              groupName: event.target.value,
              groupId: event.target.value.toLowerCase().replace(/[^a-z0-9]+/gi, '-'),
            })}
            disabled={!canManage}
            placeholder="Ex: Aderência à escala"
            className={`${fieldClass} w-full`}
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>Justificativa</label>
          <input
            value={question.scoring?.justification ?? ''}
            onChange={event => patchScoring({ justification: event.target.value })}
            disabled={!canManage}
            placeholder="Obrigatória para alta, crítica ou eliminatória"
            className={`${fieldClass} w-full`}
          />
        </div>
        {(question.type === 'select' || question.type === 'multi_select' || question.type === 'yes_no') && (
          <div className="md:col-span-3">
            <label className={labelClass}>Fator por resposta</label>
            <textarea
              value={formatAnswerFactors(question.scoring?.answerFactors)}
              onChange={event => patchScoring({ answerFactors: parseAnswerFactors(event.target.value) })}
              disabled={!canManage || getQuestionScoringUse(question) !== 'scored'}
              rows={2}
              placeholder={'Sim=1\nParcialmente=0.7\nNão=0'}
              className={`${fieldClass} w-full resize-none`}
            />
            <p className={`mt-1 text-[10px] ${mutedClass}`}>Use valores entre 0 e 1. O peso final continua calculado pelo sistema.</p>
          </div>
        )}
        {rubric?.length ? (
          <div className="md:col-span-3">
            <label className={labelClass}>Rubrica objetiva</label>
            <div className={`grid gap-2 rounded-xl border p-2 ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-white'}`}>
              {rubric.map(item => (
                <div key={`${item.factor}-${item.label}`} className="grid gap-1 text-[11px] md:grid-cols-[3rem_8rem_1fr]">
                  <span className={isDark ? 'font-bold text-slate-300' : 'font-bold text-slate-700'}>{item.factor}</span>
                  <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>{item.label}</span>
                  <span className={mutedClass}>{item.description}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        </div>
      </div>
    </details>
  );
}

type QuestionEditorVariant = 'dark' | 'light';

type RecruitmentQuestionsDesignerProps = {
  questions: HrFormQuestion[];
  canManage?: boolean;
  variant?: QuestionEditorVariant;
  fallbackSectionTitle: string;
  emptyLabel: string;
  activeLabel?: string;
  showActiveToggle?: boolean;
  showScoring?: boolean;
  optionPlaceholder?: string;
  dynamicRoleFunctionOptions?: string[];
  dynamicDepartmentOptions?: string[];
  dynamicCityOptions?: string[];
  onUpdateQuestion: (questionId: string, patch: Partial<HrFormQuestion>) => void;
  onUpdateQuestionOptions: (questionId: string, optionsText: string) => void;
  onMoveQuestion: (questionId: string, direction: -1 | 1) => void;
  onRemoveQuestion: (questionId: string) => void;
  onPrepareAddQuestion?: (patch: { sectionTitle?: string; parentQuestionId?: string }) => void;
  inlineDraft?: QuestionDraft;
  onInlineDraftChange?: (patch: Partial<QuestionDraft>) => void;
  onInlineDraftAdd?: () => void;
  onInlineDraftCancel?: () => void;
  sourceLayerResolver?: (question: HrFormQuestion) => 'role' | 'function' | 'opening';
};

function countTreeSubquestions(node: RecruitmentQuestionTreeNode): number {
  return node.subquestions.reduce((total, child) => total + 1 + countTreeSubquestions(child), 0);
}

function questionTypeLabel(type: HrFormQuestion['type']) {
  const label = QUESTION_TYPES.find(item => item.value === type)?.label ?? 'Campo';
  return label === 'Seleção única' ? 'Seleção' : label;
}

function pluralizePt(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function RecruitmentMetricCard({
  label,
  value,
  description,
  tone = 'slate',
}: {
  label: string;
  value: string | number;
  description?: string;
  tone?: 'slate' | 'violet' | 'emerald' | 'pink';
}) {
  const toneClass = {
    slate: 'text-slate-950',
    violet: 'text-violet-600',
    emerald: 'text-emerald-600',
    pink: 'text-pink-600',
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold leading-none ${toneClass}`}>{value}</p>
      {description ? <p className="mt-2 text-[11px] text-slate-400">{description}</p> : null}
    </div>
  );
}

function RecruitmentModernStepTabs<T extends string>({
  steps,
  active,
  onChange,
}: {
  steps: Array<{ value: T; label: string }>;
  active: T;
  onChange: (value: T) => void;
}) {
  const activeIndex = Math.max(0, steps.findIndex(step => step.value === active));

  return (
    <div className="flex w-full min-w-0 items-center gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
      {steps.map((step, index) => {
        const isActive = step.value === active;
        const isDone = index < activeIndex;
        return (
          <React.Fragment key={step.value}>
            <button
              type="button"
              onClick={() => onChange(step.value)}
              className={`group flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold transition ${
                isActive
                  ? 'text-[#993556]'
                  : isDone
                    ? 'text-emerald-700 hover:text-emerald-800'
                    : 'text-slate-500 hover:text-slate-950'
              }`}
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition ${
                isActive
                  ? 'bg-[#EE6FA8] text-white shadow-sm'
                  : isDone
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
              }`}>
                {isDone ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
              </span>
              {step.label}
            </button>
            {index < steps.length - 1 ? (
              <span className={`hidden h-px min-w-8 flex-1 sm:block ${index < activeIndex ? 'bg-emerald-200' : 'bg-slate-200'}`} />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function RecruitmentFormSectionTabs({
  active,
  onChange,
}: {
  active: 'talent' | 'models' | 'integration';
  onChange: (value: 'talent' | 'models' | 'integration') => void;
}) {
  const tabs = [
    { value: 'talent', label: 'Banco de talentos' },
    { value: 'models', label: 'Modelos de formulários' },
    { value: 'integration', label: 'Modelos de integração' },
  ] as const;

  return (
    <div className="flex min-w-0 gap-6 border-b border-slate-200">
      {tabs.map(item => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={`border-b-2 px-1 pb-3 text-sm font-semibold transition ${
            active === item.value
              ? 'border-[#EE6FA8] text-[#993556]'
              : 'border-transparent text-slate-500 hover:text-slate-950'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function formatConditionValue(value: unknown) {
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (value === null || value === undefined || value === '') return 'valor';
  return String(value);
}

function conditionSummary(
  question: HrFormQuestion,
  questionsById: Map<string, HrFormQuestion>
): { label: string; tone: 'emerald' | 'red' | 'slate' } | null {
  const condition = question.conditions?.[0];
  if (!condition) return question.parentQuestionId ? { label: 'Sempre', tone: 'slate' } : null;
  const parent = questionsById.get(condition.questionId);
  const value = formatConditionValue(condition.value);
  const prefix = condition.operator === 'not_equals'
    ? 'Se não for'
    : condition.operator === 'includes'
      ? 'Se contém'
      : condition.operator === 'answered'
        ? 'Se respondida'
        : condition.operator === 'not_answered'
          ? 'Se vazia'
          : 'Se';
  const label = condition.operator === 'answered' || condition.operator === 'not_answered'
    ? prefix
    : `${prefix} ${value}`;
  const tone = condition.value === false || condition.operator === 'not_equals' || condition.operator === 'not_answered'
    ? 'red'
    : parent || condition.value === true
      ? 'emerald'
      : 'slate';
  return { label, tone };
}

function conditionBadgeClass(tone: 'emerald' | 'red' | 'slate', isDark: boolean) {
  if (tone === 'emerald') {
    return isDark
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
      : 'border-emerald-100 bg-emerald-50 text-emerald-700';
  }
  if (tone === 'red') {
    return isDark
      ? 'border-red-500/20 bg-red-500/10 text-red-300'
      : 'border-red-100 bg-red-50 text-red-600';
  }
  return isDark
    ? 'border-slate-800 bg-slate-900 text-slate-500'
    : 'border-slate-100 bg-slate-50 text-slate-500';
}

const RECRUITMENT_SECTION_TONES = [
  {
    header: 'border-slate-100 bg-white',
    circle: 'bg-[#EE6FA8] text-white',
    text: 'text-[#993556]',
    chip: 'bg-pink-50 text-[#993556]',
    progress: 'bg-[#EE6FA8]',
  },
  {
    header: 'border-violet-100 bg-violet-50/80',
    circle: 'bg-violet-600 text-white',
    text: 'text-violet-700',
    chip: 'bg-violet-50 text-violet-700',
    progress: 'bg-violet-600',
  },
  {
    header: 'border-sky-100 bg-sky-50/80',
    circle: 'bg-sky-600 text-white',
    text: 'text-sky-700',
    chip: 'bg-sky-50 text-sky-700',
    progress: 'bg-sky-600',
  },
  {
    header: 'border-emerald-100 bg-emerald-50/80',
    circle: 'bg-emerald-600 text-white',
    text: 'text-emerald-700',
    chip: 'bg-emerald-50 text-emerald-700',
    progress: 'bg-emerald-600',
  },
] as const;

function recruitmentSectionTone(index: number, isDark: boolean) {
  if (isDark) {
    return {
      header: 'border-slate-800 bg-slate-900/70',
      circle: 'bg-slate-800 text-slate-200',
      text: 'text-slate-200',
      chip: 'bg-slate-900 text-slate-400',
      progress: 'bg-indigo-500',
    };
  }
  return RECRUITMENT_SECTION_TONES[0];
}

function RecruitmentQuestionsDesigner({
  questions,
  canManage = true,
  variant = 'light',
  fallbackSectionTitle,
  emptyLabel,
  activeLabel = 'Exibir no formulário',
  showActiveToggle = true,
  showScoring = false,
  optionPlaceholder = 'Opções, uma por linha\nSim\nNão\nTalvez',
  dynamicRoleFunctionOptions = [],
  dynamicDepartmentOptions = [],
  dynamicCityOptions = [],
  onUpdateQuestion,
  onUpdateQuestionOptions,
  onMoveQuestion,
  onRemoveQuestion,
  onPrepareAddQuestion,
  inlineDraft,
  onInlineDraftChange,
  onInlineDraftAdd,
  onInlineDraftCancel,
  sourceLayerResolver,
}: RecruitmentQuestionsDesignerProps) {
  const isDark = variant === 'dark';
  const sections = groupRecruitmentQuestionsBySection(questions, fallbackSectionTitle);
  const indexById = new Map(questions.map((question, index) => [question.id, index]));
  const questionsById = new Map(questions.map(question => [question.id, question]));
  const checkboxClass = isDark
    ? 'h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-500 disabled:opacity-40'
    : 'h-4 w-4 rounded border-slate-300 text-[#EE6FA8] disabled:opacity-40';
  const inputClass = isDark
    ? 'rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50'
    : 'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-pink-200 disabled:opacity-60';
  const labelClass = isDark
    ? 'mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500'
    : 'mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400';

  const renderQuestionNode = (
    node: RecruitmentQuestionTreeNode,
    depth: number,
    sectionTitle: string,
    sectionTone: ReturnType<typeof recruitmentSectionTone>
  ): React.ReactNode => {
    const question = node.question;
    const index = indexById.get(question.id) ?? 0;
    const availableQuestions = questions.slice(0, index);
    const subquestionCount = countTreeSubquestions(node);
    const condition = conditionSummary(question, questionsById);
    const isSubquestion = depth > 0;
    const rowClass = isDark
      ? isSubquestion
        ? 'border-slate-800 bg-slate-950/35'
        : 'border-slate-800 bg-slate-950/70'
      : isSubquestion
        ? 'border-slate-100 bg-white'
        : 'border-slate-100 bg-white shadow-sm';
    const summaryClass = isDark
      ? 'text-slate-200 hover:bg-slate-900/70'
      : 'text-slate-900 hover:bg-pink-50/40';
    const editorBorderClass = isDark ? 'border-slate-800' : 'border-slate-100';

    return (
      <div key={question.id} className={`min-w-0 ${isSubquestion ? 'pl-5' : ''}`}>
        <details className={`group min-w-0 rounded-lg border open:border-pink-200 open:ring-1 open:ring-pink-100 ${rowClass} ${question.active === false ? 'opacity-65' : ''}`}>
          <summary className={`flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 text-left transition [&::-webkit-details-marker]:hidden ${summaryClass}`}>
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
              isSubquestion
                ? isDark ? 'bg-slate-900 text-slate-500' : 'bg-slate-50 text-slate-400'
                : sectionTone.chip
            }`}>
              {isSubquestion ? (
                <span className={`h-1.5 w-1.5 rounded-full ${isDark ? 'bg-slate-600' : 'bg-slate-300'}`} />
              ) : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold">{question.text || 'Pergunta sem título'}</span>
                {question.active === false && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    isDark ? 'bg-slate-900 text-slate-500' : 'bg-slate-100 text-slate-500'
                  }`}>
                    Oculta
                  </span>
                )}
              </div>
              {subquestionCount > 0 && (
                <p className={isDark ? 'mt-0.5 text-[11px] font-medium text-indigo-300' : 'mt-0.5 text-[11px] font-medium text-[#993556]'}>
                  {pluralizePt(subquestionCount, 'subpergunta', 'subperguntas')}
                </p>
              )}
            </div>
            {condition && (
              <span className={`hidden shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold sm:inline-flex ${conditionBadgeClass(condition.tone, isDark)}`}>
                {condition.label}
              </span>
            )}
            <span className={`hidden shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold sm:inline-flex ${
              isDark ? 'border-slate-800 bg-slate-900 text-slate-400' : 'border-slate-100 bg-slate-50 text-slate-500'
            }`}>
              {questionTypeLabel(question.type)}
            </span>
            {question.required && (
              <span className={`hidden shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold sm:inline-flex ${
                isDark ? 'border-indigo-500/20 bg-indigo-500/10 text-indigo-300' : 'border-pink-100 bg-pink-50 text-[#993556]'
              }`}>
                Obr.
              </span>
            )}
            {question.eliminatory && (
              <span className={`hidden shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold sm:inline-flex ${
                isDark ? 'border-red-500/20 bg-red-500/10 text-red-300' : 'border-red-100 bg-red-50 text-red-600'
              }`}>
                Elim.
              </span>
            )}
            {getQuestionScoringUse(question) === 'scored' && (
              <span className={`hidden shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold sm:inline-flex ${
                isDark ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : 'border-amber-100 bg-amber-50 text-amber-700'
              }`}>
                Pont. {IMPORTANCE_OPTIONS.find(item => item.value === getQuestionImportance(question))?.label ?? 'Média'}
              </span>
            )}
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
          </summary>

          <div className={`min-w-0 border-t px-3 pb-3 pt-3 ${editorBorderClass}`}>
            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,170px)]">
              <div className="lg:col-span-2">
                <label className={labelClass}>Pergunta</label>
                <input
                  type="text"
                  value={question.text}
                  onChange={event => onUpdateQuestion(question.id, { text: event.target.value })}
                  disabled={!canManage}
                  className={`${inputClass} w-full font-semibold`}
                />
              </div>
              <QuestionSectionEditor
                question={question}
                onChange={(patch) => onUpdateQuestion(question.id, patch)}
                canManage={canManage}
                variant={variant}
              />
              <QuestionParentEditor
                question={question}
                availableQuestions={availableQuestions}
                onChange={(patch) => onUpdateQuestion(question.id, patch)}
                canManage={canManage}
                variant={variant}
              />
              <div>
                <label className={labelClass}>Tipo</label>
                <select
                  value={question.type}
                  onChange={event => onUpdateQuestion(question.id, { type: event.target.value as HrFormQuestion['type'] })}
                  disabled={!canManage}
                  className={`${inputClass} w-full`}
                >
                  {QUESTION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap items-end gap-3 pb-1">
                <label className={`flex items-center gap-2 text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                  <input
                    type="checkbox"
                    checked={question.required}
                    onChange={event => onUpdateQuestion(question.id, { required: event.target.checked })}
                    disabled={!canManage}
                    className={checkboxClass}
                  />
                  Obrigatório
                </label>
                {showActiveToggle && (
                  <label className={`flex items-center gap-2 text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                    <input
                      type="checkbox"
                      checked={question.active !== false}
                      onChange={event => onUpdateQuestion(question.id, { active: event.target.checked })}
                      disabled={!canManage}
                      className={checkboxClass}
                    />
                    {activeLabel}
                  </label>
                )}
                <label className={`flex items-center gap-2 text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                  <input
                    type="checkbox"
                    checked={question.eliminatory}
                    onChange={event => onUpdateQuestion(question.id, withQuestionScoring(question, {
                      use: event.target.checked ? 'eliminatory' : 'informational',
                      sourceLayer: sourceLayerResolver?.(question),
                    }))}
                    disabled={!canManage}
                    className={checkboxClass}
                  />
                  Eliminatório
                </label>
                <label className={`flex items-center gap-2 text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                  <input
                    type="checkbox"
                    checked={question.config?.multiline === true}
                    onChange={event => onUpdateQuestion(question.id, {
                      config: { ...(question.config ?? {}), multiline: event.target.checked },
                    })}
                    disabled={!canManage || question.type !== 'text'}
                    className={checkboxClass}
                  />
                  Texto longo
                </label>
              </div>
              {(question.type === 'select' || question.type === 'multi_select') && (
                question.config?.source === 'public_units' ? (
                    <p className={`lg:col-span-2 rounded-xl border px-3 py-2 text-xs font-medium ${
                    isDark ? 'border-slate-800 bg-slate-900/70 text-slate-500' : 'border-slate-100 bg-slate-50 text-slate-500'
                  }`}>
                    Opções atualizadas automaticamente pelas unidades ativas do site público.
                  </p>
                ) : question.config?.source === 'public_roles_functions' ? (
                  <div className={`lg:col-span-2 rounded-xl border p-3 ${
                    isDark ? 'border-slate-800 bg-slate-900/70' : 'border-slate-100 bg-slate-50'
                  }`}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className={labelClass}>Opções públicas</p>
                        <p className={isDark ? 'text-xs text-slate-500' : 'text-xs text-slate-500'}>
                          Cargos e funções ativos são atualizados automaticamente. Desmarque o que não deve aparecer.
                        </p>
                      </div>
                      <span className={isDark ? 'text-[11px] font-semibold text-slate-500' : 'text-[11px] font-semibold text-slate-500'}>
                        {pluralizePt(getRecruitmentQuestionOptions(question, { rolesFunctions: dynamicRoleFunctionOptions }).length, 'visível', 'visíveis')}
                      </span>
                    </div>
                    <div className="grid max-h-44 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                      {dynamicRoleFunctionOptions.map(option => {
                        const hiddenOptions = Array.isArray(question.config?.hiddenOptions)
                          ? question.config.hiddenOptions.filter((entry): entry is string => typeof entry === 'string')
                          : [];
                        const checked = !hiddenOptions.includes(option);
                        return (
                          <label
                            key={option}
                            className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold ${
                              checked
                                ? isDark ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-emerald-100 bg-white text-slate-700'
                                : isDark ? 'border-slate-800 bg-slate-950 text-slate-500' : 'border-slate-200 bg-white/60 text-slate-400'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canManage}
                              onChange={event => {
                                const nextHidden = event.target.checked
                                  ? hiddenOptions.filter(item => item !== option)
                                  : Array.from(new Set([...hiddenOptions, option]));
                                onUpdateQuestion(question.id, {
                                  config: {
                                    ...(question.config ?? {}),
                                    source: 'public_roles_functions',
                                    hiddenOptions: nextHidden,
                                  },
                                });
                              }}
                              className={checkboxClass}
                            />
                            <span className="truncate">{option}</span>
                          </label>
                        );
                      })}
                    </div>
                    {dynamicRoleFunctionOptions.length === 0 ? (
                      <p className={isDark ? 'text-xs text-slate-500' : 'text-xs text-slate-500'}>
                        Nenhum cargo ou função ativo encontrado.
                      </p>
                    ) : null}
                  </div>
                ) : question.config?.source === 'public_departments' || question.config?.source === 'public_cities' ? (() => {
                  const isDepartmentSource = question.config?.source === 'public_departments';
                  const dynamicOptions = isDepartmentSource ? dynamicDepartmentOptions : dynamicCityOptions;
                  const source = isDepartmentSource ? 'public_departments' : 'public_cities';
                  const title = isDepartmentSource ? 'Departamentos públicos' : 'Cidades públicas';
                  const description = isDepartmentSource
                    ? 'Departamentos ativos são atualizados automaticamente. Desmarque o que não deve aparecer.'
                    : 'Cidades disponíveis são atualizadas automaticamente a partir das unidades ativas.';
                  const emptyText = isDepartmentSource ? 'Nenhum departamento ativo encontrado.' : 'Nenhuma cidade ativa encontrada.';
                  return (
                    <div className={`lg:col-span-2 rounded-xl border p-3 ${
                      isDark ? 'border-slate-800 bg-slate-900/70' : 'border-slate-100 bg-slate-50'
                    }`}>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className={labelClass}>{title}</p>
                          <p className={isDark ? 'text-xs text-slate-500' : 'text-xs text-slate-500'}>{description}</p>
                        </div>
                        <span className={isDark ? 'text-[11px] font-semibold text-slate-500' : 'text-[11px] font-semibold text-slate-500'}>
                          {pluralizePt(getRecruitmentQuestionOptions(question, {
                            departments: dynamicDepartmentOptions,
                            cities: dynamicCityOptions,
                          }).length, 'visível', 'visíveis')}
                        </span>
                      </div>
                      <div className="grid max-h-44 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                        {dynamicOptions.map(option => {
                          const hiddenOptions = Array.isArray(question.config?.hiddenOptions)
                            ? question.config.hiddenOptions.filter((entry): entry is string => typeof entry === 'string')
                            : [];
                          const checked = !hiddenOptions.includes(option);
                          return (
                            <label
                              key={option}
                              className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold ${
                                checked
                                  ? isDark ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-emerald-100 bg-white text-slate-700'
                                  : isDark ? 'border-slate-800 bg-slate-950 text-slate-500' : 'border-slate-200 bg-white/60 text-slate-400'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!canManage}
                                onChange={event => {
                                  const nextHidden = event.target.checked
                                    ? hiddenOptions.filter(item => item !== option)
                                    : Array.from(new Set([...hiddenOptions, option]));
                                  onUpdateQuestion(question.id, {
                                    config: {
                                      ...(question.config ?? {}),
                                      source,
                                      hiddenOptions: nextHidden,
                                    },
                                  });
                                }}
                                className={checkboxClass}
                              />
                              <span className="truncate">{option}</span>
                            </label>
                          );
                        })}
                      </div>
                      {dynamicOptions.length === 0 ? (
                        <p className={isDark ? 'text-xs text-slate-500' : 'text-xs text-slate-500'}>{emptyText}</p>
                      ) : null}
                    </div>
                  );
                })() : (
                  <div className="lg:col-span-2">
                    <label className={labelClass}>Opções</label>
                    <textarea
                      value={Array.isArray(question.config?.options) ? question.config.options.join('\n') : ''}
                      onChange={event => onUpdateQuestionOptions(question.id, event.target.value)}
                      disabled={!canManage}
                      rows={3}
                      placeholder={optionPlaceholder}
                      className={`${inputClass} w-full resize-none text-xs`}
                    />
                  </div>
                )
              )}
            </div>

            {showScoring && (
              <QuestionScoringEditor
                question={question}
                sourceLayer={sourceLayerResolver?.(question)}
                onChange={(patch) => onUpdateQuestion(question.id, patch)}
                canManage={canManage}
                variant={variant}
              />
            )}
            <QuestionConditionEditor
              question={question}
              availableQuestions={availableQuestions}
              onChange={(patch) => onUpdateQuestion(question.id, patch)}
              canManage={canManage}
              variant={variant}
            />

            <div className={`mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 ${editorBorderClass}`}>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!canManage || index === 0}
                  onClick={() => onMoveQuestion(question.id, -1)}
                  className={`rounded-lg px-2 py-1 text-xs disabled:opacity-30 ${
                    isDark ? 'text-slate-500 hover:bg-slate-800 hover:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  Subir
                </button>
                <button
                  type="button"
                  disabled={!canManage || index === questions.length - 1}
                  onClick={() => onMoveQuestion(question.id, 1)}
                  className={`rounded-lg px-2 py-1 text-xs disabled:opacity-30 ${
                    isDark ? 'text-slate-500 hover:bg-slate-800 hover:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  Descer
                </button>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => onRemoveQuestion(question.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:opacity-30 ${
                  isDark ? 'text-red-300 hover:bg-red-500/10' : 'text-red-500 hover:bg-red-50'
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remover {isSubquestion ? 'subpergunta' : 'pergunta'}
              </button>
            </div>
          </div>
        </details>

        {node.subquestions.length > 0 && (
          <div className={`ml-4 mt-2 min-w-0 space-y-2 border-l pl-3 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
            {node.subquestions.map(child => renderQuestionNode(child, depth + 1, sectionTitle, sectionTone))}
          </div>
        )}
        {depth === 0 && canManage && onPrepareAddQuestion && (
          inlineDraft?.parentQuestionId === question.id && onInlineDraftChange && onInlineDraftAdd && onInlineDraftCancel ? (
            <div className={`ml-8 mt-2 min-w-0 rounded-xl border p-3 ${
              isDark ? 'border-indigo-500/25 bg-indigo-500/5' : 'border-pink-200 bg-pink-50/40'
            }`}>
              <p className={`mb-2 text-[10px] font-bold uppercase tracking-wider ${
                isDark ? 'text-indigo-300' : 'text-[#993556]'
              }`}>
                Nova subpergunta
              </p>
              <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,130px)]">
                <input
                  value={inlineDraft.text}
                  onChange={event => onInlineDraftChange({ text: event.target.value })}
                  placeholder="Texto da subpergunta..."
                  className={`h-9 rounded-lg border px-3 text-xs outline-none focus:ring-2 ${
                    isDark
                      ? 'border-slate-800 bg-slate-950 text-slate-100 placeholder-slate-600 focus:ring-indigo-500/30'
                      : 'border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:ring-pink-200'
                  }`}
                />
                <select
                  value={inlineDraft.type}
                  onChange={event => onInlineDraftChange({ type: event.target.value as HrFormQuestion['type'] })}
                  className={`h-9 rounded-lg border px-3 text-xs outline-none focus:ring-2 ${
                    isDark
                      ? 'border-slate-800 bg-slate-950 text-slate-100 focus:ring-indigo-500/30'
                      : 'border-slate-200 bg-white text-slate-700 focus:ring-pink-200'
                  }`}
                >
                  {QUESTION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {question.type === 'yes_no' ? (
                  <>
                    <span className={isDark ? 'text-[11px] text-slate-500' : 'text-[11px] text-slate-500'}>
                      Exibir se resposta =
                    </span>
                    {([
                      { value: 'true', label: 'Sim' },
                      { value: 'false', label: 'Não' },
                      { value: 'always', label: 'Sempre' },
                    ] as const).map(item => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => onInlineDraftChange({ conditionValue: item.value })}
                        className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                          inlineDraft.conditionValue === item.value
                            ? 'bg-[#EE6FA8] text-white'
                            : isDark
                              ? 'bg-slate-900 text-slate-400 hover:text-slate-200'
                              : 'bg-white text-slate-500 hover:text-[#993556]'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={onInlineDraftAdd}
                  className="ml-0 inline-flex h-8 items-center rounded-full bg-[#EE6FA8] px-3 text-xs font-semibold text-white hover:bg-[#D9528E] sm:ml-2"
                >
                  + Adicionar
                </button>
                <button
                  type="button"
                  onClick={onInlineDraftCancel}
                  className={`inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold ${
                    isDark ? 'text-slate-500 hover:text-slate-200' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onPrepareAddQuestion({
                sectionTitle: question.sectionTitle || sectionTitle,
                parentQuestionId: question.id,
              })}
              className={`ml-8 mt-2 inline-flex rounded-lg border border-dashed px-3 py-2 text-xs font-semibold ${
                isDark ? 'border-slate-800 text-slate-500 hover:text-slate-300' : 'border-pink-200 bg-pink-50/40 text-[#993556] hover:bg-pink-50'
              }`}
            >
              + Subpergunta
            </button>
          )
        )}
      </div>
    );
  };

  if (questions.length === 0) {
    return (
      <div className="space-y-3">
        <div className={`rounded-xl border border-dashed px-4 py-6 text-center text-sm ${
          isDark ? 'border-slate-800 bg-slate-950/40 text-slate-500' : 'border-slate-200 bg-slate-50 text-slate-500'
        }`}>
          <div className={`mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full ${
            isDark ? 'bg-slate-900 text-slate-500' : 'bg-pink-50 text-pink-600'
          }`}>
            <Plus className="h-4 w-4" />
          </div>
          <p className="font-semibold">{emptyLabel}</p>
          {canManage && onPrepareAddQuestion && (
            <button
              type="button"
              onClick={() => onPrepareAddQuestion({ sectionTitle: '' })}
              className={`mt-4 inline-flex h-9 items-center justify-center rounded-full border px-3 text-xs font-semibold ${
                isDark
                  ? 'border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  : 'border-pink-200 bg-white text-[#993556] hover:bg-pink-50'
              }`}
            >
              Preparar primeira pergunta
            </button>
          )}
        </div>
        {canManage && onPrepareAddQuestion && (
          <button
            type="button"
            onClick={() => onPrepareAddQuestion({ sectionTitle: 'Nova seção' })}
            className={`flex w-full items-center justify-center rounded-lg border border-dashed px-3 py-3 text-xs font-semibold ${
              isDark
                ? 'border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300'
                : 'border-pink-200 bg-pink-50/40 text-[#993556] hover:bg-pink-50'
            }`}
          >
            + Adicionar seção
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 overflow-x-hidden">
      {sections.map((section, sectionIndex) => {
        const tree = buildRecruitmentQuestionTree(section.questions);
        const subquestionCount = section.questions.length - tree.length;
        const sectionTone = recruitmentSectionTone(sectionIndex, isDark);
        const sectionPercent = questions.length > 0
          ? Math.max(8, Math.round((section.questions.length / questions.length) * 100))
          : 0;
        return (
          <section
            key={section.id}
            className={`overflow-hidden rounded-lg border shadow-sm ${
              isDark ? 'border-slate-800 bg-slate-950/50' : 'border-l-4 border-slate-200 border-l-[#EE6FA8] bg-white'
            }`}
          >
            <div className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${
              isDark ? sectionTone.header : sectionTone.header
            }`}>
              <div className="flex min-w-0 items-center gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${sectionTone.circle}`}>
                  {sectionIndex + 1}
                </span>
                <div className="min-w-0">
                  <h4 className={`truncate text-base font-bold ${sectionTone.text}`}>
                    {section.title}
                  </h4>
                  {subquestionCount > 0 && (
                    <p className={isDark ? 'mt-0.5 text-[11px] text-slate-400' : 'mt-0.5 text-[11px] text-slate-500'}>
                      {pluralizePt(subquestionCount, 'subpergunta', 'subperguntas')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div className={isDark ? 'hidden h-2 w-28 rounded-full bg-slate-800 md:block' : 'hidden h-2 w-28 rounded-full bg-slate-100 md:block'}>
                  <div className={`h-full rounded-full ${sectionTone.progress}`} style={{ width: `${sectionPercent}%` }} />
                </div>
                <span className={`text-xs font-bold ${sectionTone.text}`}>
                  {pluralizePt(tree.length, 'pergunta', 'perguntas')}
                </span>
              </div>
            </div>
            <div className="min-w-0 space-y-3 p-4">
              {tree.map(node => renderQuestionNode(node, 0, section.title, sectionTone))}
              {canManage && onPrepareAddQuestion && (
                <button
                  type="button"
                  onClick={() => onPrepareAddQuestion({ sectionTitle: section.title })}
                  className={`flex w-full items-center justify-start rounded-lg border border-dashed px-3 py-2 text-xs font-semibold ${
                    isDark
                      ? 'border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300'
                      : 'border-pink-200 bg-pink-50/30 text-[#993556] hover:bg-pink-50'
                  }`}
                >
                  + Adicionar pergunta
                </button>
              )}
            </div>
          </section>
        );
      })}
      {canManage && onPrepareAddQuestion && (
        <button
          type="button"
          onClick={() => onPrepareAddQuestion({ sectionTitle: '' })}
          className={`flex w-full items-center justify-center rounded-lg border border-dashed px-3 py-3 text-xs font-semibold ${
            isDark
              ? 'border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300'
              : 'border-pink-200 bg-pink-50/40 text-[#993556] hover:bg-pink-50'
          }`}
        >
          + Adicionar seção
        </button>
      )}
    </div>
  );
}

function formatFormAnswer(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  return String(value);
}

function getCandidateScore(candidate: Candidate) {
  return candidate.latestApplication?.recruitmentScore ?? candidate.recruitmentScore ?? null;
}

function getCandidateScoreValue(candidate: Candidate) {
  return getCandidateScore(candidate)?.percentage ?? null;
}

function EligibilityBadge({ candidate }: { candidate: Candidate }) {
  const score = getCandidateScore(candidate);
  const status = candidate.latestApplication?.eligibilityStatus ?? candidate.eligibilityStatus ?? score?.status;
  if (status === 'not_eligible') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
        <AlertTriangle className="h-3 w-3" /> Não atende requisito mínimo
      </span>
    );
  }
  if (score && status === 'eligible') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
        {score.percentage}/100
      </span>
    );
  }
  return null;
}

function getOpeningScoringSummary(opening: JobOpening) {
  const snapshot = opening.recruitmentScoring ?? null;
  const questionWeights = Object.values(snapshot?.questionWeights ?? {});
  const scoredCount = questionWeights.filter(item => item.finalWeight > 0).length;
  const eliminatoryCount = (opening.formQuestions ?? []).filter(question =>
    question.eliminatory || question.scoring?.use === 'eliminatory'
  ).length;
  const preset = snapshot?.preset ?? opening.compositionPreset ?? 'role_100';
  const categoryEntries = Object.entries(snapshot?.categoryTotals ?? {})
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .sort(([, a], [, b]) => Number(b) - Number(a));

  return {
    presetLabel: RECRUITMENT_COMPOSITION_PRESETS[preset]?.label ?? 'Cargo 100%',
    scoredCount,
    eliminatoryCount,
    alertCount: snapshot?.alerts?.length ?? 0,
    blockingAlertCount: snapshot?.alerts?.filter(alert => alert.severity === 'blocking').length ?? 0,
    categoryEntries,
  };
}

function candidateMatchesEligibility(candidate: Candidate, filter: CandidateEligibilityFilter) {
  if (!filter) return true;
  const score = getCandidateScore(candidate);
  const status = candidate.latestApplication?.eligibilityStatus ?? candidate.eligibilityStatus ?? score?.status;
  if (filter === 'eligible') return status === 'eligible';
  if (filter === 'not_eligible') return status === 'not_eligible';
  return !!score;
}

function sortCandidatesByMode(candidates: Candidate[], sortMode: CandidateSortMode) {
  return [...candidates].sort((a, b) => {
    if (sortMode === 'score_desc' || sortMode === 'score_asc') {
      const scoreA = getCandidateScoreValue(a) ?? -1;
      const scoreB = getCandidateScoreValue(b) ?? -1;
      return sortMode === 'score_desc' ? scoreB - scoreA : scoreA - scoreB;
    }
    if (sortMode === 'name') {
      return a.name.localeCompare(b.name, 'pt-BR');
    }
    return new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime();
  });
}

function ResumeInput({ value, onChange }: { value: File | null; onChange: (f: File | null) => void }) {
  return value ? (
    <div className="flex items-center gap-2 p-2.5 bg-slate-900 border border-indigo-500/30 rounded-xl">
      <Paperclip className="h-4 w-4 text-indigo-400 flex-shrink-0" />
      <span className="text-sm text-slate-300 truncate flex-1">{value.name}</span>
      <button type="button" onClick={() => onChange(null)} className="text-slate-500 hover:text-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  ) : (
    <label className="flex items-center gap-2 p-2.5 bg-slate-900 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700 transition-colors">
      <Paperclip className="h-4 w-4 text-slate-500" />
      <span className="text-sm text-slate-500">Anexar currículo (PDF, DOC)</span>
      <input
        type="file" accept=".pdf,.doc,.docx" className="hidden"
        onChange={e => onChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

// ─── NewCandidateModal ────────────────────────────────────────────────────────

function NewCandidateModal({ roles, openings, getToken, onClose, onCreated }: {
  roles: JobRole[];
  openings: JobOpening[];
  getToken: () => Promise<string>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', jobRoleId: '', jobOpeningId: '', source: '', notes: '',
  });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));

  // When opening is selected, auto-fill the jobRole
  const handleOpeningChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const openingId = e.target.value;
    const opening = openings.find(o => o.id === openingId);
    setForm(prev => ({
      ...prev,
      jobOpeningId: openingId,
      jobRoleId: opening?.jobRoleId ?? prev.jobRoleId,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.jobRoleId) {
      setError('Nome, e-mail e cargo são obrigatórios.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let resumeUrl: string | undefined;
      let resumePath: string | undefined;
      if (resumeFile) {
        const uploaded = await uploadResume(resumeFile, getToken);
        resumeUrl = uploaded.url;
        resumePath = uploaded.path;
      }

      const role = roles.find(r => r.id === form.jobRoleId);
      await apiFetch('/api/hr/candidates', getToken, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          jobRoleId: form.jobRoleId,
          jobRoleName: role?.name,
          jobOpeningId: form.jobOpeningId || undefined,
          source: form.source || undefined,
          notes: form.notes.trim() || undefined,
          resumeUrl,
          resumePath,
          status: 'applied',
          rating: 0,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const activeOpenings = openings.filter(o => o.status === 'open');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <h2 className="text-lg font-bold text-white">Novo Candidato</h2>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3 p-4">
          {activeOpenings.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Vaga (opcional)</label>
              <select value={form.jobOpeningId} onChange={handleOpeningChange}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Sem vaga vinculada</option>
                {activeOpenings.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Nome *</label>
              <input type="text" value={form.name} onChange={set('name')} required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                placeholder="Nome completo" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">E-mail *</label>
              <input type="email" value={form.email} onChange={set('email')} required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                placeholder="email@exemplo.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Telefone</label>
              <input type="tel" value={form.phone} onChange={set('phone')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                placeholder="(11) 9 0000-0000" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Cargo *</label>
              <select value={form.jobRoleId} onChange={set('jobRoleId')} required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Selecione</option>
                {roles.filter(r => r.isActive !== false).map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Origem</label>
              <select value={form.source} onChange={set('source')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Não informado</option>
                {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Currículo</label>
              <ResumeInput value={resumeFile} onChange={setResumeFile} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Observações</label>
              <textarea value={form.notes} onChange={set('notes')} rows={2}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm resize-none"
                placeholder="Anotações iniciais…" />
            </div>
          </div>
          {error && <ErrorLine msg={error} />}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-xl hover:bg-slate-800">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-medium text-sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {saving ? 'Salvando…' : 'Adicionar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── CandidateDetailPanel ─────────────────────────────────────────────────────

function CandidateDetailPanel({ candidate, roles, openings, units, getToken, canManage, onClose, onUpdated, onDeleted }: {
  candidate: Candidate;
  roles: JobRole[];
  openings: JobOpening[];
  units: DPUnit[];
  getToken: () => Promise<string>;
  canManage: boolean;
  onClose: () => void;
  onUpdated: (c: Candidate) => void;
  onDeleted: (id: string) => void;
}) {
  const [form, setForm] = useState({
    name: candidate.name,
    email: candidate.email,
    phone: candidate.phone ?? '',
    notes: candidate.notes ?? '',
    status: candidate.status,
    rating: candidate.rating ?? 0,
    source: candidate.source ?? '',
  });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<CandidateStatus | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<CandidateProfilePayload | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [employerUnitId, setEmployerUnitId] = useState(candidate.employerUnitId ?? '');
  const employerUnits = useMemo(
    () => units
      .filter(unit => unit.isArchived !== true && CnpjValidator.validate(unit.cnpj ?? '').valid)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [units],
  );

  useEffect(() => {
    let alive = true;
    setProfileLoading(true);
    setProfileError(null);
    apiFetch(`/api/hr/candidates/${candidate.id}/profile`, getToken)
      .then((payload: CandidateProfilePayload) => {
        if (alive) setProfile(payload);
      })
      .catch((err) => {
        if (alive) setProfileError(err instanceof Error ? err.message : 'Falha ao carregar perfil completo.');
      })
      .finally(() => {
        if (alive) setProfileLoading(false);
      });
    return () => { alive = false; };
  }, [candidate.id, getToken]);

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      let resumeUrl = candidate.resumeUrl;
      let resumePath = candidate.resumePath;
      if (resumeFile) {
        const uploaded = await uploadResume(resumeFile, getToken);
        resumeUrl = uploaded.url;
        resumePath = uploaded.path;
      }

      const patch = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
        status: form.status,
        ...(form.status !== candidate.status ? { decisionAction: 'status_changed' as CandidateDecisionAction } : {}),
        rating: form.rating,
        source: form.source || null,
        ...(resumeUrl !== candidate.resumeUrl ? { resumeUrl } : {}),
        ...(resumePath !== candidate.resumePath ? { resumePath } : {}),
      };
      await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onUpdated({
        ...candidate, ...form,
        phone: form.phone || undefined,
        notes: form.notes || undefined,
        source: form.source || undefined,
        resumeUrl: resumeUrl ?? undefined,
        resumePath: resumePath ?? undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, { method: 'DELETE' });
      onDeleted(candidate.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleStatusAction = async (status: CandidateStatus, decisionAction: CandidateDecisionAction) => {
    if (status === 'hired' && !employerUnitId) {
      setError('Selecione o CNPJ responsável pela contratação antes de aprovar.');
      return;
    }
    setStatusAction(status);
    setError(null);
    const now = new Date().toISOString();
    try {
      const result = await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          decisionAction,
          ...(status === 'hired' ? { employerUnitId } : {}),
        }),
      });
      const onboardingId = typeof result?.onboardingId === 'string' ? result.onboardingId : candidate.onboardingId;
      const historyEntry = createCandidateStageHistoryEntry({
        fromStatus: candidate.status,
        toStatus: status,
        action: decisionAction,
        actorId: null,
        actorEmail: null,
        createdAt: now,
      });
      const updated = {
        ...candidate,
        status,
        onboardingId,
        hiredAt: status === 'hired' ? candidate.hiredAt ?? now : candidate.hiredAt,
        updatedAt: now,
        recruitmentHistory: [...(candidate.recruitmentHistory ?? []), historyEntry],
        latestApplication: candidate.latestApplication
          ? {
              ...candidate.latestApplication,
              stage: status,
              onboardingId,
              stageHistory: [...(candidate.latestApplication.stageHistory ?? []), historyEntry],
            }
          : candidate.latestApplication,
      };
      setForm(prev => ({ ...prev, status }));
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar etapa.');
    } finally {
      setStatusAction(null);
    }
  };

  const role = roles.find(r => r.id === candidate.jobRoleId);
  const opening = openings.find(o => o.id === candidate.jobOpeningId);
  const recruitmentScore = getCandidateScore(candidate);
  const formAnswers = candidate.latestApplication?.formAnswers ?? candidate.formAnswers ?? {};
  const questionSnapshot = candidate.latestApplication?.formQuestionSnapshot ?? candidate.formQuestionSnapshot ?? opening?.formQuestions ?? role?.formQuestions ?? [];
  const questionsById = new Map((questionSnapshot as HrFormQuestion[]).map(question => [question.id, question]));
  const answerEntries = Object.entries(formAnswers);
  const answeredQuestionSections = groupRecruitmentQuestionsBySection(
    (questionSnapshot as HrFormQuestion[]).filter(question => Object.prototype.hasOwnProperty.call(formAnswers, question.id)),
    'Respostas do formulário'
  );
  const answerEntriesWithoutQuestion = answerEntries.filter(([questionId]) => !questionsById.has(questionId));
  const stageHistory = (
    candidate.latestApplication?.stageHistory?.length
      ? candidate.latestApplication.stageHistory
      : candidate.recruitmentHistory ?? []
  )
    .filter((entry): entry is CandidateStageHistoryEntry => !!entry && !!entry.createdAt)
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const profileApplications = profile?.applications ?? [];
  const profileOnboarding = profile?.onboardingProcesses ?? [];
  const hasChanges =
    form.name !== candidate.name || form.email !== candidate.email ||
    form.phone !== (candidate.phone ?? '') || form.notes !== (candidate.notes ?? '') ||
    form.status !== candidate.status || form.rating !== (candidate.rating ?? 0) ||
    form.source !== (candidate.source ?? '') || !!resumeFile;

  const currentResume = resumeFile ? null : candidate.resumeUrl;
  const nextPipelineStatus = PIPELINE_STATUSES.includes(form.status)
    ? PIPELINE_STATUSES[PIPELINE_STATUSES.indexOf(form.status) + 1] ?? null
    : 'applied';
  const hasPipelineNext = nextPipelineStatus && nextPipelineStatus !== form.status;
  const renderAnswerNode = (node: ReturnType<typeof buildRecruitmentQuestionTree>[number]): React.ReactNode => (
    <div key={node.question.id} className="space-y-2">
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p className="text-xs font-medium text-slate-400">{node.question.text}</p>
        <p className="mt-1 text-sm text-slate-200">{formatFormAnswer(formAnswers[node.question.id])}</p>
      </div>
      {node.subquestions.length > 0 ? (
        <div className="ml-3 space-y-2 border-l-2 border-slate-800 pl-3">
          {node.subquestions.map(renderAnswerNode)}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md h-full bg-slate-950 border-l border-slate-800 flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">
              {role?.name ?? candidate.jobRoleName ?? '—'}
              {opening && <span className="text-indigo-400"> · {opening.title}</span>}
            </p>
            <h2 className="text-lg font-bold text-white truncate">{candidate.name}</h2>
            <p className="text-sm text-slate-500 truncate mt-0.5">{candidate.email}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800 flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {canManage && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Decisão do processo</p>
                  <p className="mt-0.5 text-sm font-semibold text-white">{STATUS_CONFIG[form.status].label}</p>
                </div>
                <StatusBadge status={form.status} />
              </div>
              {form.status !== 'hired' ? (
                <label className="mb-3 block text-xs font-bold text-slate-300">
                  CNPJ responsável pela contratação <span className="text-rose-400">*</span>
                  <select
                    value={employerUnitId}
                    onChange={event => setEmployerUnitId(event.target.value)}
                    disabled={!!statusAction}
                    className="mt-1.5 h-10 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white outline-none focus:border-emerald-500"
                  >
                    <option value="">Selecione a empresa responsável</option>
                    {employerUnits.map(unit => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name} · {CnpjValidator.format(unit.cnpj ?? '')}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block font-medium leading-snug text-slate-500">
                    Este CNPJ será gravado no processo e usado na guia do ASO e nos documentos da admissão.
                  </span>
                </label>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {hasPipelineNext && nextPipelineStatus && (
                  <button
                    type="button"
                    onClick={() => handleStatusAction(nextPipelineStatus, 'advanced')}
                    disabled={!!statusAction}
                    className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {statusAction === nextPipelineStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                    Avançar para {STATUS_CONFIG[nextPipelineStatus].label}
                  </button>
                )}
                {form.status !== 'hired' && (
                  <button
                    type="button"
                    onClick={() => handleStatusAction('hired', 'hired')}
                    disabled={!!statusAction}
                    className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/15 disabled:opacity-50"
                  >
                    {statusAction === 'hired' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Aprovar contratação
                  </button>
                )}
                {form.status !== TALENT_POOL_STATUS && (
                  <button
                    type="button"
                    onClick={() => handleStatusAction(TALENT_POOL_STATUS, 'talent_pool')}
                    disabled={!!statusAction}
                    className="flex items-center justify-center gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/15 disabled:opacity-50"
                  >
                    {statusAction === TALENT_POOL_STATUS ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5" />}
                    Banco de talentos
                  </button>
                )}
                {form.status !== 'rejected' && (
                  <button
                    type="button"
                    onClick={() => handleStatusAction('rejected', 'rejected')}
                    disabled={!!statusAction}
                    className="flex items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300 transition hover:bg-red-500/15 disabled:opacity-50"
                  >
                    {statusAction === 'rejected' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                    Reprovar
                  </button>
                )}
                {form.status !== 'withdrawn' && (
                  <button
                    type="button"
                    onClick={() => handleStatusAction('withdrawn', 'withdrawn')}
                    disabled={!!statusAction}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {statusAction === 'withdrawn' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                    Desistência
                  </button>
                )}
              </div>
            </div>
          )}

          {recruitmentScore && (
            <div className={`rounded-2xl border p-4 ${
              recruitmentScore.status === 'not_eligible'
                ? 'border-red-500/20 bg-red-500/10'
                : 'border-emerald-500/20 bg-emerald-500/10'
            }`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Triagem automática</p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {recruitmentScore.status === 'not_eligible' ? 'Não atende requisito mínimo' : 'Elegível para ranking'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-white">{recruitmentScore.percentage}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">/100</p>
                </div>
              </div>
              {recruitmentScore.failedEliminatory.length > 0 && (
                <div className="mt-3 space-y-1">
                  {recruitmentScore.failedEliminatory.slice(0, 3).map(item => (
                    <p key={item.questionId} className="text-xs text-red-200">
                      {item.label}: {formatFormAnswer(item.answer)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Status</label>
              {canManage ? (
                <select value={form.status}
                  onChange={e => setForm(prev => ({ ...prev, status: e.target.value as CandidateStatus }))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
                </select>
              ) : (
                <div className="mt-1"><StatusBadge status={form.status} /></div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Avaliação</label>
              <div className="py-2.5">
                <RatingStars value={form.rating}
                  onChange={canManage ? v => setForm(p => ({ ...p, rating: v })) : undefined}
                  readonly={!canManage} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Nome</label>
              <input type="text" value={form.name} onChange={set('name')} disabled={!canManage}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm disabled:opacity-60" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Telefone</label>
              <input type="tel" value={form.phone} onChange={set('phone')} disabled={!canManage}
                placeholder="—"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm disabled:opacity-60" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">E-mail</label>
            <input type="email" value={form.email} onChange={set('email')} disabled={!canManage}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm disabled:opacity-60" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Origem</label>
            {canManage ? (
              <select value={form.source} onChange={set('source')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Não informado</option>
                {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <p className="text-sm text-slate-300">{candidate.source || '—'}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Currículo</label>
            {canManage ? (
              <div className="space-y-2">
                {currentResume && !resumeFile && (
                  <a href={currentResume} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300">
                    <ExternalLink className="h-3.5 w-3.5" /> Ver currículo atual
                  </a>
                )}
                <ResumeInput value={resumeFile} onChange={setResumeFile} />
              </div>
            ) : currentResume ? (
              <a href={currentResume} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300">
                <ExternalLink className="h-3.5 w-3.5" /> Ver currículo
              </a>
            ) : (
              <p className="text-sm text-slate-500">—</p>
            )}
          </div>

          {(candidate.talentPool?.rolePreference || candidate.talentPool?.unitPreference || candidate.talentPool?.formVersion) && (
            <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4">
              <h3 className="text-xs font-bold text-cyan-200 uppercase tracking-wider">Banco de talentos</h3>
              <div className="mt-3 grid gap-3 text-sm">
                {candidate.talentPool?.rolePreference && (
                  <div>
                    <p className="text-xs font-medium text-slate-500">Cargo de interesse</p>
                    <p className="mt-0.5 text-slate-200">{candidate.talentPool.rolePreference}</p>
                  </div>
                )}
                {candidate.talentPool?.unitPreference && (
                  <div>
                    <p className="text-xs font-medium text-slate-500">Unidade preferida</p>
                    <p className="mt-0.5 text-slate-200">{candidate.talentPool.unitPreference}</p>
                  </div>
                )}
                {candidate.talentPool?.formVersion && (
                  <p className="text-xs text-slate-600">Formulário v{candidate.talentPool.formVersion}</p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-800 bg-slate-900/45 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Perfil completo</h3>
                <p className="mt-0.5 text-xs text-slate-600">Histórico consolidado do recrutamento e integração.</p>
              </div>
              {profileLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            </div>
            {profileError ? <ErrorLine msg={profileError} /> : null}
            {!profileLoading && !profileError && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Inscrições</p>
                    <p className="mt-1 text-xl font-bold text-white">{profileApplications.length}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Integração</p>
                    <p className="mt-1 text-xl font-bold text-white">{profileOnboarding.length}</p>
                  </div>
                </div>

                {profileApplications.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Histórico de vagas</p>
                    {profileApplications.slice(0, 5).map(application => {
                      const stage = application.stage && STATUS_CONFIG[application.stage] ? application.stage : null;
                      const title = [
                        application.jobRoleName,
                        application.functionName,
                      ].filter(Boolean).join(' | ') || 'Vaga sem cargo informado';
                      return (
                        <div key={application.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-100">{title}</p>
                              <p className="mt-0.5 truncate text-xs text-slate-500">{application.unitName || application.source || 'Origem não informada'}</p>
                            </div>
                            {stage ? <StatusBadge status={stage} /> : null}
                          </div>
                          {application.notes ? <p className="mt-2 text-xs text-slate-400">{application.notes}</p> : null}
                          <p className="mt-2 text-[10px] font-medium text-slate-600">
                            {application.appliedAt
                              ? new Date(application.appliedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
                              : 'Data não informada'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {profileOnboarding.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Integração vinculada</p>
                    {profileOnboarding.slice(0, 3).map(process => (
                      <div key={process.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-100">
                              {process.jobRoleName ?? 'Cargo não informado'}
                              {process.functionName ? ` | ${process.functionName}` : ''}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">{ONBOARDING_STATUS_LABELS[process.status] ?? process.status}</p>
                          </div>
                          {process.publicToken ? (
                            <a
                              href={`${PUBLIC_RECRUITMENT_URL}/onboarding/${process.publicToken}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-300 hover:bg-slate-800"
                            >
                              <ExternalLink className="h-3 w-3" /> Público
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {profileApplications.length === 0 && profileOnboarding.length === 0 && (
                  <p className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-sm text-slate-500">
                    Nenhum histórico adicional encontrado para este candidato.
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Observações</label>
            <textarea value={form.notes} onChange={set('notes')} disabled={!canManage} rows={4}
              placeholder={canManage ? 'Anotações sobre o candidato…' : '—'}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm resize-none disabled:opacity-60" />
          </div>

          {stageHistory.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Histórico do processo</h3>
              <div className="space-y-2">
                {stageHistory.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-100">
                          {DECISION_ACTION_LABELS[entry.action] ?? 'Movimentação'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {entry.fromStatus ? STATUS_CONFIG[entry.fromStatus]?.label ?? entry.fromStatus : 'Início'}
                          {' → '}
                          {STATUS_CONFIG[entry.toStatus]?.label ?? entry.toStatus}
                        </p>
                        {entry.note && <p className="mt-1 text-xs text-slate-400">{entry.note}</p>}
                      </div>
                      <span className="shrink-0 text-[10px] font-medium text-slate-600">
                        {new Date(entry.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {answerEntries.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Respostas do formulário</h3>
              <div className="space-y-2">
                {answeredQuestionSections.map(section => (
                  <div key={section.id} className="space-y-2">
                    {answeredQuestionSections.length > 1 || !section.isFallback ? (
                      <p className="pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                        {section.title}
                      </p>
                    ) : null}
                    {buildRecruitmentQuestionTree(section.questions).map(renderAnswerNode)}
                  </div>
                ))}
                {answerEntriesWithoutQuestion.map(([questionId, answer]) => (
                  <div key={questionId} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                    <p className="text-xs font-medium text-slate-400">Pergunta removida</p>
                    <p className="mt-1 text-sm text-slate-200">{formatFormAnswer(answer)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-xs text-slate-600 space-y-0.5">
            <p>Inscrito em {new Date(candidate.appliedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
            <p>Atualizado em {new Date(candidate.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
          </div>

          {error && <ErrorLine msg={error} />}
        </div>

        {canManage && (
          <div className="p-4 border-t border-slate-800">
            {confirmDelete ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 space-y-3">
                <p className="text-sm text-red-400 font-medium">Confirmar exclusão?</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)}
                    className="flex-1 px-3 py-2 text-xs text-slate-400 hover:text-white border border-slate-700 rounded-lg">
                    Cancelar
                  </button>
                  <button onClick={handleDelete} disabled={deleting}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
                    {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    Excluir
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(true)}
                  className="p-2 text-slate-600 hover:text-red-400 rounded-lg hover:bg-red-500/10">
                  <Trash2 className="h-4 w-4" />
                </button>
                <button onClick={handleSave} disabled={saving || !hasChanges}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl font-medium text-sm">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {saving ? 'Salvando…' : 'Salvar alterações'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Kanban DnD ───────────────────────────────────────────────────────────────

function CandidateInitials({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase();
  const colors = [
    'bg-indigo-500', 'bg-purple-500', 'bg-pink-500', 'bg-blue-500',
    'bg-teal-500', 'bg-orange-500', 'bg-green-500', 'bg-rose-500',
  ];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className={`h-7 w-7 rounded-full ${color} flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-white flex-shrink-0`}>
      {initials}
    </div>
  );
}

const SOURCE_TAG_COLORS: Record<string, string> = {
  LinkedIn:    'bg-white/75 text-blue-700 border-blue-100',
  Indicação:   'bg-white/75 text-green-700 border-green-100',
  Site:        'bg-white/75 text-violet-700 border-violet-100',
  Indeed:      'bg-white/75 text-orange-700 border-orange-100',
  Catho:       'bg-white/75 text-yellow-700 border-yellow-100',
  Espontâneo:  'bg-white/75 text-slate-600 border-slate-200',
  Outro:       'bg-white/75 text-slate-600 border-slate-200',
  site:        'bg-white/75 text-violet-700 border-violet-100',
};

function DraggableCard({ candidate, stage, onOpen }: { candidate: Candidate; stage?: RecruitmentStage; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: candidate.id,
    data: { candidate },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.35 : 1,
  };

  const sourceColor = candidate.source
    ? (SOURCE_TAG_COLORS[candidate.source] ?? SOURCE_TAG_COLORS['Outro'])
    : null;

  const isNew = (Date.now() - new Date(candidate.appliedAt).getTime()) < 7 * 86_400_000;
  const timing = getCandidateStageTiming(candidate, stage);
  const statusCfg = STATUS_CONFIG[candidate.status];
  const score = getCandidateScore(candidate);

  return (
    <div
      ref={setNodeRef} style={style} {...attributes}
      className={`group relative overflow-hidden rounded-[10px] border border-slate-200 bg-white p-3 text-slate-900 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:shadow-md ${isDragging ? 'ring-2 ring-indigo-200' : ''}`}
    >
      <span className={`absolute inset-x-0 top-0 h-0.5 ${statusCfg.color}`} />
      <button onClick={onOpen} className="w-full text-left">
        <div className="mb-3 flex items-start gap-2.5">
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="mb-2 flex items-center gap-1.5 flex-wrap">
              {sourceColor && candidate.source && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${sourceColor}`}>
                  #{candidate.source}
                </span>
              )}
              {isNew && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-md border border-emerald-100 tracking-wide">
                  NOVO
                </span>
              )}
              <EligibilityBadge candidate={candidate} />
              {stage?.dueDays !== null && stage?.dueDays !== undefined && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border tracking-wide ${
                  timing.isOverdue
                    ? 'border-red-100 bg-red-50 text-red-700'
                    : timing.daysLeft === 0
                      ? 'border-amber-100 bg-amber-50 text-amber-700'
                      : 'border-slate-100 bg-white/75 text-slate-600'
                }`}>
                  {timing.isOverdue
                    ? `${timing.overdueDays}d atraso`
                    : timing.daysLeft === 0
                      ? 'vence hoje'
                      : `${timing.daysLeft}d restantes`}
                </span>
              )}
            </div>
            <h4 className="font-semibold text-sm leading-snug text-slate-950 transition-colors">
              {candidate.name}
            </h4>
            <p className="mt-1 truncate text-[11px] text-slate-500">{candidate.jobRoleName}</p>
          </div>
          <div
            {...listeners}
            onClick={e => e.stopPropagation()}
            className="mt-0.5 flex-shrink-0 cursor-grab p-1 text-slate-300 hover:text-slate-500 active:cursor-grabbing"
          >
            <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
              <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
              <circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/>
              <circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/>
            </svg>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <RatingStars value={candidate.rating ?? 0} readonly />
          {candidate.resumeUrl && (
            <span className="flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
              <Paperclip className="h-2.5 w-2.5" /> CV
            </span>
          )}
        </div>

        {score && score.status === 'eligible' && (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-slate-500">
              <span>Score</span>
              <span>{score.percentage}/100</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.max(0, Math.min(100, score.percentage))}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex -space-x-2">
            <CandidateInitials name={candidate.name} />
          </div>
          <span className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-500">
            <Calendar className="h-2.5 w-2.5" />
            {new Date(candidate.appliedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
          </span>
        </div>
      </button>
    </div>
  );
}

function DroppableColumn({ status, stage, candidates, onCardOpen }: {
  status: CandidateStatus;
  stage?: RecruitmentStage;
  candidates: Candidate[];
  onCardOpen: (c: Candidate) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const cfg = STATUS_CONFIG[status];
  const overdueCount = stage
    ? candidates.filter(candidate => getCandidateStageTiming(candidate, stage).isOverdue).length
    : 0;

  return (
    <div className="flex w-[282px] flex-shrink-0 flex-col rounded-[14px] bg-slate-50/80 p-2 shadow-sm">
      <div className="mb-2 flex items-center gap-2 border-b border-slate-200/80 px-1.5 pb-2.5 pt-1">
        <span className={`h-2 w-2 shrink-0 rounded-full ${cfg.color}`} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-slate-900">{stage?.label ?? cfg.label}</h3>
          <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {stage?.dueDays === null || stage?.dueDays === undefined ? 'Sem prazo' : `${stage.dueDays}d de prazo`}
            {overdueCount > 0 ? ` · ${overdueCount} atrasado${overdueCount !== 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <span className="text-xs font-semibold tabular-nums text-slate-500">{candidates.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex min-h-[420px] flex-col gap-2 rounded-[10px] p-0.5 transition-colors ${
          isOver
            ? 'bg-indigo-50 ring-2 ring-indigo-200'
            : 'bg-transparent'
        }`}
      >
        {candidates.map(c => (
          <DraggableCard key={c.id} candidate={c} stage={stage} onOpen={() => onCardOpen(c)} />
        ))}
        {candidates.length === 0 && (
          <div className={`flex min-h-[120px] flex-1 items-center justify-center rounded-[10px] border border-dashed ${
            isOver ? 'border-indigo-300 bg-indigo-50/70' : 'border-slate-200 bg-white/40'
          }`}>
            <UserPlus className="h-4 w-4 text-slate-400" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ListRowMenu ──────────────────────────────────────────────────────────────

function ListRowMenu({ candidate, onOpen, onDelete }: {
  candidate: Candidate; onOpen: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={e => { e.stopPropagation(); setOpen(p => !p); }}
        className="p-2 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-slate-900 border border-slate-800 rounded-xl shadow-xl z-10 overflow-hidden">
          <button onClick={() => { setOpen(false); onOpen(); }}
            className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white">
            Ver detalhes
          </button>
          <button onClick={() => { setOpen(false); onDelete(); }}
            className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10">
            Excluir
          </button>
        </div>
      )}
    </div>
  );
}

// ─── DeleteConfirmModal ───────────────────────────────────────────────────────

function DeleteConfirmModal({ candidate, getToken, onClose, onDeleted }: {
  candidate: Candidate; getToken: () => Promise<string>; onClose: () => void; onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, { method: 'DELETE' });
      onDeleted(candidate.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir.');
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xs space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-red-500/10 rounded-xl">
            <Trash2 className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h3 className="font-bold text-white text-sm">Excluir candidato</h3>
            <p className="text-xs text-slate-400 mt-0.5">{candidate.name}</p>
          </div>
        </div>
        <p className="text-sm text-slate-400">Esta ação é permanente e não pode ser desfeita.</p>
        {error ? <ErrorLine msg={error} /> : null}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 px-3 py-2 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-xl">
            Cancelar
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {deleting ? 'Excluindo…' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── OpeningModal ─────────────────────────────────────────────────────────────

function OpeningModal({ opening, roles, functions, units, shiftDefinitions, getToken, onClose, onSaved }: {
  opening?: JobOpening;
  roles: JobRole[];
  functions: JobFunction[];
  units: DPUnit[];
  shiftDefinitions: DPShiftDefinition[];
  getToken: () => Promise<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!opening;
  const formId = opening ? `opening-form-${opening.id}` : 'opening-form-new';
  const [form, setForm] = useState({
    title: opening?.title ?? '',
    jobRoleId: opening?.jobRoleId ?? '',
    functionId: opening?.functionId ?? '',
    unitId: opening?.unitId ?? '',
    shiftDefinitionId: opening?.shiftDefinitionId ?? '',
    description: opening?.description ?? '',
    location: opening?.location ?? '',
    workType: opening?.workType ?? '',
    contractTypeLabel: opening?.contractTypeLabel ?? '',
    workSchedule: opening?.workSchedule ?? '',
    slots: String(opening?.slots ?? 1),
    applicationStartAt: opening?.applicationStartAt ? opening.applicationStartAt.split('T')[0] : '',
    applicationEndAt: opening?.applicationEndAt ? opening.applicationEndAt.split('T')[0] : '',
    closesAt: opening?.closesAt ? opening.closesAt.split('T')[0] : '',
    status: opening?.status ?? 'open',
    compositionPreset: (opening?.compositionPreset ?? 'role_70_function_30') as RecruitmentCompositionPreset,
    requirements: (opening?.requirements ?? []).join('\n'),
    benefits: listToText(opening?.benefits),
    salaryLabel: salaryTextFromRange(opening?.publicSalaryRange),
    salaryVisible: opening?.publicSalaryRange?.visible === true,
    applyButtonLabel: opening?.applyButtonLabel ?? PUBLIC_APPLY_BUTTON_LABEL,
    successMessage: opening?.applicationSuccessMessage ?? '',
    lgpdContractText: opening?.lgpdContractText ?? '',
  });
  const [questions, setQuestions] = useState<HrFormQuestion[]>(opening?.formQuestions ?? []);
  const [questionsTouched, setQuestionsTouched] = useState(isEdit);
  const [stages, setStages] = useState<RecruitmentStage[]>(normalizeRecruitmentStages(opening?.pipelineStages));
  const [questionDraft, setQuestionDraft] = useState(EMPTY_QUESTION_DRAFT);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [scoringAlertJustification, setScoringAlertJustification] = useState(
    opening?.recruitmentScoringAlertAcknowledgement?.note ?? ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));

  const selectedRole = roles.find(role => role.id === form.jobRoleId) ?? null;
  const compatibleFunctions = functions.filter(fn => {
    if (fn.isActive === false) return false;
    if (!form.jobRoleId) return true;
    return !fn.compatibleRoleIds?.length || fn.compatibleRoleIds.includes(form.jobRoleId);
  });
  const selectedFunction = compatibleFunctions.find(fn => fn.id === form.functionId) ?? null;
  const selectedUnit = units.find(unit => unit.id === form.unitId) ?? null;
  const availableShiftDefinitions = shiftDefinitions.filter(shift => {
    if (!form.unitId) return true;
    const unitIds = shift.unitIds ?? (shift.unitId ? [shift.unitId] : []);
    return unitIds.length === 0 || unitIds.includes(form.unitId);
  });
  const selectedShiftDefinition = availableShiftDefinitions.find(shift => shift.id === form.shiftDefinitionId) ?? null;
  const rolePublicRequirements = selectedRole?.publicRequirements?.length
    ? selectedRole.publicRequirements
    : selectedRole?.requirements ?? [];
  const functionPublicRequirements = selectedFunction?.publicRequirements?.length
    ? selectedFunction.publicRequirements
    : selectedFunction?.requirements ?? [];
  const inheritedDescriptionParts = [
    selectedRole?.publicDescription || selectedRole?.description,
    selectedFunction?.publicDescription || selectedFunction?.description,
  ].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  const inheritedRequirements = Array.from(new Set([
    ...rolePublicRequirements,
    ...functionPublicRequirements,
  ]));
  const finalRequirements = textToList(form.requirements);
  const finalBenefits = textToList(form.benefits);
  const openingSalaryPreview = formatSalaryRange(salaryRangeFromText(form.salaryLabel, form.salaryVisible));
  const openingButtonText = PUBLIC_APPLY_BUTTON_LABEL;
  const scoringPreview = useMemo(
    () => applyRecruitmentScoring(questions, form.functionId ? form.compositionPreset : 'role_100'),
    [form.compositionPreset, form.functionId, questions]
  );
  const scoringBlockingAlerts = scoringPreview.snapshot.alerts.filter(alert => alert.severity === 'blocking');
  const scoringWarningAlerts = scoringPreview.snapshot.alerts.filter(alert => alert.severity === 'warning');

  const getModelQuestions = (role: JobRole | null, fn: JobFunction | null) =>
    mergeRecruitmentQuestionModels(role?.formQuestions, fn?.formQuestions);

  const reloadModelQuestions = () => {
    setQuestions(getModelQuestions(selectedRole, selectedFunction));
    setQuestionsTouched(false);
    setQuestionError(null);
  };

  const applyDefaults = (role: JobRole | null, fn: JobFunction | null) => {
    const nextTitle = fn?.publicTitle || fn?.name || role?.publicTitle || role?.name || '';
    const descriptions = [
      role?.publicDescription || role?.description,
      fn?.publicDescription || fn?.description,
    ].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    const requirements = [
      ...(role?.publicRequirements?.length ? role.publicRequirements : role?.requirements ?? []),
      ...(fn?.publicRequirements?.length ? fn.publicRequirements : fn?.requirements ?? []),
    ];
    const benefits = Array.from(new Set([
      ...(role?.benefits ?? []),
      ...(fn?.benefits ?? []),
    ]));
    const publicSalaryRange = fn?.publicSalaryRange ?? role?.publicSalaryRange;
    const inheritedWorkSchedule = fn?.workSchedule || role?.workSchedule || '';
    const recruitmentDisplay = {
      ...(role?.recruitmentDisplay ?? {}),
      ...(fn?.recruitmentDisplay ?? {}),
    };
    const displayLocation = recruitmentDisplay.locationLabel?.trim();
    const displayContractType = recruitmentDisplay.contractTypeLabel?.trim();
    const displayButton = recruitmentDisplay.buttonText?.trim();
    const displaySuccessMessage = recruitmentDisplay.successMessage?.trim();
    const displayLgpdContractText = recruitmentDisplay.lgpdContractText?.trim();
    const inheritedQuestions = getModelQuestions(role, fn);
    const inheritedStages = mergeRecruitmentStageModels(role?.pipelineStages, fn?.pipelineStages);

    setForm(prev => {
      const hasSalary = Boolean(prev.salaryLabel.trim());
      return {
        ...prev,
        title: prev.title.trim() || !nextTitle ? prev.title : nextTitle,
        description: prev.description.trim() || descriptions.length === 0 ? prev.description : descriptions.join('\n\n'),
        requirements: prev.requirements.trim() || requirements.length === 0 ? prev.requirements : Array.from(new Set(requirements)).join('\n'),
        benefits: prev.benefits.trim() || benefits.length === 0 ? prev.benefits : benefits.join('\n'),
        location: prev.location.trim() || !displayLocation ? prev.location : displayLocation,
        workType: prev.workType || recruitmentDisplay.workType || '',
        contractTypeLabel: prev.contractTypeLabel.trim() || !displayContractType ? prev.contractTypeLabel : displayContractType,
        workSchedule: prev.workSchedule.trim() || !inheritedWorkSchedule ? prev.workSchedule : inheritedWorkSchedule,
        salaryLabel: hasSalary || !publicSalaryRange ? prev.salaryLabel : salaryTextFromRange(publicSalaryRange),
        salaryVisible: hasSalary || publicSalaryRange === undefined ? prev.salaryVisible : publicSalaryRange.visible === true,
        applyButtonLabel: prev.applyButtonLabel.trim() || !displayButton ? prev.applyButtonLabel : displayButton,
        successMessage: prev.successMessage.trim() || !displaySuccessMessage ? prev.successMessage : displaySuccessMessage,
        lgpdContractText: prev.lgpdContractText.trim() || !displayLgpdContractText ? prev.lgpdContractText : displayLgpdContractText,
      };
    });
    setQuestions(prev => questionsTouched ? prev : inheritedQuestions);
    setStages(inheritedStages);
  };

  const handleRoleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const jobRoleId = event.target.value;
    const role = roles.find(item => item.id === jobRoleId) ?? null;
    const currentFunction = functions.find(item => item.id === form.functionId) ?? null;
    const functionStillCompatible = currentFunction && (
      !currentFunction.compatibleRoleIds?.length || currentFunction.compatibleRoleIds.includes(jobRoleId)
    );
    setForm(prev => ({ ...prev, jobRoleId, functionId: functionStillCompatible ? prev.functionId : '' }));
    applyDefaults(role, functionStillCompatible ? currentFunction : null);
  };

  const handleFunctionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const functionId = event.target.value;
    const fn = functions.find(item => item.id === functionId) ?? null;
    setForm(prev => ({ ...prev, functionId }));
    applyDefaults(selectedRole, fn);
  };

  const handleUnitChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const unitId = event.target.value;
    const unit = units.find(item => item.id === unitId) ?? null;
    setForm(prev => ({
      ...prev,
      unitId,
      shiftDefinitionId: '',
      location: prev.location.trim() || !unit?.name ? prev.location : unit.name,
    }));
  };

  const updateQuestion = (questionId: string, patch: Partial<HrFormQuestion>) => {
    setQuestionsTouched(true);
    setQuestions(prev => prev.map(question => question.id === questionId ? { ...question, ...patch } : question));
  };

  const updateQuestionOptions = (questionId: string, optionsText: string) => {
    setQuestionsTouched(true);
    const options = optionsText
      .split('\n')
      .map(option => option.trim())
      .filter(Boolean);
    setQuestions(prev => prev.map(question => {
      if (question.id !== questionId) return question;
      return {
        ...question,
        config: {
          ...(question.config ?? {}),
          options,
        },
      };
    }));
  };

  const moveQuestion = (questionId: string, direction: -1 | 1) => {
    setQuestionsTouched(true);
    setQuestions(prev => {
      const index = prev.findIndex(question => question.id === questionId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const updateStage = (stageId: CandidateStatus, patch: Partial<RecruitmentStage>) => {
    setStages(prev => prev.map(stage => stage.id === stageId ? { ...stage, ...patch } : stage));
  };

  const moveStage = (stageId: CandidateStatus, direction: -1 | 1) => {
    setStages(prev => {
      const index = prev.findIndex(stage => stage.id === stageId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next.map((stage, stageIndex) => ({ ...stage, order: stageIndex }));
    });
  };

  const addQuestion = () => {
    const text = questionDraft.text.trim();
    if (!text) {
      setQuestionError('Informe o texto da pergunta.');
      return;
    }

    const options = questionDraft.optionsText
      .split('\n')
      .map(option => option.trim())
      .filter(Boolean);
    if ((questionDraft.type === 'select' || questionDraft.type === 'multi_select') && options.length === 0) {
      setQuestionError('Informe ao menos uma opção para esta pergunta.');
      return;
    }

    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `question-${Date.now()}`;
    const parentQuestion = questions.find(question => question.id === questionDraft.parentQuestionId);
    const conditions = conditionFromDraft(parentQuestion, questionDraft.conditionValue);
    setQuestions(prev => [
      ...prev,
      {
        id,
        text,
        type: questionDraft.type,
        ...questionSectionFromDraft(questionDraft.sectionTitle),
        parentQuestionId: questionDraft.parentQuestionId || undefined,
        ...(conditions ? { conditions } : {}),
        required: questionDraft.required,
        ...questionScoringFromDraft(questionDraft, 'role'),
        tags: ['opening'],
        config: options.length > 0 ? { options } : undefined,
      },
    ]);
    setQuestionsTouched(true);
    setQuestionDraft(EMPTY_QUESTION_DRAFT);
    setQuestionError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.jobRoleId) {
      setError('Título e cargo são obrigatórios.');
      return;
    }
    if (form.applicationStartAt && form.applicationEndAt && form.applicationEndAt < form.applicationStartAt) {
      setError('A data final de inscrição precisa ser posterior à data inicial.');
      return;
    }
    if (scoringBlockingAlerts.length > 0) {
      setError(`Revise a pontuação do formulário: ${scoringBlockingAlerts[0].message}`);
      return;
    }
    if (scoringWarningAlerts.length > 0 && !scoringAlertJustification.trim()) {
      setError('Justifique os alertas de pontuação antes de salvar.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: form.title.trim(),
        jobRoleId: form.jobRoleId,
        functionId: form.functionId || null,
        functionName: selectedFunction?.name ?? null,
        unitId: form.unitId || null,
        unitName: selectedUnit?.name ?? null,
        shiftDefinitionId: form.shiftDefinitionId || null,
        shiftDefinitionName: selectedShiftDefinition?.name ?? null,
        description: form.description.trim() || null,
        location: form.location.trim() || null,
        workType: form.workType || null,
        contractTypeLabel: form.contractTypeLabel.trim() || null,
        workSchedule: form.workSchedule.trim() || null,
        slots: Number(form.slots) || 1,
        applicationStartAt: dateInputToIso(form.applicationStartAt),
        applicationEndAt: dateInputToIso(form.applicationEndAt, true),
        closesAt: dateInputToIso(form.closesAt, true),
        status: form.status,
        compositionPreset: form.compositionPreset,
        scoringAlertJustification: scoringWarningAlerts.length > 0 ? scoringAlertJustification.trim() : '',
        requirements: form.requirements.split('\n').map(s => s.trim()).filter(Boolean),
        benefits: finalBenefits,
        publicSalaryRange: salaryRangeFromText(form.salaryLabel, form.salaryVisible),
        applyButtonLabel: openingButtonText,
        applicationSuccessMessage: form.successMessage.trim() || null,
        lgpdContractText: form.lgpdContractText.trim() || null,
        formQuestions: questions,
        pipelineStages: stages.map((stage, index) => ({ ...stage, order: index })),
      };
      if (isEdit) {
        await apiFetch(`/api/hr/openings/${opening!.id}`, getToken, {
          method: 'PATCH', body: JSON.stringify(body),
        });
      } else {
        await apiFetch('/api/hr/openings', getToken, {
          method: 'POST', body: JSON.stringify(body),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[82vh] w-full max-w-lg flex-col rounded-xl border border-slate-800 bg-slate-950 shadow-2xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-800 p-4">
          <h2 className="text-lg font-bold text-white">{isEdit ? 'Editar vaga' : 'Criar vaga'}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form id={formId} onSubmit={handleSubmit} className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Título da vaga *</label>
              <input type="text" value={form.title} onChange={set('title')} required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                placeholder="Ex: Gerente de Produção – Unidade SP" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Cargo *</label>
              <select value={form.jobRoleId} onChange={handleRoleChange} required
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Selecione</option>
                {roles.filter(r => r.isActive !== false).map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Função</label>
              <select value={form.functionId} onChange={handleFunctionChange}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Sem função específica</option>
                {compatibleFunctions.map(fn => (
                  <option key={fn.id} value={fn.id}>{fn.name}</option>
                ))}
              </select>
            </div>
            {(selectedRole || selectedFunction) && (
              <details className="group col-span-2 rounded-xl border border-slate-800 bg-slate-900/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Texto herdado dos modelos</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Cargo{selectedFunction ? ' + função' : ''} alimentam a vaga; revise o texto final abaixo.
                    </p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" />
                </summary>
                <div className="grid gap-3 border-t border-slate-800 p-4 md:grid-cols-2">
                  {selectedRole && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Cargo</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">{selectedRole.publicTitle || selectedRole.name}</p>
                      <p className="mt-2 line-clamp-3 text-xs text-slate-500">{selectedRole.publicDescription || selectedRole.description || 'Sem descrição pública.'}</p>
                    </div>
                  )}
                  {selectedFunction && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Função</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">{selectedFunction.publicTitle || selectedFunction.name}</p>
                      <p className="mt-2 line-clamp-3 text-xs text-slate-500">{selectedFunction.publicDescription || selectedFunction.description || 'Sem descrição pública.'}</p>
                    </div>
                  )}
                  {inheritedRequirements.length > 0 && (
                    <div className="md:col-span-2">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-600">Requisitos herdados</p>
                      <div className="flex flex-wrap gap-1.5">
                        {inheritedRequirements.slice(0, 8).map(requirement => (
                          <span key={requirement} className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-slate-400">
                            {requirement}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            )}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Composição do score</label>
              <select
                value={form.functionId ? form.compositionPreset : 'role_100'}
                onChange={event => setForm(prev => ({ ...prev, compositionPreset: event.target.value as RecruitmentCompositionPreset }))}
                disabled={!form.functionId}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm disabled:opacity-60"
              >
                {COMPOSITION_PRESET_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                O sistema usa presets controlados. Não há peso livre por pergunta.
              </p>
              {scoringPreview.snapshot.alerts.length > 0 && (
                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Alertas do score
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {scoringPreview.snapshot.alerts.slice(0, 4).map((alert, alertIndex) => (
                      <p
                        key={`${alert.code}-${alert.questionId ?? alertIndex}`}
                        className={`flex items-start gap-2 text-xs ${
                          alert.severity === 'blocking' ? 'text-red-300' : 'text-amber-300'
                        }`}
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {alert.message}
                      </p>
                    ))}
                  </div>
                  {scoringWarningAlerts.length > 0 && scoringBlockingAlerts.length === 0 && (
                    <div className="mt-3">
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-600">
                        Justificativa para publicar com alerta
                      </label>
                      <textarea
                        value={scoringAlertJustification}
                        onChange={event => setScoringAlertJustification(event.target.value)}
                        rows={2}
                        placeholder="Explique por que a vaga pode ser publicada mesmo com estes alertas."
                        className="w-full resize-none rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Nº de vagas</label>
              <input type="number" min="1" value={form.slots} onChange={set('slots')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Unidade</label>
              <select value={form.unitId} onChange={handleUnitChange}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Não especificada</option>
                {units.map(unit => (
                  <option key={unit.id} value={unit.id}>{unit.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Turno</label>
              <select value={form.shiftDefinitionId} onChange={set('shiftDefinitionId')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Não especificado</option>
                {availableShiftDefinitions.map(shift => (
                  <option key={shift.id} value={shift.id}>
                    {shift.name}{shift.startTime && shift.endTime ? ` (${shift.startTime}-${shift.endTime})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Localidade</label>
              <input type="text" value={form.location} onChange={set('location')} placeholder="Ex: São Paulo, SP"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Modalidade de trabalho</label>
              <select value={form.workType} onChange={set('workType')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                <option value="">Não especificado</option>
                {WORK_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Forma de contratação</label>
              <input
                type="text"
                value={form.contractTypeLabel}
                onChange={set('contractTypeLabel')}
                placeholder="Ex: CLT, PJ, temporário"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Jornada</label>
              <textarea
                value={form.workSchedule}
                onChange={set('workSchedule')}
                rows={2}
                className="w-full resize-none rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                placeholder="Ex: Escala 6x1, turnos alternados, disponibilidade para fins de semana."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Início das inscrições</label>
              <input type="date" value={form.applicationStartAt} onChange={set('applicationStartAt')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Fim das inscrições</label>
              <input type="date" value={form.applicationEndAt} onChange={set('applicationEndAt')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Encerra em</label>
              <input type="date" value={form.closesAt} onChange={set('closesAt')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm" />
            </div>
            {isEdit && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Status</label>
                <select value={form.status} onChange={set('status')}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm">
                  {(Object.keys(OPENING_STATUS_CONFIG) as JobOpeningStatus[]).map(s => (
                    <option key={s} value={s}>{OPENING_STATUS_CONFIG[s].label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Descrição</label>
              <textarea value={form.description} onChange={set('description')} rows={3}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm resize-none"
                placeholder="Sobre a vaga, contexto, dia a dia…" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Requisitos <span className="text-slate-600 font-normal">(um por linha)</span>
              </label>
              <textarea value={form.requirements} onChange={set('requirements')} rows={4}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm resize-none font-mono"
                placeholder="Experiência com gestão de equipes&#10;Disponibilidade de horário&#10;Residir em SP" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Benefícios <span className="text-slate-600 font-normal">(um por linha)</span>
              </label>
              <textarea
                value={form.benefits}
                onChange={set('benefits')}
                rows={3}
                className="w-full resize-none rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                placeholder="Vale-transporte&#10;Bonificações&#10;Day-off aniversário"
              />
            </div>
            <div className="col-span-2 grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  checked={form.salaryVisible}
                  onChange={event => setForm(prev => ({ ...prev, salaryVisible: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-500"
                />
                Mostrar salário na vaga pública
              </label>
              {form.salaryVisible && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Salário</label>
                <input
                  type="text"
                  value={form.salaryLabel}
                  onChange={set('salaryLabel')}
                  placeholder="Ex: R$ 1.800, R$ 1.800 a R$ 2.750 ou A combinar"
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
              )}
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Mensagem após envio da candidatura</label>
              <textarea
                value={form.successMessage}
                onChange={set('successMessage')}
                rows={3}
                className="w-full resize-none rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                placeholder="Ex: Recebemos sua candidatura. A equipe de recrutamento vai analisar suas informações e entrar em contato quando houver atualização."
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Contrato LGPD da candidatura</label>
              <textarea
                value={form.lgpdContractText}
                onChange={set('lgpdContractText')}
                rows={4}
                className="w-full resize-none rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                placeholder="Texto completo do contrato/termo LGPD exibido ao candidato antes do envio."
              />
            </div>
            <details className="group col-span-2 rounded-xl border border-slate-800 bg-slate-900/40">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Prévia da vaga pública</p>
                  <p className="mt-0.5 text-xs text-slate-400">Confira o texto final antes de publicar.</p>
                </div>
                <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-slate-800 p-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                  <div className="flex flex-wrap gap-2">
                    {(selectedUnit?.name || form.location) && (
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-400">
                        {selectedUnit?.name || form.location}
                      </span>
                    )}
                    {form.workType && (
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-400">
                        {WORK_TYPE_OPTIONS.find(option => option.value === form.workType)?.label}
                      </span>
                    )}
                    {form.contractTypeLabel.trim() && (
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-400">
                        {form.contractTypeLabel.trim()}
                      </span>
                    )}
                    <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-400">
                      {Number(form.slots) || 1} vaga{Number(form.slots) === 1 ? '' : 's'}
                    </span>
                    {openingSalaryPreview && (
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-400">
                        {openingSalaryPreview}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 text-lg font-bold text-white">{form.title.trim() || 'Título da vaga'}</h3>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Local</p>
                      <p className="mt-1 text-xs font-semibold text-slate-200">{selectedUnit?.name || form.location.trim() || 'Definir na vaga'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Jornada</p>
                      <p className="mt-1 text-xs font-semibold text-slate-200">{form.workSchedule.trim() || selectedShiftDefinition?.name || 'Definir na vaga'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Contratação</p>
                      <p className="mt-1 text-xs font-semibold text-slate-200">{form.contractTypeLabel.trim() || 'Definir na vaga'}</p>
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-400">
                    {form.description.trim() || inheritedDescriptionParts.join('\n\n') || 'Descrição pública da vaga.'}
                  </p>
                  {finalRequirements.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-600">Requisitos</p>
                      <ul className="space-y-1.5">
                        {finalRequirements.slice(0, 6).map(requirement => (
                          <li key={requirement} className="flex items-start gap-2 text-xs text-slate-400">
                            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                            {requirement}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {finalBenefits.length > 0 && (
                    <div className="mt-4 rounded-xl border border-pink-500/20 bg-pink-500/10 p-3">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-pink-200">Benefícios</p>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {finalBenefits.slice(0, 6).map(benefit => (
                          <span key={benefit} className="text-xs font-semibold text-pink-100">
                            {benefit}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-4 rounded-full bg-pink-500 px-4 py-2 text-center text-sm font-bold text-white">
                    {openingButtonText}
                  </div>
                </div>
              </div>
            </details>
            <div className="col-span-2 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Etapas do processo</h3>
                <p className="mt-1 text-xs text-slate-500">Ordem e rótulos usados no Kanban desta vaga.</p>
              </div>
              <div className="space-y-2">
                {stages.map((stage, index) => (
                  <div key={stage.id} className="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 md:grid-cols-[2rem_1fr_8rem_8rem] md:items-center">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-slate-400">
                      {index + 1}
                    </div>
                    <div>
                      <label className="sr-only">Nome da etapa</label>
                      <input
                        type="text"
                        value={stage.label}
                        onChange={event => updateStage(stage.id, { label: event.target.value })}
                        className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                      />
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{STATUS_CONFIG[stage.id].label}</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-600">Prazo</label>
                      <input
                        type="number"
                        min="0"
                        value={stage.dueDays ?? ''}
                        onChange={event => updateStage(stage.id, {
                          dueDays: event.target.value === '' ? null : Number(event.target.value),
                        })}
                        placeholder="dias"
                        className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveStage(stage.id, -1)}
                        className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-30"
                      >
                        Subir
                      </button>
                      <button
                        type="button"
                        disabled={index === stages.length - 1}
                        onClick={() => moveStage(stage.id, 1)}
                        className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-30"
                      >
                        Descer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="col-span-2 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Formulário de triagem</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Perguntas exibidas na candidatura pública desta vaga. O modelo combina cargo e função.
                  </p>
                  {questionsTouched && (
                    <p className="mt-1 text-[11px] font-medium text-amber-300">
                      Este formulário foi editado manualmente e não será sobrescrito ao trocar cargo/função.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={reloadModelQuestions}
                  disabled={!selectedRole}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Recarregar cargo + função
                </button>
              </div>

              {questions.length > 0 && (
                <div className="space-y-2">
                  {questions.map((question, index) => (
                    <div key={question.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <div className="grid gap-3 md:grid-cols-[1fr_160px_auto] md:items-start">
                        <div>
                          <input
                            type="text"
                            value={question.text}
                            onChange={event => updateQuestion(question.id, { text: event.target.value })}
                            className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                          />
                          <QuestionSectionEditor
                            question={question}
                            onChange={(patch) => updateQuestion(question.id, patch)}
                            variant="dark"
                          />
                          <QuestionParentEditor
                            question={question}
                            availableQuestions={questions.slice(0, index)}
                            onChange={(patch) => updateQuestion(question.id, patch)}
                            variant="dark"
                          />
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={question.required}
                                onChange={event => updateQuestion(question.id, { required: event.target.checked })}
                                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-500"
                              />
                              Obrigatória
                            </label>
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={question.eliminatory}
                                onChange={event => updateQuestion(question.id, withQuestionScoring(question, {
                                  use: event.target.checked ? 'eliminatory' : 'informational',
                                }))}
                                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-500"
                              />
                              Eliminatória
                            </label>
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={question.config?.multiline === true}
                                onChange={event => updateQuestion(question.id, {
                                  config: { ...(question.config ?? {}), multiline: event.target.checked },
                                })}
                                disabled={question.type !== 'text'}
                                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-500 disabled:opacity-40"
                              />
                              Texto longo
                            </label>
                          </div>
                          {(question.type === 'select' || question.type === 'multi_select') && (
                            <textarea
                              value={Array.isArray(question.config?.options) ? question.config.options.join('\n') : ''}
                              onChange={event => updateQuestionOptions(question.id, event.target.value)}
                              rows={3}
                              placeholder={'Opções, uma por linha\nManhã\nTarde/noite\nFlexível'}
                              className="mt-3 w-full resize-none rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            />
                          )}
                          <QuestionScoringEditor
                            question={question}
                            sourceLayer={question.scoring?.sourceLayer ?? (question.tags?.includes('function') ? 'function' : 'role')}
                            onChange={(patch) => updateQuestion(question.id, patch)}
                            variant="dark"
                          />
                          <QuestionConditionEditor
                            question={question}
                            availableQuestions={questions.slice(0, index)}
                            onChange={(patch) => updateQuestion(question.id, patch)}
                            variant="dark"
                          />
                        </div>
                        <select
                          value={question.type}
                          onChange={event => updateQuestion(question.id, { type: event.target.value as HrFormQuestion['type'] })}
                          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        >
                          {QUESTION_TYPES.map(type => (
                            <option key={type.value} value={type.value}>{type.label}</option>
                          ))}
                        </select>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveQuestion(question.id, -1)}
                            className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-30"
                          >
                            Subir
                          </button>
                          <button
                            type="button"
                            disabled={index === questions.length - 1}
                            onClick={() => moveQuestion(question.id, 1)}
                            className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-white disabled:opacity-30"
                          >
                            Descer
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setQuestionsTouched(true);
                              setQuestions(prev => prev.filter(item => item.id !== question.id));
                            }}
                            className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-white"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-950/50 p-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Pergunta</label>
                  <input
                    type="text"
                    value={questionDraft.text}
                    onChange={event => setQuestionDraft(prev => ({ ...prev, text: event.target.value }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                    placeholder="Ex: Você tem disponibilidade aos domingos?"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Seção</label>
                  <input
                    type="text"
                    value={questionDraft.sectionTitle}
                    onChange={event => setQuestionDraft(prev => ({ ...prev, sectionTitle: event.target.value }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                    placeholder="Ex: Disponibilidade"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Subpergunta de</label>
                  <select
                    value={questionDraft.parentQuestionId}
                    onChange={event => setQuestionDraft(prev => ({ ...prev, parentQuestionId: event.target.value }))}
                    disabled={questions.length === 0}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm disabled:opacity-50"
                  >
                    <option value="">Pergunta principal</option>
                    {questions.map(question => (
                      <option key={question.id} value={question.id}>Subpergunta de: {question.text}</option>
                    ))}
                  </select>
                </div>
                {questionDraft.parentQuestionId && (
                  <div className="col-span-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">Condição da subpergunta</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                      <span>
                        Exibir quando a resposta for
                      </span>
                      {([
                        { value: 'true', label: 'Sim' },
                        { value: 'false', label: 'Não' },
                        { value: 'always', label: 'Sempre' },
                      ] as const).map(item => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setQuestionDraft(prev => ({ ...prev, conditionValue: item.value }))}
                          className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                            questionDraft.conditionValue === item.value
                              ? 'bg-white text-slate-950'
                              : 'bg-slate-900 text-slate-400 hover:text-white'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Tipo</label>
                  <select
                    value={questionDraft.type}
                    onChange={event => setQuestionDraft(prev => ({ ...prev, type: event.target.value as HrFormQuestion['type'] }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm"
                  >
                    {QUESTION_TYPES.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={questionDraft.required}
                      onChange={event => setQuestionDraft(prev => ({ ...prev, required: event.target.checked }))}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-500"
                  />
                  Obrigatória
                </label>
                </div>
                <QuestionDraftScoringControls
                  draft={questionDraft}
                  onChange={(patch) => setQuestionDraft(prev => ({ ...prev, ...patch }))}
                  variant="dark"
                  className="col-span-2"
                />
                {(questionDraft.type === 'select' || questionDraft.type === 'multi_select') && (
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Opções, uma por linha</label>
                    <textarea
                      value={questionDraft.optionsText}
                      onChange={event => setQuestionDraft(prev => ({ ...prev, optionsText: event.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 text-sm resize-none"
                      placeholder={'Manhã\nTarde/noite\nFlexível'}
                    />
                  </div>
                )}
                {questionError && <p className="col-span-2 text-xs text-red-400">{questionError}</p>}
                <div className="col-span-2">
                  <button
                    type="button"
                    onClick={addQuestion}
                    className="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4" /> Adicionar pergunta
                  </button>
                </div>
              </div>
            </div>
          </div>
          {error && <ErrorLine msg={error} />}
        </form>
        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-slate-800 p-4">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-xl hover:bg-slate-800">
            Cancelar
          </button>
          <button
            type="submit"
            form={formId}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-medium text-sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar vaga'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── OpeningsView ─────────────────────────────────────────────────────────────

function OpeningsView({ openings, roles, functions, units, shiftDefinitions, candidates, getToken, canManage, onRefresh, onCandidatesFilter }: {
  openings: JobOpening[];
  roles: JobRole[];
  functions: JobFunction[];
  units: DPUnit[];
  shiftDefinitions: DPShiftDefinition[];
  candidates: Candidate[];
  getToken: () => Promise<string>;
  canManage: boolean;
  onRefresh: () => void;
  onCandidatesFilter: (openingId: string) => void;
}) {
  const [modal, setModal] = useState<'new' | JobOpening | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobOpening | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<JobOpeningStatus | ''>('');
  const [filterRole, setFilterRole] = useState('');
  const [filterUnit, setFilterUnit] = useState('');

  const handleDelete = async (o: JobOpening) => {
    setDeleting(true);
    try {
      await apiFetch(`/api/hr/openings/${o.id}`, getToken, { method: 'DELETE' });
      onRefresh();
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const unitOptions = useMemo(() => {
    const byId = new Map<string, string>();
    openings.forEach(opening => {
      const id = opening.unitId || opening.unitName || opening.location;
      const label = opening.unitName || opening.location;
      if (id && label) byId.set(id, label);
    });
    units.forEach(unit => {
      if (unit.id && unit.name) byId.set(unit.id, unit.name);
    });
    return Array.from(byId.entries()).map(([id, label]) => ({ id, label }));
  }, [openings, units]);

  const filteredOpenings = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return openings.filter(opening => {
      const role = roles.find(item => item.id === opening.jobRoleId);
      const unitLabel = opening.unitName || opening.location || '';
      const searchable = [
        opening.title,
        opening.slug,
        role?.name,
        opening.jobRoleName,
        opening.functionName,
        unitLabel,
        opening.shiftDefinitionName,
      ].filter(Boolean).join(' ').toLowerCase();

      if (normalizedSearch && !searchable.includes(normalizedSearch)) return false;
      if (filterStatus && opening.status !== filterStatus) return false;
      if (filterRole && opening.jobRoleId !== filterRole) return false;
      if (filterUnit) {
        const matchesUnit =
          opening.unitId === filterUnit ||
          opening.unitName === filterUnit ||
          opening.location === filterUnit ||
          unitLabel === unitOptions.find(unit => unit.id === filterUnit)?.label;
        if (!matchesUnit) return false;
      }
      return true;
    });
  }, [filterRole, filterStatus, filterUnit, openings, roles, search, unitOptions]);

  const grouped: Record<JobOpeningStatus, JobOpening[]> = { open: [], paused: [], closed: [] };
  filteredOpenings.forEach(o => grouped[o.status].push(o));
  const activeFilters = [search.trim(), filterStatus, filterRole, filterUnit].filter(Boolean).length;

  return (
    <div className="w-full min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p className="text-slate-500 text-sm">{openings.filter(o => o.status === 'open').length} vagas abertas</p>
        {canManage && (
          <button onClick={() => setModal('new')}
            className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800">
            <Plus className="h-4 w-4" /> Criar vaga
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-3 shadow-sm">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar vaga, cargo ou unidade…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
        <select
          value={filterStatus}
          onChange={event => setFilterStatus(event.target.value as JobOpeningStatus | '')}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          <option value="">Todos os status</option>
          <option value="open">Abertas</option>
          <option value="paused">Pausadas</option>
          <option value="closed">Encerradas</option>
        </select>
        <select
          value={filterRole}
          onChange={event => setFilterRole(event.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          <option value="">Todos os cargos</option>
          {roles.filter(role => role.isActive !== false).map(role => (
            <option key={role.id} value={role.id}>{role.name}</option>
          ))}
        </select>
        <select
          value={filterUnit}
          onChange={event => setFilterUnit(event.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          <option value="">Todas as unidades</option>
          {unitOptions.map(unit => (
            <option key={unit.id} value={unit.id}>{unit.label}</option>
          ))}
        </select>
        {activeFilters > 0 && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setFilterStatus('');
              setFilterRole('');
              setFilterUnit('');
            }}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {openings.length === 0 && (
        <div className="py-16 text-center">
          <Briefcase className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Nenhuma vaga cadastrada.</p>
        </div>
      )}

      {openings.length > 0 && filteredOpenings.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center shadow-sm">
          <SlidersHorizontal className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">Nenhuma vaga encontrada com esses filtros.</p>
          <p className="mt-1 text-sm text-slate-500">Ajuste a busca ou limpe os filtros para ver todas as vagas.</p>
        </div>
      )}

      {(Object.keys(grouped) as JobOpeningStatus[]).map(status => {
        const group = grouped[status];
        if (group.length === 0) return null;
        const cfg = OPENING_STATUS_CONFIG[status];
        const Icon = cfg.icon;
        return (
          <div key={status}>
            <div className="flex items-center gap-2 mb-3">
              <Icon className="h-4 w-4 text-slate-500" />
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">{cfg.label}</h3>
              <span className="text-xs text-slate-600">({group.length})</span>
            </div>
            <div className="space-y-3">
              {group.map(opening => {
                const role = roles.find(r => r.id === opening.jobRoleId);
                const openingCandidates = candidates.filter(c => c.jobOpeningId === opening.id);
                const pipelineCount = openingCandidates.filter(c => PIPELINE_STATUSES.includes(c.status)).length;
                const hiredCount = openingCandidates.filter(c => c.status === 'hired').length;
                const scoringAlerts = opening.recruitmentScoring?.alerts ?? [];
                const blockingScoringAlerts = scoringAlerts.filter(alert => alert.severity === 'blocking');
                const scoringSummary = getOpeningScoringSummary(opening);
                return (
                  <div key={opening.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-slate-300">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h4 className="font-bold text-slate-950 text-sm">{opening.title}</h4>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.color}`}>
                            {cfg.label}
                          </span>
                          {scoringAlerts.length > 0 && (
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                              blockingScoringAlerts.length > 0
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : 'border-amber-200 bg-amber-50 text-amber-700'
                            }`}>
                              <AlertTriangle className="h-3 w-3" />
                              {blockingScoringAlerts.length > 0
                                ? `${blockingScoringAlerts.length} bloqueio${blockingScoringAlerts.length !== 1 ? 's' : ''}`
                                : `${scoringAlerts.length} alerta${scoringAlerts.length !== 1 ? 's' : ''}`}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mb-2">
                          {role?.name ?? opening.jobRoleName}
                          {opening.functionName ? ` · ${opening.functionName}` : ''}
                        </p>
                        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                          {(opening.unitName || opening.location) && <span>{opening.unitName || opening.location}</span>}
                          {opening.shiftDefinitionName && <span>{opening.shiftDefinitionName}</span>}
                          {opening.workType && <span>{{ presencial: 'Presencial', remoto: 'Remoto', hibrido: 'Híbrido' }[opening.workType]}</span>}
                          <span>{opening.slots} vaga{opening.slots !== 1 ? 's' : ''}</span>
                          <span>{openingCandidates.length} inscrito{openingCandidates.length !== 1 ? 's' : ''}</span>
                          {hiredCount > 0 && <span className="text-emerald-600">{hiredCount} contratado{hiredCount !== 1 ? 's' : ''}</span>}
                          <span>{scoringSummary.presetLabel}</span>
                          <span>{scoringSummary.scoredCount} pontuável{scoringSummary.scoredCount !== 1 ? 'eis' : ''}</span>
                          <span>{scoringSummary.eliminatoryCount} eliminatória{scoringSummary.eliminatoryCount !== 1 ? 's' : ''}</span>
                          {opening.applicationStartAt && (
                            <span>
                              inscrições desde {new Date(opening.applicationStartAt).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                          {opening.applicationEndAt && (
                            <span className="text-amber-600">
                              inscrições até {new Date(opening.applicationEndAt).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                          {opening.closesAt && (
                            <span className="text-amber-600">
                              até {new Date(opening.closesAt).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {opening.status === 'open' && (
                          <a
                            href={`${PUBLIC_RECRUITMENT_URL}/${opening.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 border border-slate-200 hover:border-slate-300 rounded-lg transition-colors"
                          >
                            Ver vaga
                          </a>
                        )}
                        <button
                          onClick={() => onCandidatesFilter(opening.id)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 border border-slate-200 hover:border-slate-300 rounded-lg transition-colors">
                          Abrir Kanban ({pipelineCount})
                        </button>
                        {canManage && (
                          <>
                            <button onClick={() => setModal(opening)}
                              className="p-1.5 text-slate-500 hover:text-slate-950 rounded-lg hover:bg-slate-100">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setDeleteTarget(opening)}
                              className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg hover:bg-red-500/10">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {opening.description && (
                      <p className="mt-3 text-xs text-slate-500 line-clamp-2">{opening.description}</p>
                    )}
                    {scoringSummary.categoryEntries.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {scoringSummary.categoryEntries.slice(0, 5).map(([category, value]) => (
                          <span key={category} className="rounded-md bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500">
                            {RECRUITMENT_CATEGORY_LABELS[category as keyof typeof RECRUITMENT_CATEGORY_LABELS]} {Number(value).toFixed(0)} pts
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {modal && (
        <OpeningModal
          opening={modal === 'new' ? undefined : modal}
          roles={roles}
          functions={functions}
          units={units}
          shiftDefinitions={shiftDefinitions}
          getToken={getToken}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); onRefresh(); }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative z-10 w-full max-w-xs space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
            <h3 className="font-bold text-slate-950">Excluir vaga?</h3>
            <p className="text-sm text-slate-500">"{deleteTarget.title}" será removida permanentemente.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 px-3 py-2 text-sm border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={() => handleDelete(deleteTarget)} disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-xl">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TalentsView ─────────────────────────────────────────────────────────────

function TalentsView({ candidates, roles, openings, getToken, canManage, onOpen, onReactivated }: {
  candidates: Candidate[];
  roles: JobRole[];
  openings: JobOpening[];
  getToken: () => Promise<string>;
  canManage: boolean;
  onOpen: (c: Candidate) => void;
  onReactivated: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterRating, setFilterRating] = useState('');
  const [reactivating, setReactivating] = useState<string | null>(null);
  const [reactivationTarget, setReactivationTarget] = useState<Candidate | null>(null);
  const [reactivationOpeningId, setReactivationOpeningId] = useState('');
  const [reactivationStage, setReactivationStage] = useState<CandidateStatus>('applied');
  const [reactivationReuseData, setReactivationReuseData] = useState(true);
  const [reactivationNote, setReactivationNote] = useState('');
  const [reactivationError, setReactivationError] = useState<string | null>(null);

  const talentPoolCandidates = candidates.filter(c => c.status === TALENT_POOL_STATUS || c.source === 'talent_pool');
  const activeOpenings = openings.filter(opening => opening.status === 'open');
  const selectedReactivationOpening = activeOpenings.find(opening => opening.id === reactivationOpeningId) ?? null;
  const reactivationStages = normalizeRecruitmentStages(selectedReactivationOpening?.pipelineStages);

  const filtered = talentPoolCandidates.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) &&
        !c.email.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterRole && c.jobRoleId !== filterRole) return false;
    if (filterRating && (c.rating ?? 0) < Number(filterRating)) return false;
    return true;
  });

  const highRating = talentPoolCandidates.filter(c => (c.rating ?? 0) >= 4).length;

  async function handleReactivate(candidate: Candidate, openingId: string) {
    if (!openingId) {
      setReactivationError('Selecione uma vaga para reativar o candidato.');
      return;
    }
    setReactivating(candidate.id);
    setReactivationError(null);
    try {
      await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify({
          reactivateToOpeningId: openingId,
          reactivateToStage: reactivationStage,
          reuseCandidateData: reactivationReuseData,
          decisionNote: reactivationNote.trim() || undefined,
        }),
      });
      setReactivationTarget(null);
      setReactivationOpeningId('');
      setReactivationStage('applied');
      setReactivationReuseData(true);
      setReactivationNote('');
      onReactivated();
    } catch (err) {
      setReactivationError(err instanceof Error ? err.message : 'Falha ao reativar candidato.');
    } finally {
      setReactivating(null);
    }
  }

  const roleOptions = useMemo(() => {
    const ids = new Set(talentPoolCandidates.map(c => c.jobRoleId).filter(Boolean));
    return roles.filter(r => ids.has(r.id));
  }, [talentPoolCandidates, roles]);

  return (
    <div className="flex flex-col gap-4 flex-1">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Total no banco</p>
          <p className="text-3xl font-bold text-white">{talentPoolCandidates.length}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Alta avaliação (4+)</p>
          <p className="text-3xl font-bold text-amber-400">{highRating}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Cargos distintos</p>
          <p className="text-3xl font-bold text-white">{roleOptions.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou e-mail…"
            className="pl-9 pr-4 py-2 bg-slate-900/50 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-52 text-sm" />
        </div>
        {roleOptions.length > 0 && (
          <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
            className="px-3 py-2 bg-slate-900/50 border border-slate-800 rounded-xl text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
            <option value="">Todos os cargos</option>
            {roleOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <select value={filterRating} onChange={e => setFilterRating(e.target.value)}
          className="px-3 py-2 bg-slate-900/50 border border-slate-800 rounded-xl text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
          <option value="">Avaliação</option>
          <option value="1">1+ estrela</option>
          <option value="2">2+ estrelas</option>
          <option value="3">3+ estrelas</option>
          <option value="4">4+ estrelas</option>
          <option value="5">5 estrelas</option>
        </select>
      </div>

      {/* Empty state */}
      {talentPoolCandidates.length === 0 && (
        <div className="py-16 text-center">
          <Star className="h-10 w-10 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Nenhum candidato no banco de talentos ainda.</p>
          <p className="text-slate-600 text-xs mt-1">Candidatos espontâneos ou movidos para o banco aparecem aqui.</p>
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(candidate => {
            const statusCfg = STATUS_CONFIG[candidate.status];
            return (
              <div key={candidate.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors flex flex-col gap-3">
                {/* Top */}
                <div className="flex items-start gap-3">
                  <CandidateInitials name={candidate.name} />
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => onOpen(candidate)}
                      className="text-sm font-semibold text-white hover:text-indigo-300 transition-colors truncate block text-left w-full">
                      {candidate.name}
                    </button>
                    <p className="text-[11px] text-slate-500 truncate">{candidate.jobRoleName ?? '—'}</p>
                    {candidate.talentPool?.unitPreference && (
                      <p className="mt-0.5 text-[10px] text-slate-600 truncate">{candidate.talentPool.unitPreference}</p>
                    )}
                  </div>
                </div>

                {/* Rating */}
                <RatingStars value={candidate.rating ?? 0} readonly />

                {/* Status + date */}
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusCfg.color}/20 text-slate-400`}>
                    {statusCfg.label}
                  </span>
                  <span className="text-[10px] text-slate-600">
                    {new Date(candidate.appliedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </span>
                </div>

                {/* Reactivate */}
                {canManage && (
                  <button
                    onClick={() => {
                      setReactivationTarget(candidate);
                      setReactivationOpeningId('');
                      setReactivationStage('applied');
                      setReactivationReuseData(true);
                      setReactivationNote('');
                      setReactivationError(null);
                    }}
                    disabled={reactivating === candidate.id}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-indigo-400 border border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/15 rounded-xl transition-colors disabled:opacity-40">
                    {reactivating === candidate.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <ArrowRight className="h-3 w-3" />}
                    Reativar em vaga
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* No results */}
      {talentPoolCandidates.length > 0 && filtered.length === 0 && (
        <div className="py-10 text-center text-slate-600 text-sm">Nenhum candidato encontrado com os filtros aplicados.</div>
      )}

      {reactivationTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setReactivationTarget(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Banco de talentos</p>
                <h3 className="mt-1 text-lg font-bold text-white">Reativar candidato</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Vincule <span className="font-semibold text-slate-200">{reactivationTarget.name}</span> a uma vaga aberta.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReactivationTarget(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Vaga aberta</label>
                <select
                  value={reactivationOpeningId}
                  onChange={event => {
                    const openingId = event.target.value;
                    const opening = activeOpenings.find(item => item.id === openingId) ?? null;
                    const stages = normalizeRecruitmentStages(opening?.pipelineStages);
                    setReactivationOpeningId(openingId);
                    setReactivationStage(stages[0]?.id ?? 'applied');
                  }}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500/30"
                >
                  <option value="">Selecione uma vaga</option>
                  {activeOpenings.map(opening => (
                    <option key={opening.id} value={opening.id}>
                      {opening.title}{opening.unitName || opening.location ? ` · ${opening.unitName || opening.location}` : ''}
                    </option>
                  ))}
                </select>
                {activeOpenings.length === 0 && (
                  <p className="mt-2 text-xs text-amber-300">Não há vagas abertas para receber este candidato.</p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Etapa inicial</label>
                <select
                  value={reactivationStage}
                  onChange={event => setReactivationStage(event.target.value as CandidateStatus)}
                  disabled={!reactivationOpeningId}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
                >
                  {reactivationStages.map(stage => (
                    <option key={stage.id} value={stage.id}>{stage.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-600">
                  O candidato pode voltar direto para triagem, entrevista ou outra etapa definida na vaga.
                </p>
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                <input
                  type="checkbox"
                  checked={reactivationReuseData}
                  onChange={event => setReactivationReuseData(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-950"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-200">Reaproveitar dados anteriores</span>
                  <span className="mt-0.5 block text-xs text-slate-500">Mantém currículo, respostas do formulário e histórico como base desta nova candidatura.</span>
                </span>
              </label>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Nota do reaproveitamento</label>
                <textarea
                  value={reactivationNote}
                  onChange={event => setReactivationNote(event.target.value)}
                  rows={3}
                  placeholder="Ex: Retomar pela entrevista com liderança."
                  className="w-full resize-none rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              {reactivationError && <ErrorLine msg={reactivationError} />}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReactivationTarget(null)}
                  className="rounded-xl px-4 py-2 text-sm text-slate-400 hover:bg-slate-900 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleReactivate(reactivationTarget, reactivationOpeningId)}
                  disabled={!reactivationOpeningId || !!reactivating}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {reactivating === reactivationTarget.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Reativar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RecruitmentFormsView ────────────────────────────────────────────────────

type QuestionModelKind = 'role' | 'function';

type QuestionModelOption = {
  key: string;
  kind: QuestionModelKind;
  item: JobRole | JobFunction;
  label: string;
  subtitle: string;
  searchText: string;
};

function buildRoleFunctionModelOptions(roles: JobRole[], functions: JobFunction[]): QuestionModelOption[] {
  const activeFunctions = functions.filter(item => item.isActive !== false);
  const rolesWithFunctions = new Set<string>();
  activeFunctions.forEach(item => {
    (item.compatibleRoleIds ?? []).forEach(roleId => rolesWithFunctions.add(roleId));
  });

  const roleOptions = roles
    .filter(role => role.isActive !== false && !rolesWithFunctions.has(role.id))
    .map((role): QuestionModelOption => {
      const subtitle = role.departmentName?.trim() || 'Cargo sem função vinculada';
      return {
        key: `role:${role.id}`,
        kind: 'role',
        item: role,
        label: role.name,
        subtitle,
        searchText: `${role.name} ${role.publicTitle ?? ''} ${subtitle}`.toLowerCase(),
      };
    });

  const functionOptions = activeFunctions.map((item): QuestionModelOption => {
    const roleNames = (item.compatibleRoleIds ?? [])
      .map(roleId => roles.find(role => role.id === roleId)?.name)
      .filter((name): name is string => !!name);
    const subtitle = [
      item.departmentName?.trim() || 'Função',
      roleNames.length ? `Cargo: ${roleNames.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    return {
      key: `function:${item.id}`,
      kind: 'function',
      item,
      label: item.name,
      subtitle,
      searchText: `${item.name} ${item.publicTitle ?? ''} ${subtitle}`.toLowerCase(),
    };
  });

  return [...roleOptions, ...functionOptions].sort((a, b) => {
    const departmentCompare = a.subtitle.localeCompare(b.subtitle, 'pt-BR');
    if (departmentCompare !== 0) return departmentCompare;
    if (a.kind !== b.kind) return a.kind === 'function' ? -1 : 1;
    return a.label.localeCompare(b.label, 'pt-BR');
  });
}

function IntegrationModelSettingsEditor({ roles, functions, getToken, canManage, onSaved }: {
  roles: JobRole[];
  functions: JobFunction[];
  getToken: () => Promise<string>;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [selectedKey, setSelectedKey] = useState('');
  const [query, setQuery] = useState('');
  const [stages, setStages] = useState<OnboardingStage[]>(() => normalizeOnboardingStages(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const modelOptions = useMemo(
    () => buildRoleFunctionModelOptions(roles, functions),
    [roles, functions]
  );
  const selectedOption = useMemo(
    () => modelOptions.find(option => option.key === selectedKey) ?? modelOptions[0] ?? null,
    [modelOptions, selectedKey]
  );
  const selected = selectedOption?.item ?? null;
  const filteredOptions = query.trim()
    ? modelOptions.filter(option => option.searchText.includes(query.trim().toLowerCase()))
    : modelOptions;
  const configuredCount = modelOptions.filter(option =>
    (option.item.onboardingStages?.length ?? 0) > 0
  ).length;

  useEffect(() => {
    if (modelOptions.length === 0) {
      setSelectedKey('');
      return;
    }
    if (!selectedKey || !modelOptions.some(option => option.key === selectedKey)) {
      setSelectedKey(modelOptions[0].key);
    }
  }, [modelOptions, selectedKey]);

  useEffect(() => {
    setStages(normalizeOnboardingStages(selected?.onboardingStages));
    setError(null);
    setSavedAt(null);
  }, [selected?.id, selected?.onboardingStages]);

  function updateStage(stageId: OnboardingStageId, patch: Partial<OnboardingStage>) {
    setStages(current => current.map(stage => stage.id === stageId ? { ...stage, ...patch } : stage));
  }

  async function saveIntegrationModel() {
    if (!selected || !selectedOption) return;
    setSaving(true);
    setError(null);
    try {
      const endpoint = selectedOption.kind === 'role'
        ? `/api/hr/roles/${selected.id}`
        : `/api/hr/functions/${selected.id}`;
      await apiFetch(endpoint, getToken, {
        method: 'PATCH',
        body: JSON.stringify({
          onboardingStages: stages.map((stage, index) => ({ ...stage, order: index })),
        }),
      });
      setSavedAt(new Date().toISOString());
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar modelo de integração.');
    } finally {
      setSaving(false);
    }
  }

  if (modelOptions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-white py-14 text-center text-sm text-slate-500">
        Nenhum cargo ou função disponível para configurar integração.
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-xl border bg-white">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold text-slate-950">Modelos de integração</p>
          <p className="mt-1 text-xs text-slate-500">{configuredCount}/{modelOptions.length} configurados</p>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar cargo ou função..."
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-slate-400"
            />
          </div>
        </div>
        <div className="max-h-[560px] overflow-y-auto p-2">
          {filteredOptions.map(option => {
            const selectedItem = option.key === selectedOption?.key;
            const stageCount = normalizeOnboardingStages(option.item.onboardingStages).length;
            const hasCustomModel = (option.item.onboardingStages?.length ?? 0) > 0;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setSelectedKey(option.key)}
                className={`flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                  selectedItem ? 'bg-slate-950 text-white' : 'hover:bg-slate-50'
                }`}
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  selectedItem ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  {candidateInitials(option.label)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{option.label}</span>
                  <span className={`mt-0.5 block truncate text-xs ${selectedItem ? 'text-white/65' : 'text-slate-500'}`}>
                    {option.subtitle}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
                  selectedItem
                    ? 'bg-white/15 text-white'
                    : hasCustomModel
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                }`}>
                  {stageCount}
                </span>
              </button>
            );
          })}
          {filteredOptions.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-slate-500">Nenhum modelo encontrado.</p>
          ) : null}
        </div>
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="rounded-xl border bg-white p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {selectedOption?.kind === 'role' ? 'Cargo' : 'Função'}
              </p>
              <h2 className="mt-1 text-xl font-bold text-slate-950">{selected?.name ?? 'Modelo de integração'}</h2>
              <p className="mt-1 text-sm text-slate-500">{selectedOption?.subtitle}</p>
            </div>
            {canManage ? (
              <button
                type="button"
                onClick={saveIntegrationModel}
                disabled={saving || !selected}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Salvar modelo
              </button>
            ) : null}
          </div>
          {error ? <div className="mt-4"><ErrorLine msg={error} /></div> : null}
          {savedAt ? (
            <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
              Modelo salvo em {new Date(savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="rounded-xl border bg-white p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">Etapas da integração</p>
                <p className="mt-1 text-xs text-slate-500">Sequência aplicada ao iniciar integração por este modelo.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">
                {pluralizePt(stages.length, 'etapa', 'etapas')}
              </span>
            </div>
            <div className="space-y-2">
              {stages.map((stage, index) => (
                <div key={stage.id} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[2rem_minmax(0,1fr)_140px] md:items-center">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-white text-xs font-bold text-slate-600 ring-1 ring-slate-200">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {ONBOARDING_STAGE_DETAILS[stage.id].owner}
                    </p>
                    <input
                      value={stage.label}
                      onChange={event => updateStage(stage.id, { label: event.target.value })}
                      disabled={!canManage}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400 disabled:opacity-60"
                    />
                  </div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Prazo
                    <input
                      type="number"
                      min="0"
                      value={stage.dueDays ?? ''}
                      onChange={event => updateStage(stage.id, { dueDays: event.target.value === '' ? null : Number(event.target.value) })}
                      disabled={!canManage}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400 disabled:opacity-60"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>

          <aside className="rounded-xl border bg-white p-5">
            <p className="text-sm font-semibold text-slate-950">Documentos universais</p>
            <div className="mt-4 space-y-2">
              {DEFAULT_ONBOARDING_DOCUMENTS.map(document => (
                <div key={document.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-sm font-semibold text-slate-800">{document.label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{document.required !== false ? 'Obrigatório' : 'Opcional'}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function hasModelText(value?: string | null) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasSavedQuestionModelContent(item: JobRole | JobFunction) {
  return Boolean(item.recruitmentModelSavedAt || (item.formQuestions?.length ?? 0) > 0);
}

function cloneRecruitmentQuestions(questions: HrFormQuestion[] | undefined) {
  return (questions ?? []).map((question, index) => ({
    ...question,
    id: question.id || `question-${index + 1}`,
    active: question.active !== false,
    tags: question.tags ?? [],
  }));
}

function RecruitmentQuestionModelEditor({ roles, functions, getToken, canManage, onSaved }: {
  roles: JobRole[];
  functions: JobFunction[];
  getToken: () => Promise<string>;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [selectedKey, setSelectedKey] = useState('');
  const [selectorQuery, setSelectorQuery] = useState('');
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [showModelsModal, setShowModelsModal] = useState(false);
  const [modelStep, setModelStep] = useState<RecruitmentModelEditorStep>('general');
  const [questions, setQuestions] = useState<HrFormQuestion[]>([]);
  const [modelText, setModelText] = useState({
    publicTitle: '',
    publicDescription: '',
    publicResponsibilities: '',
    publicRequirements: '',
    benefits: '',
    workSchedule: '',
    salaryLabel: '',
    salaryVisible: false,
    locationLabel: '',
    workType: '',
    contractTypeLabel: '',
    deadlineLabel: '',
    buttonText: PUBLIC_APPLY_BUTTON_LABEL,
    successMessage: '',
    lgpdContractText: '',
  });
  const [draft, setDraft] = useState(EMPTY_QUESTION_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const modelOptions = useMemo<QuestionModelOption[]>(() => {
    const activeFunctions = functions.filter(item => item.isActive !== false);
    const rolesWithFunctions = new Set<string>();
    activeFunctions.forEach(item => {
      (item.compatibleRoleIds ?? []).forEach(roleId => rolesWithFunctions.add(roleId));
    });

    const roleOptions = roles
      .filter(role => role.isActive !== false && !rolesWithFunctions.has(role.id))
      .map((role): QuestionModelOption => {
        const subtitle = role.departmentName?.trim() || 'Cargo sem função vinculada';
        return {
          key: `role:${role.id}`,
          kind: 'role',
          item: role,
          label: role.name,
          subtitle,
          searchText: `${role.name} ${role.publicTitle ?? ''} ${subtitle}`.toLowerCase(),
        };
      });

    const functionOptions = activeFunctions.map((item): QuestionModelOption => {
      const roleNames = (item.compatibleRoleIds ?? [])
        .map(roleId => roles.find(role => role.id === roleId)?.name)
        .filter((name): name is string => !!name);
      const subtitle = [
        item.departmentName?.trim() || 'Função',
        roleNames.length ? `Cargo: ${roleNames.join(', ')}` : '',
      ].filter(Boolean).join(' · ');
      return {
        key: `function:${item.id}`,
        kind: 'function',
        item,
        label: item.name,
        subtitle,
        searchText: `${item.name} ${item.publicTitle ?? ''} ${subtitle}`.toLowerCase(),
      };
    });

    return [...roleOptions, ...functionOptions].sort((a, b) => {
      const departmentCompare = a.subtitle.localeCompare(b.subtitle, 'pt-BR');
      if (departmentCompare !== 0) return departmentCompare;
      if (a.kind !== b.kind) return a.kind === 'function' ? -1 : 1;
      return a.label.localeCompare(b.label, 'pt-BR');
    });
  }, [roles, functions]);

  const selectedOption = useMemo(
    () => modelOptions.find(option => option.key === selectedKey) ?? modelOptions[0] ?? null,
    [modelOptions, selectedKey]
  );
  const selected = selectedOption?.item ?? null;
  const kind: QuestionModelKind = selectedOption?.kind ?? 'role';
  const modelLabel = kind === 'role' ? 'cargo' : 'função';
  const title = 'Modelos de formulários';
  const primaryQuestionCount = questions.filter(question => !question.parentQuestionId).length;
  const subquestionCount = questions.filter(question => question.parentQuestionId).length;
  const sectionCount = groupRecruitmentQuestionsBySection(questions, 'Perguntas do modelo').length;
  const visibleQuestionCount = questions.filter(question => question.active !== false).length;
  const getModelOptionQuestions = (option: QuestionModelOption) =>
    option.key === selectedOption?.key ? questions : (option.item.formQuestions ?? []);
  const hasCurrentModelContent = () => Boolean(
    savedAt ||
    (selected ? hasSavedQuestionModelContent(selected) : false)
  );
  const getModelOptionHasModel = (option: QuestionModelOption) =>
    option.key === selectedOption?.key ? hasCurrentModelContent() : hasSavedQuestionModelContent(option.item);
  const configuredModelOptions = modelOptions.filter(option => getModelOptionHasModel(option));

  useEffect(() => {
    if (modelOptions.length === 0) {
      setSelectedKey('');
      return;
    }
    if (!selectedKey || !modelOptions.some(option => option.key === selectedKey)) {
      setSelectedKey(modelOptions[0].key);
    }
  }, [modelOptions, selectedKey]);

  useEffect(() => {
    setQuestions(cloneRecruitmentQuestions(selected?.formQuestions));
    setModelText({
      publicTitle: selected?.publicTitle || selected?.name || '',
      publicDescription: selected?.publicDescription || selected?.description || '',
      publicResponsibilities: '',
      publicRequirements: listToText(
        Array.from(new Set([
          ...(selected?.publicResponsibilities ?? []),
          ...(selected?.publicRequirements?.length
            ? selected.publicRequirements
            : selected?.requirements ?? []),
        ]))
      ),
      benefits: listToText(selected?.benefits),
      workSchedule: selected?.workSchedule || '',
      salaryLabel: salaryTextFromRange(selected?.publicSalaryRange),
      salaryVisible: selected?.publicSalaryRange?.visible === true,
      locationLabel: selected?.recruitmentDisplay?.locationLabel || '',
      workType: selected?.recruitmentDisplay?.workType || '',
      contractTypeLabel: selected?.recruitmentDisplay?.contractTypeLabel || '',
      deadlineLabel: selected?.recruitmentDisplay?.deadlineLabel || '',
      buttonText: PUBLIC_APPLY_BUTTON_LABEL,
      successMessage: selected?.recruitmentDisplay?.successMessage || selected?.applicationSuccessMessage || '',
      lgpdContractText: selected?.recruitmentDisplay?.lgpdContractText || selected?.lgpdContractText || '',
    });
    setDraft(EMPTY_QUESTION_DRAFT);
    setModelStep('general');
    setError(null);
    setSavedAt(null);
  }, [
    selected?.id,
    selected?.formQuestions,
    selected?.publicTitle,
    selected?.publicDescription,
    selected?.publicResponsibilities,
    selected?.publicRequirements,
    selected?.benefits,
    selected?.workSchedule,
    selected?.publicSalaryRange,
    selected?.recruitmentDisplay,
    selected?.applicationSuccessMessage,
    selected?.lgpdContractText,
    selected?.requirements,
  ]);

  function updateQuestion(questionId: string, patch: Partial<HrFormQuestion>) {
    setQuestions(prev => prev.map(question => question.id === questionId ? { ...question, ...patch } : question));
  }

  function updateQuestionOptions(questionId: string, optionsText: string) {
    const options = optionsText
      .split('\n')
      .map(option => option.trim())
      .filter(Boolean);
    setQuestions(prev => prev.map(question => question.id === questionId
      ? { ...question, config: { ...(question.config ?? {}), options } }
      : question
    ));
  }

  function moveQuestion(questionId: string, direction: -1 | 1) {
    setQuestions(prev => {
      const index = prev.findIndex(question => question.id === questionId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }

  function addQuestion() {
    const text = draft.text.trim();
    if (!draft.sectionTitle.trim()) {
      setError('Selecione ou crie uma seção antes de adicionar a pergunta.');
      return;
    }
    if (!text) return;
    const options = draft.optionsText
      .split('\n')
      .map(option => option.trim())
      .filter(Boolean);
    if ((draft.type === 'select' || draft.type === 'multi_select') && options.length === 0) {
      setError('Informe ao menos uma opção para campos de seleção.');
      return;
    }

    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `question-${Date.now()}`;
    const parentQuestion = questions.find(question => question.id === draft.parentQuestionId);
    const conditions = conditionFromDraft(parentQuestion, draft.conditionValue);
    setQuestions(prev => [
      ...prev,
      {
        id,
        text,
        type: draft.type,
        ...questionSectionFromDraft(draft.sectionTitle),
        parentQuestionId: draft.parentQuestionId || undefined,
        ...(conditions ? { conditions } : {}),
        required: draft.required,
        active: true,
        ...questionScoringFromDraft(draft, kind),
        tags: [kind],
        config: options.length > 0 ? { options } : undefined,
      },
    ]);
    setDraft(EMPTY_QUESTION_DRAFT);
    setError(null);
  }

  async function saveModel() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const endpoint = kind === 'role'
        ? `/api/hr/roles/${selected.id}`
        : `/api/hr/functions/${selected.id}`;
      await apiFetch(endpoint, getToken, {
        method: 'PATCH',
        body: JSON.stringify({
          publicTitle: modelText.publicTitle.trim() || selected.name,
          publicDescription: modelText.publicDescription.trim(),
          publicResponsibilities: [],
          publicRequirements: textToList(modelText.publicRequirements),
          benefits: textToList(modelText.benefits),
          workSchedule: modelText.workSchedule.trim(),
          publicSalaryRange: salaryRangeFromText(modelText.salaryLabel, modelText.salaryVisible),
          recruitmentDisplay: {
            locationLabel: modelText.locationLabel.trim(),
            workType: modelText.workType || undefined,
            contractTypeLabel: modelText.contractTypeLabel.trim(),
            deadlineLabel: modelText.deadlineLabel.trim(),
            buttonText: PUBLIC_APPLY_BUTTON_LABEL,
            successMessage: modelText.successMessage.trim(),
            lgpdContractText: modelText.lgpdContractText.trim(),
          },
          recruitmentModelSavedAt: new Date().toISOString(),
          formQuestions: questions.map((question, index) => ({ ...question, order: index })),
        }),
      });
      setSavedAt(new Date().toISOString());
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao salvar modelo do ${modelLabel}.`);
    } finally {
      setSaving(false);
    }
  }

  const modelBenefits = textToList(modelText.benefits);
  const modelRequirements = textToList(modelText.publicRequirements);
  const modelResponsibilities = textToList(modelText.publicResponsibilities);
  const modelSalaryPreview = formatSalaryRange(salaryRangeFromText(modelText.salaryLabel, modelText.salaryVisible));
  const modelWorkTypeLabel = WORK_TYPE_OPTIONS.find(option => option.value === modelText.workType)?.label;
  const modelContractTypeLabel = modelText.contractTypeLabel.trim();
  const modelButtonText = modelText.buttonText.trim() || PUBLIC_APPLY_BUTTON_LABEL;
  const normalizedSelectorQuery = selectorQuery.trim().toLowerCase();
  const filteredModelOptions = normalizedSelectorQuery
    ? modelOptions.filter(option => option.searchText.includes(normalizedSelectorQuery))
    : modelOptions;

  if (modelOptions.length === 0) {
    return (
      <div className="w-full min-w-0 max-w-full rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <Briefcase className="mx-auto mb-3 h-10 w-10 text-slate-300" />
        <p className="text-sm font-medium text-slate-500">
          Nenhum cargo ou função disponível para configurar modelo.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-5 overflow-x-hidden">
      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-slate-950">Selecionar cargo ou função</h2>
            <p className="mt-1 text-xs text-slate-500">
              Cargos com funções vinculadas são configurados pela função. Cargos sem função continuam com modelo próprio.
            </p>
            <div className="relative mt-3 max-w-3xl">
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Cargo ou função</label>
              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 focus-within:ring-2 focus-within:ring-slate-900/10">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={selectorOpen ? selectorQuery : selectedOption?.label ?? ''}
                  onFocus={() => {
                    setSelectorOpen(true);
                    setSelectorQuery('');
                  }}
                  onChange={event => {
                    setSelectorQuery(event.target.value);
                    setSelectorOpen(true);
                  }}
                  onBlur={() => window.setTimeout(() => setSelectorOpen(false), 140)}
                  placeholder="Buscar cargo ou função..."
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                />
                {selectedOption ? (
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-500">
                    {selectedOption.kind === 'role' ? 'Cargo' : 'Função'}
                  </span>
                ) : null}
              </div>
              {selectorOpen ? (
                <div className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                  {filteredModelOptions.length > 0 ? filteredModelOptions.map(option => {
                    const optionQuestionCount = getModelOptionQuestions(option).length;
                    const optionHasModel = getModelOptionHasModel(option);
                    const isSelected = option.key === selectedOption?.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => {
                          setSelectedKey(option.key);
                          setSelectorQuery('');
                          setSelectorOpen(false);
                        }}
                        className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                          isSelected ? 'bg-[#EE6FA8] text-white' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{option.label}</span>
                          <span className={`block truncate text-xs ${isSelected ? 'text-white/70' : 'text-slate-500'}`}>
                            {option.subtitle}
                          </span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
                          isSelected ? 'bg-white/15 text-white' : optionHasModel ? 'bg-pink-50 text-[#993556]' : 'bg-slate-100 text-slate-400'
                        }`}>
                          {optionQuestionCount > 0 ? pluralizePt(optionQuestionCount, 'pergunta', 'perguntas') : optionHasModel ? 'modelo' : 'sem modelo'}
                        </span>
                      </button>
                    );
                  }) : (
                    <div className="px-3 py-4 text-sm text-slate-500">Nenhum resultado encontrado.</div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">
              {configuredModelOptions.length}/{modelOptions.length} com modelo
            </span>
            <a
              href={PUBLIC_RECRUITMENT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink className="h-4 w-4" />
              Ver no site
            </a>
            <button
              type="button"
              onClick={() => setShowModelsModal(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FolderOpen className="h-4 w-4" />
              Modelos
            </button>
          </div>
        </div>
      </section>

      <section className="min-w-0 space-y-3">
        <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-950">Modelo · {selected?.name ?? title}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Campos base ao criar uma vaga para este {modelLabel}. Organize em seções, adicione subperguntas e condições.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                {pluralizePt(primaryQuestionCount, 'pergunta', 'perguntas')}
              </span>
              <span className="rounded-full bg-pink-50 px-2.5 py-1 text-[11px] font-bold text-[#993556]">
                {pluralizePt(subquestionCount, 'subpergunta', 'subperguntas')}
              </span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                {pluralizePt(sectionCount, 'seção', 'seções')}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-400">
                {visibleQuestionCount}/{questions.length} visíveis
              </span>
            </div>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={saveModel}
              disabled={saving || !selected}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#EE6FA8] px-5 text-sm font-semibold text-white shadow-sm hover:bg-[#D9528E] disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Salvar modelo
            </button>
          )}
        </div>

        {error ? <div className="mt-4"><ErrorLine msg={error} /></div> : null}
        {savedAt ? (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            Modelo atualizado em {new Date(savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
          </p>
        ) : null}
      </section>

      <RecruitmentModernStepTabs
        steps={MODEL_EDITOR_STEPS}
        active={modelStep}
        onChange={setModelStep}
      />

      {modelStep !== 'form' && (
      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-slate-950">
              {modelStep === 'general' ? 'Informações gerais' : 'Página pública da vaga'}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {modelStep === 'general'
                ? `Dados operacionais usados quando uma vaga usa este ${modelLabel}.`
                : 'Textos e prévia da página pública apresentada ao candidato.'}
            </p>
          </div>
        </div>
        <div className={`grid min-w-0 gap-5 border-t border-slate-100 p-4 ${
          modelStep === 'public' ? 'xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]' : ''
        }`}>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <div className={modelStep === 'general' ? '' : 'hidden'}>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Título público</label>
              <input
                value={modelText.publicTitle}
                onChange={event => setModelText(prev => ({ ...prev, publicTitle: event.target.value }))}
                disabled={!canManage}
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                placeholder={selected?.name ?? 'Título público'}
              />
            </div>
            <div className={modelStep === 'general' ? '' : 'hidden'}>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Unidade/local padrão</label>
              <input
                value={modelText.locationLabel}
                onChange={event => setModelText(prev => ({ ...prev, locationLabel: event.target.value }))}
                disabled={!canManage}
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                placeholder="Ex: JK - São Paulo"
              />
            </div>
            <div className={modelStep === 'general' ? '' : 'hidden'}>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Jornada padrão</label>
              <input
                value={modelText.workSchedule}
                onChange={event => setModelText(prev => ({ ...prev, workSchedule: event.target.value }))}
                disabled={!canManage}
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                placeholder="Ex: Escala 6x1, fins de semana alternados"
              />
            </div>
            <div className={modelStep === 'general' ? '' : 'hidden'}>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Modalidade padrão</label>
              <select
                value={modelText.workType}
                onChange={event => setModelText(prev => ({ ...prev, workType: event.target.value }))}
                disabled={!canManage}
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
              >
                <option value="">Definir na vaga</option>
                {WORK_TYPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className={modelStep === 'general' ? '' : 'hidden'}>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Forma de contratação padrão</label>
              <input
                value={modelText.contractTypeLabel}
                onChange={event => setModelText(prev => ({ ...prev, contractTypeLabel: event.target.value }))}
                disabled={!canManage}
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                placeholder="Ex: CLT, PJ, temporário"
              />
            </div>
            <div className={modelStep === 'general' ? '' : 'hidden'}>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Período de inscrições padrão</label>
              <input
                value={modelText.deadlineLabel}
                onChange={event => setModelText(prev => ({ ...prev, deadlineLabel: event.target.value }))}
                disabled={!canManage}
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                placeholder="Ex: Inscrições de 01/07 a 15/07"
              />
            </div>
            <label className={modelStep === 'general' ? 'flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600' : 'hidden'}>
              <input
                type="checkbox"
                checked={modelText.salaryVisible}
                onChange={event => setModelText(prev => ({ ...prev, salaryVisible: event.target.checked }))}
                disabled={!canManage}
              />
              Mostrar salário na vaga
            </label>
            {modelText.salaryVisible && (
            <div className={modelStep === 'general' ? '' : 'hidden'}>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Salário</label>
              <input
                value={modelText.salaryLabel}
                onChange={event => setModelText(prev => ({ ...prev, salaryLabel: event.target.value }))}
                disabled={!canManage}
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                placeholder="Ex: R$ 1.800, R$ 1.800 a R$ 2.750 ou A combinar"
              />
            </div>
            )}
            <div className={modelStep === 'public' ? 'lg:col-span-2' : 'hidden'}>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Sobre a vaga</label>
              <textarea
                value={modelText.publicDescription}
                onChange={event => setModelText(prev => ({ ...prev, publicDescription: event.target.value }))}
                disabled={!canManage}
                rows={5}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                placeholder="Texto base que aparecerá na vaga pública."
              />
            </div>
            <div className={modelStep === 'public' ? 'lg:col-span-2' : 'hidden'}>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Requisitos e responsabilidades públicas</label>
              <textarea
                value={modelText.publicRequirements}
                onChange={event => setModelText(prev => ({ ...prev, publicRequirements: event.target.value }))}
                disabled={!canManage}
                rows={5}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                placeholder={'Um por linha\nAtendimento ao cliente\nDisponibilidade de horário\nExperiência com atendimento'}
              />
            </div>
            <div className={modelStep === 'public' ? '' : 'hidden'}>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Benefícios</label>
              <textarea
                value={modelText.benefits}
                onChange={event => setModelText(prev => ({ ...prev, benefits: event.target.value }))}
                disabled={!canManage}
                rows={4}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                placeholder={'Um por linha\nVale-transporte\nBonificações'}
              />
            </div>
            <div className={modelStep === 'public' ? 'lg:col-span-2' : 'hidden'}>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Mensagem após envio da candidatura</label>
              <textarea
                value={modelText.successMessage}
                onChange={event => setModelText(prev => ({ ...prev, successMessage: event.target.value }))}
                disabled={!canManage}
                rows={3}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                placeholder="Ex: Recebemos sua candidatura. A equipe de recrutamento vai analisar suas informações e entrar em contato quando houver atualização."
              />
            </div>
            <div className={modelStep === 'public' ? 'lg:col-span-2' : 'hidden'}>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Contrato LGPD da candidatura</label>
              <textarea
                value={modelText.lgpdContractText}
                onChange={event => setModelText(prev => ({ ...prev, lgpdContractText: event.target.value }))}
                disabled={!canManage}
                rows={5}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                placeholder="Texto completo do contrato/termo LGPD exibido ao candidato antes do envio."
              />
            </div>
          </div>

          <div className={modelStep === 'public' ? 'min-w-0 rounded-2xl border border-slate-200 bg-[#f0eee9] p-4' : 'hidden'}>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Prévia da página pública</p>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="bg-[#2A1F2A] p-4 text-white">
                <div className="flex flex-wrap gap-1.5">
                  {(modelText.locationLabel.trim() || 'Unidade definida na vaga') && (
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold">
                      {modelText.locationLabel.trim() || 'Unidade definida na vaga'}
                    </span>
                  )}
                  {(modelWorkTypeLabel || 'Modalidade na vaga') && (
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold">
                      {modelWorkTypeLabel || 'Modalidade na vaga'}
                    </span>
                  )}
                  {(modelSalaryPreview || 'Salário definido na vaga') && (
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold">
                      {modelSalaryPreview || 'Salário definido na vaga'}
                    </span>
                  )}
                  {(modelContractTypeLabel || 'Contratação na vaga') && (
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold">
                      {modelContractTypeLabel || 'Contratação na vaga'}
                    </span>
                  )}
                  {(modelText.deadlineLabel.trim() || 'Prazo definido na vaga') && (
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold">
                      {modelText.deadlineLabel.trim() || 'Prazo definido na vaga'}
                    </span>
                  )}
                </div>
                <h4 className="mt-4 text-2xl font-black leading-tight">
                  {modelText.publicTitle.trim() || selected?.name || 'Título da vaga'}
                </h4>
              </div>
              <div className="space-y-3 p-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Local</p>
                    <p className="mt-1 text-xs font-bold text-slate-700">{modelText.locationLabel.trim() || 'Unidade definida na vaga'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Jornada</p>
                    <p className="mt-1 text-xs font-bold text-slate-700">{modelText.workSchedule.trim() || 'Definida na vaga'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Contratação</p>
                    <p className="mt-1 text-xs font-bold text-slate-700">{modelContractTypeLabel || 'Definida na vaga'}</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Sobre a vaga</p>
                  <p className="whitespace-pre-line text-xs leading-relaxed text-slate-600">
                    {modelText.publicDescription.trim() || modelResponsibilities.join('\n') || 'Texto sobre a vaga aparecerá aqui.'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Requisitos</p>
                  <ul className="space-y-1.5">
                    {(modelRequirements.length ? modelRequirements : ['Disponibilidade de horário', 'Experiência com atendimento']).slice(0, 4).map(requirement => (
                      <li key={requirement} className="flex items-start gap-2 text-xs text-slate-600">
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                        {requirement}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl bg-pink-100 p-4">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-pink-500">Benefícios</p>
                  <div className="grid gap-1.5">
                    {(modelBenefits.length ? modelBenefits : ['Vale-transporte', 'Bonificações', 'Trilha de carreira']).slice(0, 5).map(benefit => (
                      <span key={benefit} className="text-xs font-bold text-slate-700">{benefit}</span>
                    ))}
                  </div>
                </div>
                <div className="rounded-full bg-pink-500 px-4 py-2 text-center text-xs font-bold text-white">
                  {modelButtonText}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      )}

      {modelStep === 'form' && (
      <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-950">Formulário</h3>
            <p className="mt-1 text-xs text-slate-500">
              Perguntas complementares exibidas para candidatos deste {modelLabel}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">
              {pluralizePt(primaryQuestionCount, 'pergunta', 'perguntas')}
            </span>
            <span className="rounded-full bg-pink-50 px-2.5 py-1 text-[11px] font-bold text-[#993556]">
              {pluralizePt(subquestionCount, 'subpergunta', 'subperguntas')}
            </span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
              {pluralizePt(sectionCount, 'seção', 'seções')}
            </span>
          </div>
        </div>

        <RecruitmentQuestionsDesigner
          questions={questions}
          canManage={canManage}
          variant="light"
          fallbackSectionTitle="Perguntas do modelo"
          emptyLabel="Nenhuma pergunta cadastrada neste modelo."
          activeLabel="Exibir no formulário"
          showActiveToggle
          showScoring
          sourceLayerResolver={() => kind}
          onUpdateQuestion={updateQuestion}
          onUpdateQuestionOptions={updateQuestionOptions}
          onMoveQuestion={moveQuestion}
          onRemoveQuestion={(questionId) => setQuestions(prev => prev.filter(item => item.id !== questionId))}
          onPrepareAddQuestion={(patch) => setDraft(prev => {
            const parentQuestion = patch.parentQuestionId
              ? questions.find(question => question.id === patch.parentQuestionId)
              : undefined;
            return {
              ...prev,
              ...(patch.parentQuestionId ? {
                text: '',
                optionsText: '',
                conditionValue: (parentQuestion?.type === 'yes_no' ? 'true' : 'always') as QuestionDraftConditionValue,
              } : {}),
              sectionTitle: patch.sectionTitle !== undefined ? patch.sectionTitle : prev.sectionTitle,
              parentQuestionId: patch.parentQuestionId ?? '',
            };
          })}
          inlineDraft={draft}
          onInlineDraftChange={(patch) => setDraft(prev => ({ ...prev, ...patch }))}
          onInlineDraftAdd={addQuestion}
          onInlineDraftCancel={() => setDraft(EMPTY_QUESTION_DRAFT)}
        />

        {canManage && (
        <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-bold text-slate-950">Adicionar campo ao modelo</h3>
          <div className="mt-4">
            <QuestionDraftSectionControls
              draft={draft}
              questions={questions}
              onChange={(patch) => setDraft(prev => ({ ...prev, ...patch }))}
            />
          </div>
          <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,180px)_minmax(0,180px)]">
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Pergunta</label>
              <input
                value={draft.text}
                onChange={event => setDraft(prev => ({ ...prev, text: event.target.value }))}
                placeholder="Ex: Tem disponibilidade aos domingos?"
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Tipo</label>
              <select
                value={draft.type}
                onChange={event => setDraft(prev => ({ ...prev, type: event.target.value as HrFormQuestion['type'] }))}
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10"
              >
                {QUESTION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Hierarquia</label>
              <select
                value={draft.parentQuestionId}
                onChange={event => setDraft(prev => ({ ...prev, parentQuestionId: event.target.value }))}
                disabled={questions.length === 0}
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
              >
                <option value="">Pergunta principal</option>
                {questions.map(question => (
                  <option key={question.id} value={question.id}>Subpergunta de: {question.text}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-end gap-3 pb-1">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={draft.required} onChange={event => setDraft(prev => ({ ...prev, required: event.target.checked }))} />
                Obrigatório
              </label>
            </div>
            <QuestionDraftConditionControls
              draft={draft}
              parentQuestion={questions.find(question => question.id === draft.parentQuestionId)}
              onChange={(patch) => setDraft(prev => ({ ...prev, ...patch }))}
            />
            <QuestionDraftScoringControls
              draft={draft}
              onChange={(patch) => setDraft(prev => ({ ...prev, ...patch }))}
            />
            {(draft.type === 'select' || draft.type === 'multi_select') && (
              <textarea
                value={draft.optionsText}
                onChange={event => setDraft(prev => ({ ...prev, optionsText: event.target.value }))}
                rows={3}
                placeholder={'Opções, uma por linha\nSim\nNão\nTalvez'}
                className="resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 lg:col-span-3"
              />
            )}
            <button
              type="button"
              onClick={addQuestion}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#EE6FA8] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#D9528E] lg:col-span-3"
            >
              <Plus className="h-4 w-4" /> Adicionar campo
            </button>
          </div>
        </div>
        )}
      </section>
      )}

      {showModelsModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div>
                <h3 className="text-base font-bold text-slate-950">Modelos cadastrados</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Selecione um cargo ou função para abrir o modelo salvo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModelsModal(false)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-3">
              {configuredModelOptions.length > 0 ? (
                <div className="space-y-2">
                  {configuredModelOptions.map(option => {
                    const optionQuestions = getModelOptionQuestions(option);
                    const isSelected = option.key === selectedOption?.key;
                    const primaryQuestions = optionQuestions.filter(question => !question.parentQuestionId).length;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => {
                          setSelectedKey(option.key);
                          setShowModelsModal(false);
                        }}
                        className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
                          isSelected
                            ? 'border-[#EE6FA8] bg-[#EE6FA8] text-white'
                            : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-bold">{option.label}</span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              isSelected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {option.kind === 'role' ? 'Cargo' : 'Função'}
                            </span>
                          </span>
                          <span className={`mt-1 block truncate text-xs ${isSelected ? 'text-white/70' : 'text-slate-500'}`}>
                            {option.subtitle}
                          </span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                          isSelected ? 'bg-white/15 text-white' : 'bg-pink-50 text-[#993556]'
                        }`}>
                          {primaryQuestions > 0 ? pluralizePt(primaryQuestions, 'pergunta', 'perguntas') : 'Informações gerais'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Nenhum modelo cadastrado ainda.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RecruitmentFormsView({ getToken, canManage, roles, functions, onModelsUpdated }: {
  getToken: () => Promise<string>;
  canManage: boolean;
  roles: JobRole[];
  functions: JobFunction[];
  onModelsUpdated: () => void;
}) {
  const [formSection, setFormSection] = useState<'talent' | 'models' | 'integration'>(() => {
    if (typeof window === 'undefined') return 'talent';
    const requested = new URLSearchParams(window.location.search).get('section');
    return requested === 'integration' || requested === 'models' || requested === 'talent'
      ? requested
      : 'talent';
  });
  const [talentStep, setTalentStep] = useState<TalentPoolEditorStep>('general');
  const [form, setForm] = useState<RecruitmentFormConfig>(DEFAULT_TALENT_POOL_FORM);
  const [questionDraft, setQuestionDraft] = useState(EMPTY_QUESTION_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const activeQuestionCount = form.questions.filter(question => question.active !== false).length;

  const loadForm = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/hr/recruitment/forms/talent-pool', getToken);
      setForm(data as RecruitmentFormConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar formulário.');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { loadForm(); }, [loadForm]);

  const updateQuestion = (questionId: string, patch: Partial<HrFormQuestion>) => {
    setForm(prev => ({
      ...prev,
      questions: prev.questions.map(question => question.id === questionId ? { ...question, ...patch } : question),
    }));
  };

  const updateQuestionOptions = (questionId: string, optionsText: string) => {
    const options = optionsText
      .split('\n')
      .map(option => option.trim())
      .filter(Boolean);
    setForm(prev => ({
      ...prev,
      questions: prev.questions.map(question => {
        if (question.id !== questionId) return question;
        return {
          ...question,
          config: {
            ...(question.config ?? {}),
            options,
          },
        };
      }),
    }));
  };

  const removeQuestion = (questionId: string) => {
    setForm(prev => ({ ...prev, questions: prev.questions.filter(question => question.id !== questionId) }));
  };

  const moveQuestion = (questionId: string, direction: -1 | 1) => {
    setForm(prev => {
      const index = prev.questions.findIndex(question => question.id === questionId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.questions.length) return prev;
      const next = [...prev.questions];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return { ...prev, questions: next };
    });
  };

  const addQuestion = () => {
    const text = questionDraft.text.trim();
    if (!questionDraft.sectionTitle.trim()) {
      setError('Selecione ou crie uma seção antes de adicionar a pergunta.');
      return;
    }
    if (!text) return;
    const options = questionDraft.optionsText
      .split('\n')
      .map(option => option.trim())
      .filter(Boolean);
    if ((questionDraft.type === 'select' || questionDraft.type === 'multi_select') && options.length === 0) {
      setError('Informe ao menos uma opção para campos de seleção.');
      return;
    }

    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `question-${Date.now()}`;
    setForm(prev => {
      const parentQuestion = prev.questions.find(question => question.id === questionDraft.parentQuestionId);
      const conditions = conditionFromDraft(parentQuestion, questionDraft.conditionValue);
      return {
        ...prev,
        questions: [
          ...prev.questions,
          {
            id,
            text,
            type: questionDraft.type,
            ...questionSectionFromDraft(questionDraft.sectionTitle),
            parentQuestionId: questionDraft.parentQuestionId || undefined,
            ...(conditions ? { conditions } : {}),
            required: questionDraft.required,
            active: true,
            ...questionScoringFromDraft(questionDraft, 'role'),
            tags: ['talent_pool'],
            config: options.length > 0 ? { options } : undefined,
          },
        ],
      };
    });
    setQuestionDraft(EMPTY_QUESTION_DRAFT);
    setError(null);
  };

  const saveForm = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await apiFetch('/api/hr/recruitment/forms/talent-pool', getToken, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      setForm(saved as RecruitmentFormConfig);
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar formulário.');
    } finally {
      setSaving(false);
    }
  };

  const dynamicRoleFunctionOptions = useMemo(() => {
    const roleOptions = roles
      .filter(role => role.isActive !== false)
      .map(role => (role.publicTitle || role.name || '').trim())
      .filter(Boolean)
      .map(label => `Cargo · ${label}`);
    const functionOptions = functions
      .filter(item => item.isActive !== false)
      .map(item => (item.publicTitle || item.name || '').trim())
      .filter(Boolean)
      .map(label => `Função · ${label}`);
    return Array.from(new Set([...roleOptions, ...functionOptions]))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [roles, functions]);
  const dynamicDepartmentOptions = useMemo(() => {
    const names = [
      ...roles.map(role => role.departmentName),
      ...functions.map(item => item.departmentName),
    ]
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      .map(name => name.trim());
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [roles, functions]);
  const dynamicCityOptions = useMemo(() => ['São Luís'], []);

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  const formTabs = (
    <RecruitmentFormSectionTabs
      active={formSection}
      onChange={setFormSection}
    />
  );
  const talentPrimaryQuestionCount = form.questions.filter(question => !question.parentQuestionId).length;
  const talentSubquestionCount = form.questions.filter(question => question.parentQuestionId).length;
  const talentSectionCount = groupRecruitmentQuestionsBySection(form.questions, 'Campos personalizados').length;
  const fixedFieldCount = 5;

  if (formSection === 'models') {
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1240px] space-y-5 overflow-x-hidden">
        {formTabs}
        <RecruitmentQuestionModelEditor
          roles={roles}
          functions={functions}
          getToken={getToken}
          canManage={canManage}
          onSaved={onModelsUpdated}
        />
      </div>
    );
  }

  if (formSection === 'integration') {
    return (
      <div className="w-full min-w-0 max-w-full space-y-5 overflow-x-hidden">
        {formTabs}
        <IntegrationTemplateManager
          roles={roles}
          functions={functions}
          getToken={getToken}
          canManage={canManage}
          onSaved={onModelsUpdated}
        />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-5 overflow-x-hidden">
      {formTabs}
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Formulário público</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">Banco de talentos</h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <a
            href={`${PUBLIC_RECRUITMENT_URL}/banco-de-talentos`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
          >
            <ExternalLink className="h-4 w-4" /> Ver no site
          </a>
          {canManage && (
            <button
              type="button"
              onClick={saveForm}
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-[#EE6FA8] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#D9528E] disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Salvar alterações
            </button>
          )}
        </div>
      </div>

      {error ? <ErrorLine msg={error} /> : null}
      {savedAt ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          Formulário atualizado em {new Date(savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
        </p>
      ) : null}

      <RecruitmentModernStepTabs
        steps={TALENT_POOL_EDITOR_STEPS}
        active={talentStep}
        onChange={setTalentStep}
      />

      {talentStep === 'general' && (
      <>
      <div>
        <p className="mb-2 text-xs font-bold text-slate-700">Resumo</p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <RecruitmentMetricCard
            label="Status"
            value={form.status === 'published' ? 'Publicado' : 'Rascunho'}
            description="Versão pública"
            tone={form.status === 'published' ? 'emerald' : 'slate'}
          />
          <RecruitmentMetricCard
            label="Perguntas ativas"
            value={activeQuestionCount}
            description={pluralizePt(form.questions.length, 'campo total', 'campos totais')}
            tone="violet"
          />
          <RecruitmentMetricCard
            label="Subperguntas"
            value={talentSubquestionCount}
            description="Dependem de respostas"
          />
          <RecruitmentMetricCard
            label="Campos fixos"
            value={fixedFieldCount}
            description="Sempre exibidos"
          />
        </div>
      </div>

      <section className="min-w-0 space-y-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-950">Textos do formulário</h3>
            <p className="mt-1 text-xs text-slate-500">Configure os textos públicos da página de cadastro.</p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={saveForm}
              disabled={saving}
              className="hidden h-8 items-center gap-2 rounded-full bg-[#EE6FA8] px-3 text-xs font-semibold text-white shadow-sm hover:bg-[#D9528E] disabled:opacity-60 md:inline-flex"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Salvar alterações
            </button>
          )}
        </div>
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Título</label>
              <input
                value={form.title}
                onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))}
                disabled={!canManage}
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Descrição</label>
              <textarea
                value={form.description ?? ''}
                onChange={event => setForm(prev => ({ ...prev, description: event.target.value }))}
                disabled={!canManage}
                rows={3}
                className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Texto curto LGPD</label>
              <textarea
                value={form.consentText ?? ''}
                onChange={event => setForm(prev => ({ ...prev, consentText: event.target.value }))}
                disabled={!canManage}
                rows={3}
                className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Mensagem após envio</label>
              <textarea
                value={form.successMessage ?? ''}
                onChange={event => setForm(prev => ({ ...prev, successMessage: event.target.value }))}
                disabled={!canManage}
                rows={3}
                className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                placeholder="Mensagem exibida depois que o candidato envia o cadastro."
              />
            </div>
            <div className="lg:col-span-2">
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Contrato LGPD</label>
              <textarea
                value={form.lgpdContractText ?? ''}
                onChange={event => setForm(prev => ({ ...prev, lgpdContractText: event.target.value }))}
                disabled={!canManage}
                rows={5}
                className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                placeholder="Texto completo do contrato/termo LGPD exibido ao candidato antes do envio."
              />
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-600 lg:col-span-2">
              <input
                type="checkbox"
                checked={form.status === 'published'}
                onChange={event => setForm(prev => ({ ...prev, status: event.target.checked ? 'published' : 'draft' }))}
                disabled={!canManage}
                className="h-4 w-4 rounded border-slate-300"
              />
              Usar esta versão no site
            </label>
          </div>
        </div>
      </section>
      </>
      )}

      {talentStep === 'fixed' && (
      <section className="min-w-0 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-slate-950">Campos fixos</h3>
          <p className="mt-1 text-xs text-slate-500">Sempre presentes no formulário para proteger o fluxo público. Não podem ser removidos.</p>
        </div>
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
          {['Nome completo', 'E-mail', 'Telefone / WhatsApp', 'Currículo', 'Consentimento LGPD'].map((item, index) => (
            <div key={item} className="flex items-center justify-between border-b border-slate-100 px-4 py-3 last:border-b-0">
              <div className="flex items-center gap-3">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">
                  {index + 1}
                </span>
                <span className="text-sm font-medium text-slate-700">{item}</span>
              </div>
              <span className="text-[11px] font-medium text-slate-400">Fixo</span>
            </div>
          ))}
        </div>
      </section>
      )}

      {talentStep === 'form' && (
      <>
      <section className="min-w-0 space-y-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-950">Campos personalizados</h3>
            <p className="mt-1 text-xs text-slate-500">Perguntas adicionais com seções, subperguntas e condições de exibição.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                {pluralizePt(talentPrimaryQuestionCount, 'pergunta', 'perguntas')}
              </span>
              <span className="rounded-full bg-pink-50 px-2.5 py-1 text-[11px] font-bold text-[#993556]">
                {pluralizePt(talentSubquestionCount, 'subpergunta', 'subperguntas')}
              </span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                {pluralizePt(talentSectionCount, 'seção', 'seções')}
              </span>
            </div>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">
            {activeQuestionCount}/{form.questions.length} visíveis
          </span>
        </div>

        <RecruitmentQuestionsDesigner
          questions={form.questions}
          canManage={canManage}
          variant="light"
          fallbackSectionTitle="Campos personalizados"
          emptyLabel="Nenhum campo complementar cadastrado."
          activeLabel="Exibir no site"
          showActiveToggle
          dynamicRoleFunctionOptions={dynamicRoleFunctionOptions}
          dynamicDepartmentOptions={dynamicDepartmentOptions}
          dynamicCityOptions={dynamicCityOptions}
          onUpdateQuestion={updateQuestion}
          onUpdateQuestionOptions={updateQuestionOptions}
          onMoveQuestion={moveQuestion}
          onRemoveQuestion={removeQuestion}
          onPrepareAddQuestion={(patch) => setQuestionDraft(prev => {
            const parentQuestion = patch.parentQuestionId
              ? form.questions.find(question => question.id === patch.parentQuestionId)
              : undefined;
            return {
              ...prev,
              ...(patch.parentQuestionId ? {
                text: '',
                optionsText: '',
                conditionValue: (parentQuestion?.type === 'yes_no' ? 'true' : 'always') as QuestionDraftConditionValue,
              } : {}),
              sectionTitle: patch.sectionTitle !== undefined ? patch.sectionTitle : prev.sectionTitle,
              parentQuestionId: patch.parentQuestionId ?? '',
            };
          })}
          inlineDraft={questionDraft}
          onInlineDraftChange={(patch) => setQuestionDraft(prev => ({ ...prev, ...patch }))}
          onInlineDraftAdd={addQuestion}
          onInlineDraftCancel={() => setQuestionDraft(EMPTY_QUESTION_DRAFT)}
        />
      </section>

      {canManage && (
        <section className="min-w-0 space-y-3">
          <h3 className="text-sm font-bold text-slate-950">Adicionar campo</h3>
          <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <QuestionDraftSectionControls
              draft={questionDraft}
              questions={form.questions}
              onChange={(patch) => setQuestionDraft(prev => ({ ...prev, ...patch }))}
            />
            <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,180px)_minmax(0,180px)]">
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Pergunta</label>
                <input
                  value={questionDraft.text}
                  onChange={event => setQuestionDraft(prev => ({ ...prev, text: event.target.value }))}
                  placeholder="Ex: Tem disponibilidade aos domingos?"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Tipo</label>
                <select
                  value={questionDraft.type}
                  onChange={event => setQuestionDraft(prev => ({ ...prev, type: event.target.value as HrFormQuestion['type'] }))}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10"
                >
                  {QUESTION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </div>
              <div className="lg:col-span-2">
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Hierarquia</label>
                <select
                  value={questionDraft.parentQuestionId}
                  onChange={event => setQuestionDraft(prev => ({ ...prev, parentQuestionId: event.target.value }))}
                  disabled={form.questions.length === 0}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
                >
                  <option value="">Pergunta principal</option>
                  {form.questions.map(question => (
                    <option key={question.id} value={question.id}>Subpergunta de: {question.text}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-end gap-3 pb-1">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={questionDraft.required}
                    onChange={event => setQuestionDraft(prev => ({ ...prev, required: event.target.checked }))}
                  />
                  Obrigatório
                </label>
              </div>
              <QuestionDraftConditionControls
                draft={questionDraft}
                parentQuestion={form.questions.find(question => question.id === questionDraft.parentQuestionId)}
                onChange={(patch) => setQuestionDraft(prev => ({ ...prev, ...patch }))}
              />
              <QuestionDraftScoringControls
                draft={questionDraft}
                onChange={(patch) => setQuestionDraft(prev => ({ ...prev, ...patch }))}
              />
              {(questionDraft.type === 'select' || questionDraft.type === 'multi_select') && (
                <textarea
                  value={questionDraft.optionsText}
                  onChange={event => setQuestionDraft(prev => ({ ...prev, optionsText: event.target.value }))}
                  rows={3}
                  placeholder={'Opções, uma por linha\nSim\nNão\nTalvez'}
                  className="resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 lg:col-span-3"
                />
              )}
              <button
                type="button"
                onClick={addQuestion}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#EE6FA8] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#D9528E] lg:col-span-3"
              >
                <Plus className="h-4 w-4" /> Adicionar campo
              </button>
            </div>
          </div>
        </section>
      )}
      </>
      )}
    </div>
  );
}

// ─── OnboardingView ──────────────────────────────────────────────────────────

const ONBOARDING_STATUS_LABELS: Record<OnboardingProcess['status'], string> = {
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
  ai_approved: 'Aprovado pelo copiloto',
  review_required: 'Revisão do gestor',
  approved: 'Aprovado pelo RH',
  rejected: 'Reprovado',
};

const ONBOARDING_STAGE_DETAILS: Record<OnboardingStageId, { owner: string; focus: string }> = {
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
};

type SignatureWorkflowPayload = {
  templates: SignatureTemplateOption[];
  documents: SignatureWorkflowDocument[];
};

function applicableSignatureTemplateIds(
  workflow: SignatureWorkflowPayload,
  transportVoucherAnswer: unknown,
) {
  return new Set(
    workflow.templates
      .filter((template) =>
        isAdmissionSignatureTemplateApplicable(template, transportVoucherAnswer)
      )
      .map((template) => template.id),
  );
}

function selectedApplicableSignatureTemplateIds(
  workflow: SignatureWorkflowPayload,
  transportVoucherAnswer: unknown,
) {
  const applicableIds = applicableSignatureTemplateIds(workflow, transportVoucherAnswer);
  return workflow.documents
    .filter((document) => document.selected && applicableIds.has(document.templateId))
    .map((document) => document.templateId);
}

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

type AsoPaymentWorkflowPatch = Pick<NonNullable<OnboardingProcess['asoWorkflow']>,
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

function candidateInitials(name?: string | null) {
  return (name ?? 'IN')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || 'IN';
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

type OnboardingProcessScope = 'active' | 'completed' | 'cancelled';
type OnboardingPageInfo = Record<OnboardingProcessScope, {
  limit: number;
  hasMore: boolean;
  cursorId: string | null;
}>;

function OnboardingView({ processes, pageInfo, loadingMoreScope, roles, jobFunctions, units, shiftDefinitions, getToken, canManage, canViewAso, canManageAso, canViewAccountant, canManageAccountant, canViewSensitiveData, canViewSignatures, canGenerateDocuments, canReviewDocuments, canSendSignatures, onRefresh, onLoadMore, onProcessUpdated, onAsoPaymentUpdated, onAsoWorkflowUpdated }: {
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
  const [selectedSignatureTemplateIds, setSelectedSignatureTemplateIds] = useState<string[]>([]);
  const [signatureBusy, setSignatureBusy] = useState<string | null>(null);
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
      setSelectedSignatureTemplateIds(
        selectedApplicableSignatureTemplateIds(
          payload,
          selectedProcess.publicFormAnswers?.wantsTransportVoucher,
        )
      );
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
    const signaturePending = signatureWorkflow?.documents.some(document =>
      document.selected && ['sent', 'viewed', 'partially_signed', 'signed'].includes(document.status)
    ) ?? false;
    const accessPending = Boolean(
      selectedProcess?.collaboratorUserId
      && selectedProcess.accessProvisioning?.status !== 'completed'
      && selectedProcess.status !== 'cancelled'
      && selectedProcess.status !== 'completed'
    );
    if ((!signaturePending && !accessPending) || !selectedProcess?.id || view !== 'detail') return;
    const refreshPendingState = () => {
      if (signaturePending) void loadSignatureWorkflow();
      void refreshSelectedProcess();
    };
    const timer = window.setInterval(refreshPendingState, 10_000);
    return () => window.clearInterval(timer);
  }, [loadSignatureWorkflow, refreshSelectedProcess, selectedProcess?.accessProvisioning?.status, selectedProcess?.collaboratorUserId, selectedProcess?.id, selectedProcess?.status, signatureWorkflow?.documents, view]);

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
      setSelectedSignatureTemplateIds(
        selectedApplicableSignatureTemplateIds(
          payload,
          selectedProcess.publicFormAnswers?.wantsTransportVoucher,
        )
      );
      onRefresh();
      return payload;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha no fluxo de assinatura.');
      return null;
    } finally {
      setSignatureBusy(null);
    }
  }

  async function generateSelectedSignatureTemplates() {
    if (!selectedProcess || selectedSignatureTemplateIds.length === 0) return;
    const selected = await signatureAction('select', { templateIds: selectedSignatureTemplateIds });
    if (!selected) return;
    await signatureAction('generate');
  }

  async function downloadSignatureDocument(documentId: string, kind: 'generated' | 'signed') {
    if (!selectedProcess) return;
    setSignatureBusy(`download:${documentId}:${kind}`);
    setError(null);
    try {
      const token = await getToken();
      const response = await fetch(
        `/api/hr/onboarding/${selectedProcess.id}/signature-documents?documentId=${encodeURIComponent(documentId)}&download=${kind}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Arquivo indisponível.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const fileName = encodedName ? decodeURIComponent(encodedName) : kind === 'signed' ? 'documento-assinado.pdf' : 'documento.docx';
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao baixar documento.');
    } finally {
      setSignatureBusy(null);
    }
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
  const signatureTemplates = (signatureWorkflow?.templates ?? []).filter((template) =>
    isAdmissionSignatureTemplateApplicable(
      template,
      selectedProcess.publicFormAnswers?.wantsTransportVoucher,
    )
  );
  const allSignatureTemplatesSelected = signatureTemplates.length > 0
    && signatureTemplates.every(template => selectedSignatureTemplateIds.includes(template.id));
  const someSignatureTemplatesSelected = signatureTemplates.some(template =>
    selectedSignatureTemplateIds.includes(template.id)
  );
  const applicableSignatureIds = new Set(signatureTemplates.map((template) => template.id));
  const selectedSignatureDocuments = (signatureWorkflow?.documents ?? []).filter(
    (document) => document.selected && applicableSignatureIds.has(document.templateId)
  );
  const signatureDocumentsReadyToSend = selectedSignatureDocuments.filter(document => document.status === 'ready_to_send');
  const signatureGenerated = selectedSignatureDocuments.length > 0
    && selectedSignatureDocuments.every(document => Boolean(document.generatedDocumentId));
  const signatureReviewed = selectedSignatureDocuments.length > 0
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
  const signatureMainSteps = [
    { label: 'Selecionar e gerar', done: signatureGenerated },
    { label: 'Revisar no RH', done: signatureReviewed },
    { label: 'Enviar', done: signatureSent },
    { label: 'Assinar e arquivar', done: signatureCompleted },
  ];
  const signatureCurrentStepIndex = signatureMainSteps.findIndex(step => !step.done);
  const signatureSelectionEditable = canGenerateDocumentsProcess && canActOnSignaturePhase && activePhaseId === 'signature_preparation' &&
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
                  {!okAlert ? ([bizneoAlert, pdvAlert].filter(Boolean) as NonNullable<typeof bizneoAlert>[]).map(alert => (
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
                    { name: 'PDV Legal', desc: 'Habilita operação no ponto de venda.', alert: pdvAlert },
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
                      },
                      {
                        id: 'transportVoucherSystem' as const,
                        label: 'Sistema de vale-transporte',
                        description: 'Cadastro confirmado no sistema de VT.',
                        completed: selectedProcess.accessProvisioning?.operationalChecks?.transportVoucherSystem?.completed === true,
                      },
                    ].map(check => (
                      <label
                        key={check.id}
                        className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 transition ${
                          check.completed
                            ? 'border-emerald-200 bg-emerald-50'
                            : 'border-slate-200 bg-slate-50'
                        } ${canManage && canActOnCurrentPhase && userCreated ? 'cursor-pointer hover:border-pink-200' : 'cursor-not-allowed opacity-70'}`}
                      >
                        <input
                          type="checkbox"
                          checked={check.completed}
                          disabled={!canManage || !canActOnCurrentPhase || !userCreated || updating === `${selectedProcess.id}:set_access_operational_check`}
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
                            {check.completed ? 'Concluído' : check.description}
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
                      <p className="mt-1 text-xs font-semibold text-slate-500">Selecione os modelos, gere e revise os documentos, envie para assinatura e acompanhe o arquivamento.</p>
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
                        <p className="text-xs font-black uppercase tracking-wide text-violet-800">1. Selecione os modelos</p>
                        <p className="mt-1 text-xs font-semibold text-violet-700">Escolha os documentos que serão gerados para este titular.</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void loadSignatureWorkflow()}
                          className="grid h-8 w-8 place-items-center rounded-lg border border-violet-200 bg-white text-violet-600 hover:bg-violet-50"
                          title="Atualizar documentos"
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </button>
                        <label className={`inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-[10px] font-black text-violet-700 ${
                          signatureSelectionEditable && !signatureBusy ? 'cursor-pointer hover:bg-violet-50' : 'cursor-not-allowed opacity-60'
                        }`}>
                          <input
                            type="checkbox"
                            checked={allSignatureTemplatesSelected}
                            ref={input => {
                              if (input) input.indeterminate = someSignatureTemplatesSelected && !allSignatureTemplatesSelected;
                            }}
                            disabled={!signatureSelectionEditable || !!signatureBusy || signatureTemplates.length === 0}
                            onChange={event => setSelectedSignatureTemplateIds(
                              event.target.checked ? signatureTemplates.map(template => template.id) : []
                            )}
                          />
                          Selecionar todos
                        </label>
                        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-violet-700">
                          {selectedSignatureTemplateIds.length} selecionado{selectedSignatureTemplateIds.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {signatureTemplates.map((template, index) => {
                        const checked = selectedSignatureTemplateIds.includes(template.id);
                        const workflowDocument = checked
                          ? selectedSignatureDocuments.find(document => document.templateId === template.id)
                          : undefined;
                        const failed = workflowDocument
                          ? ['generation_failed', 'generation_blocked', 'send_failed', 'delivery_failed', 'rejected'].includes(workflowDocument.status)
                          : false;
                        return (
                          <div key={template.id} className={`rounded-xl border p-3 ${checked ? 'border-violet-300 bg-white' : 'border-slate-200 bg-white/60'}`}>
                            <label className={`flex items-start gap-2.5 ${signatureSelectionEditable && !signatureBusy ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!signatureSelectionEditable || !!signatureBusy}
                                onChange={event => setSelectedSignatureTemplateIds(current => {
                                  const next = new Set(current);
                                  if (event.target.checked) next.add(template.id);
                                  else next.delete(template.id);
                                  return signatureTemplates
                                    .filter(option => next.has(option.id))
                                    .map(option => option.id);
                                })}
                                className="mt-0.5"
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-[12.5px] font-black text-slate-900">{index + 1}. {template.name}</span>
                                <span className="mt-0.5 block text-[10.5px] font-semibold text-slate-500">{template.category} · versão {template.version}</span>
                              </span>
                            </label>
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
                                  {workflowDocument.generatedStoragePath ? (
                                    <button
                                      type="button"
                                      disabled={!!signatureBusy}
                                      onClick={() => void downloadSignatureDocument(workflowDocument.id, 'generated')}
                                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-[10.5px] font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      <Download className="h-3.5 w-3.5" />Baixar Word
                                    </button>
                                  ) : null}
                                  {canReviewDocuments && canActOnSignaturePhase && workflowDocument.status === 'review_pending' ? (
                                    <button
                                      type="button"
                                      disabled={!!signatureBusy}
                                      onClick={() => void signatureAction('approve', { documentId: workflowDocument.id })}
                                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 text-[10.5px] font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />Revisado
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
                    {canGenerateDocumentsProcess ? (
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          disabled={!signatureSelectionEditable || selectedSignatureTemplateIds.length === 0 || !!signatureBusy}
                          onClick={() => void generateSelectedSignatureTemplates()}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 text-[11px] font-black text-white hover:bg-violet-600 disabled:opacity-50"
                        >
                          {signatureBusy === 'select' || signatureBusy === 'generate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                          Gerar selecionados
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activePhaseId !== 'signature_preparation' ? selectedSignatureDocuments.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-black uppercase tracking-wide text-slate-600">Acompanhamento da assinatura</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">Os indicadores são atualizados automaticamente pelo Autentique.</p>
                      </div>
                      <button type="button" onClick={() => void loadSignatureWorkflow()} className="grid h-8 w-8 place-items-center rounded-lg border bg-white text-slate-500" title="Atualizar">
                        <RotateCw className={`h-3.5 w-3.5 ${signatureBusy === 'refresh' ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                    {selectedSignatureDocuments.map(document => {
                      const generated = !!document.generatedDocumentId;
                      const sent = ['sent', 'viewed', 'partially_signed', 'signed', 'signed_archived_pending_employee', 'archived'].includes(document.status);
                      const viewed = ['viewed', 'partially_signed', 'signed', 'signed_archived_pending_employee', 'archived'].includes(document.status) || !!document.viewedAt;
                      const signed = ['partially_signed', 'signed', 'signed_archived_pending_employee', 'archived'].includes(document.status) || !!document.signedAt;
                      const archived = ['signed_archived_pending_employee', 'archived'].includes(document.status) || !!document.archivedAt;
                      const failed = ['generation_failed', 'generation_blocked', 'send_failed', 'delivery_failed', 'rejected'].includes(document.status);
                      return (
                        <div key={document.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-[13.5px] font-black text-slate-900">{document.documentName ?? document.templateName}</p>
                              <p className={`mt-1 text-[11px] font-bold ${failed ? 'text-rose-600' : archived ? 'text-emerald-700' : 'text-slate-500'}`}>
                                {SIGNATURE_WORKFLOW_STATUS_LABELS[document.status] ?? document.status}
                              </p>
                              {document.lastError ? <p className="mt-1 text-[10.5px] font-semibold text-rose-600">{document.lastError}</p> : null}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {document.generatedPdfStoragePath ? (
                                <button type="button" disabled={!!signatureBusy} onClick={() => void viewSignatureDocument(document.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-[10.5px] font-black text-violet-700">
                                  <Eye className="h-3.5 w-3.5" />Visualizar
                                </button>
                              ) : null}
                              {generated && document.generatedStoragePath ? (
                                <button type="button" disabled={!!signatureBusy} onClick={() => void downloadSignatureDocument(document.id, 'generated')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-[10.5px] font-black text-slate-700">
                                  <Download className="h-3.5 w-3.5" />Baixar Word
                                </button>
                              ) : null}
                              {archived ? (
                                <button type="button" disabled={!!signatureBusy} onClick={() => void downloadSignatureDocument(document.id, 'signed')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[10.5px] font-black text-emerald-700">
                                  <Download className="h-3.5 w-3.5" />PDF assinado
                                </button>
                              ) : null}
                              {canReviewDocuments && canActOnSignaturePhase && document.status === 'review_pending' ? (
                                <button type="button" disabled={!!signatureBusy} onClick={() => void signatureAction('approve', { documentId: document.id })} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 text-[10.5px] font-black text-white">
                                  <CheckCircle2 className="h-3.5 w-3.5" />Revisado
                                </button>
                              ) : null}
                            </div>
                          </div>
                          {sent ? (
                            <div className="mt-3 grid grid-cols-4 gap-1.5">
                              {[
                                { label: 'Enviado', done: sent, icon: Send },
                                { label: 'Aberto', done: viewed, icon: Eye },
                                { label: 'Assinado', done: signed, icon: CheckCircle2 },
                                { label: 'Arquivado', done: archived, icon: Archive },
                              ].map(indicator => (
                                <div key={indicator.label} className={`rounded-lg border px-2 py-2 text-center ${indicator.done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
                                  <indicator.icon className="mx-auto h-3.5 w-3.5" />
                                  <p className="mt-1 text-[9.5px] font-black">{indicator.label}</p>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5">
                    <p className="text-sm font-black text-slate-800">Nenhum documento selecionado.</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Selecione os modelos na preparação para iniciar a geração.</p>
                  </div>
                ) : null}

                {canSendSignatures && canActOnSignaturePhase && signatureDocumentsReadyToSend.length > 0 ? (
                  <button
                    type="button"
                    disabled={!!signatureBusy}
                    onClick={() => void signatureAction('send', { documentIds: signatureDocumentsReadyToSend.map(document => document.id) })}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-pink-600 text-[12.5px] font-black text-white shadow-lg shadow-pink-600/20 hover:bg-pink-700 disabled:opacity-50"
                  >
                    {signatureBusy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Enviar {signatureDocumentsReadyToSend.length} documento{signatureDocumentsReadyToSend.length === 1 ? '' : 's'} para assinatura
                  </button>
                ) : null}

                {selectedSignatureDocuments.length > 0 && selectedSignatureDocuments.every(document => ['signed', 'signed_archived_pending_employee', 'archived'].includes(document.status)) ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
                    Todos os documentos foram assinados. O sistema arquivou os PDFs e liberou automaticamente a próxima fase.
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

// ─── RecruitmentShell ─────────────────────────────────────────────────────────

export function RecruitmentShell({ section = 'jobs' }: { section?: RecruitmentSection }) {
  const { firebaseUser, permissions, loading: authLoading } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [functions, setFunctions] = useState<JobFunction[]>([]);
  const [units, setUnits] = useState<DPUnit[]>([]);
  const [shiftDefinitions, setShiftDefinitions] = useState<DPShiftDefinition[]>([]);
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [onboardingProcesses, setOnboardingProcesses] = useState<OnboardingProcess[]>([]);
  const [onboardingPageInfo, setOnboardingPageInfo] = useState<OnboardingPageInfo>({
    active: { limit: 120, hasMore: false, cursorId: null },
    completed: { limit: 40, hasMore: false, cursorId: null },
    cancelled: { limit: 40, hasMore: false, cursorId: null },
  });
  const [loadingMoreOnboardingScope, setLoadingMoreOnboardingScope] = useState<OnboardingProcessScope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const hasLoadedDataRef = useRef(false);

  const [viewMode, setViewMode] = useState<RecruitmentJobViewMode>('openings');

  // Pipeline filters
  const [search, setSearch] = useState('');
  const [filterOpening, setFilterOpening] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterRating, setFilterRating] = useState('');
  const [filterEligibility, setFilterEligibility] = useState<CandidateEligibilityFilter>('');
  const [sortMode, setSortMode] = useState<CandidateSortMode>('recent');
  const [showArchived, setShowArchived] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<CandidateStatus>>(new Set());

  // Modals
  const [showNewModal, setShowNewModal] = useState(false);
  const [detailCandidate, setDetailCandidate] = useState<Candidate | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Candidate | null>(null);

  // DnD
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const canViewRecruitment =
    !!(permissions.recruitment?.view || permissions.recruitment?.pipeline?.view ||
      permissions.dp?.view || permissions.dp?.collaborators?.view ||
      permissions.dp?.collaborators?.edit || permissions.settings?.manageUsers);
  const canManageRecruitment =
    !!(permissions.recruitment?.manage || permissions.recruitment?.pipeline?.manage ||
      permissions.dp?.collaborators?.edit || permissions.settings?.manageUsers);
  const canViewFormalization = hasFormalizationPermission(permissions, 'view');
  const canManageOnboarding = hasFormalizationPermission(permissions, 'onboarding.manage');
  const canViewAso = hasFormalizationPermission(permissions, 'aso.view');
  const canManageAso = hasFormalizationPermission(permissions, 'aso.manage');
  const canViewAccountant = hasFormalizationPermission(permissions, 'accountant.view');
  const canManageAccountant = hasFormalizationPermission(permissions, 'accountant.manage');
  const canViewSensitiveData = hasFormalizationPermission(permissions, 'sensitiveData.view');
  const canViewSignatures = hasFormalizationPermission(permissions, 'signatures.view');
  const canGenerateDocuments = hasFormalizationPermission(permissions, 'documents.generate');
  const canReviewDocuments = hasFormalizationPermission(permissions, 'documents.review');
  const canSendSignatures = hasFormalizationPermission(permissions, 'signatures.send');
  const canView = section === 'integration' ? canViewFormalization : canViewRecruitment;
  const canManage = section === 'integration' ? canManageOnboarding : canManageRecruitment;

  const getToken = useCallback(async () => (await firebaseUser?.getIdToken()) ?? '', [firebaseUser]);

  useEffect(() => {
    hasLoadedDataRef.current = false;
    setRefreshError(null);
  }, [firebaseUser?.uid]);

  const loadData = useCallback(async () => {
    if (authLoading || !firebaseUser || !canView) { setLoading(false); return; }
    const isInitialLoad = !hasLoadedDataRef.current;
    if (isInitialLoad) {
      setLoading(true);
      setError(null);
    }
    setRefreshError(null);
    try {
      const token = await getToken();
      const [candidatesRes, rolesRes, openingsRes, onboardingRes] = await Promise.all([
        canViewRecruitment
          ? fetch('/api/hr/candidates', { headers: { Authorization: `Bearer ${token}` } }).then(response => readHrJsonResponse<Candidate[]>(response, 'Falha ao carregar candidatos.'))
          : Promise.resolve([]),
        fetchHrBootstrap(firebaseUser),
        canViewRecruitment
          ? fetch('/api/hr/openings', { headers: { Authorization: `Bearer ${token}` } }).then(response => readHrJsonResponse<JobOpening[]>(response, 'Falha ao carregar vagas.'))
          : Promise.resolve([]),
        canViewFormalization && section === 'integration'
          ? fetch('/api/hr/onboarding', { headers: { Authorization: `Bearer ${token}` } }).then(response => readHrJsonResponse<{ processes?: OnboardingProcess[]; pageInfo?: OnboardingPageInfo }>(response, 'Falha ao carregar integrações.'))
          : Promise.resolve({ processes: [], pageInfo: undefined }),
      ]);
      setCandidates(candidatesRes as Candidate[]);
      setRoles(rolesRes.roles);
      setFunctions(rolesRes.functions ?? []);
      setUnits(rolesRes.units ?? []);
      setShiftDefinitions(rolesRes.shiftDefinitions ?? []);
      setOpenings(openingsRes as JobOpening[]);
      setOnboardingProcesses(Array.isArray(onboardingRes?.processes) ? onboardingRes.processes as OnboardingProcess[] : []);
      if (onboardingRes?.pageInfo) setOnboardingPageInfo(onboardingRes.pageInfo);
      hasLoadedDataRef.current = true;
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar.';
      if (isInitialLoad) setError(message);
      else setRefreshError(`${message} Os dados que já estavam na tela foram mantidos.`);
    } finally {
      if (isInitialLoad) setLoading(false);
    }
  }, [authLoading, firebaseUser, canView, canViewFormalization, canViewRecruitment, getToken, section]);

  const loadMoreOnboarding = useCallback(async (scope: OnboardingProcessScope) => {
    if (!firebaseUser || loadingMoreOnboardingScope || !onboardingPageInfo[scope].hasMore) return;
    const cursorId = onboardingPageInfo[scope].cursorId;
    if (!cursorId) return;
    setLoadingMoreOnboardingScope(scope);
    setRefreshError(null);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ scope, cursorId });
      const payload = await fetch(`/api/hr/onboarding?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(response => readHrJsonResponse<{ processes?: OnboardingProcess[]; pageInfo?: Partial<OnboardingPageInfo> }>(response, 'Falha ao carregar mais integrações.'));
      const received = Array.isArray(payload.processes) ? payload.processes : [];
      setOnboardingProcesses(current => {
        const byId = new Map(current.map(process => [process.id, process]));
        received.forEach(process => byId.set(process.id, process));
        return Array.from(byId.values());
      });
      const nextPageInfo = payload.pageInfo?.[scope];
      if (nextPageInfo) setOnboardingPageInfo(current => ({ ...current, [scope]: nextPageInfo }));
    } catch (caught) {
      setRefreshError(caught instanceof Error ? caught.message : 'Falha ao carregar mais integrações.');
    } finally {
      setLoadingMoreOnboardingScope(null);
    }
  }, [firebaseUser, getToken, loadingMoreOnboardingScope, onboardingPageInfo]);

  useEffect(() => { loadData(); }, [loadData]);

  const updateOnboardingProcess = useCallback((updated: OnboardingProcess) => {
    setOnboardingProcesses(current => current.map(process => process.id === updated.id ? updated : process));
  }, []);

  const updateOnboardingAsoPayment = useCallback((processId: string, workflow: AsoPaymentWorkflowPatch) => {
    setOnboardingProcesses(current => current.map(process => {
      if (process.id !== processId) return process;
      const previous = process.asoWorkflow;
      if (
        previous?.paymentRequestId === workflow.paymentRequestId &&
        previous?.paymentStatus === workflow.paymentStatus &&
        previous?.paymentProofStoragePath === workflow.paymentProofStoragePath &&
        previous?.paymentConfirmedAt === workflow.paymentConfirmedAt
      ) return process;
      return { ...process, asoWorkflow: { ...previous, ...workflow } };
    }));
  }, []);

  const updateOnboardingAsoWorkflow = useCallback((processId: string, workflow: NonNullable<OnboardingProcess['asoWorkflow']>) => {
    setOnboardingProcesses(current => current.map(process => process.id === processId
      ? { ...process, asoWorkflow: { ...process.asoWorkflow, ...workflow } }
      : process));
  }, []);

  // ── Filters ────────────────────────────────────────────────────────────────

  const locationOptions = useMemo(() => {
    const locs = new Set<string>();
    candidates.forEach(c => {
      const o = openings.find(op => op.id === c.jobOpeningId);
      if (o?.location) locs.add(o.location);
    });
    return Array.from(locs).sort();
  }, [candidates, openings]);

  const sourceOptions = useMemo(() => {
    const srcs = new Set<string>();
    candidates.forEach(c => { if (c.source) srcs.add(c.source); });
    return Array.from(srcs).sort();
  }, [candidates]);

  const filtered = useMemo(() => {
    const next = candidates.filter(c => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase()) &&
          !c.email.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterOpening && c.jobOpeningId !== filterOpening) return false;
      if (filterLocation) {
        const op = openings.find(o => o.id === c.jobOpeningId);
        if (!op || op.location !== filterLocation) return false;
      }
      if (filterSource && c.source !== filterSource) return false;
      if (filterRating) {
        if ((c.rating ?? 0) < Number(filterRating)) return false;
      }
      if (!candidateMatchesEligibility(c, filterEligibility)) return false;
      return true;
    });
    return sortCandidatesByMode(next, sortMode);
  }, [candidates, openings, search, filterOpening, filterLocation, filterSource, filterRating, filterEligibility, sortMode]);

  const pipelineCandidates = useMemo(() =>
    filtered.filter(c => PIPELINE_STATUSES.includes(c.status)), [filtered]);

  const archivedCandidates = useMemo(() =>
    filtered.filter(c => ARCHIVED_STATUSES.includes(c.status)), [filtered]);

  const selectedOpening = useMemo(() =>
    filterOpening ? openings.find(o => o.id === filterOpening) ?? null : null,
    [filterOpening, openings]
  );

  const selectedOpeningRole = useMemo(() => {
    if (!selectedOpening) return null;
    return roles.find(role => role.id === selectedOpening.jobRoleId) ?? null;
  }, [roles, selectedOpening]);

  const selectedOpeningPipelineStages = useMemo(
    () => normalizeRecruitmentStages(selectedOpening?.pipelineStages),
    [selectedOpening]
  );
  const visiblePipelineStages = selectedOpening ? selectedOpeningPipelineStages : normalizeRecruitmentStages(null);

  const selectedOpeningCandidates = useMemo(() =>
    selectedOpening ? candidates.filter(c => c.jobOpeningId === selectedOpening.id) : [],
    [candidates, selectedOpening]
  );

  const selectedOpeningStatusCounts = useMemo(() => {
    const counts = Object.fromEntries(ALL_STATUSES.map(status => [status, 0])) as Record<CandidateStatus, number>;
    selectedOpeningCandidates.forEach(candidate => {
      counts[candidate.status] += 1;
    });
    return counts;
  }, [selectedOpeningCandidates]);

  const stats = useMemo(() => {
    const now = Date.now();
    const openOpenings = openings.filter(opening => opening.status === 'open').length;
    const totalOpenings = openings.length;
    const applied = candidates.filter(c => c.status === 'applied').length;
    const screening = candidates.filter(c => c.status === 'screening').length;
    const hired = candidates.filter(c => c.status === 'hired').length;
    const rejected = candidates.filter(c => c.status === 'rejected').length;
    const talentPool = candidates.filter(c => c.status === TALENT_POOL_STATUS || c.source === 'talent_pool').length;
    const pipeline = candidates.filter(c => PIPELINE_STATUSES.includes(c.status));
    const avgDays = pipeline.length > 0
      ? Math.round(pipeline.reduce((sum, c) =>
          sum + (now - new Date(c.appliedAt).getTime()), 0) / pipeline.length / MS_DAY)
      : 0;
    const hiredWithDates = candidates.filter(c => c.status === 'hired');
    const avgHiringDays = hiredWithDates.length > 0
      ? Math.round(hiredWithDates.reduce((sum, candidate) => {
          const start = safeDateTime(candidate.appliedAt) ?? now;
          const end = safeDateTime(candidate.hiredAt) ?? safeDateTime(candidate.updatedAt) ?? now;
          return sum + Math.max(0, end - start);
        }, 0) / hiredWithDates.length / MS_DAY)
      : 0;
    const conversionBase = hired + rejected;
    const conversionRate = conversionBase > 0 ? Math.round((hired / conversionBase) * 100) : 0;
    const overdueCandidates = pipeline.filter(candidate => {
      const opening = openings.find(item => item.id === candidate.jobOpeningId);
      const stage = normalizeRecruitmentStages(opening?.pipelineStages).find(item => item.id === candidate.status);
      return getCandidateStageTiming(candidate, stage, now).isOverdue;
    }).length;
    const delayedOpenings = openings.filter(opening => {
      if (opening.status !== 'open' || !opening.applicationEndAt) return false;
      const end = safeDateTime(opening.applicationEndAt);
      return end !== null && end < now;
    }).length;
    // Sparkline: candidates applied per day for last 7 days
    const sparkData = Array.from({ length: 7 }, (_, i) => {
      const dayStart = now - (6 - i) * MS_DAY;
      const dayEnd = dayStart + MS_DAY;
      return candidates.filter(c => {
        const t = new Date(c.appliedAt).getTime();
        return t >= dayStart && t < dayEnd;
      }).length;
    });
    // Trend: this week vs last week
    const thisWeekApplied = candidates.filter(c =>
      (now - new Date(c.appliedAt).getTime()) < 7 * MS_DAY
    ).length;
    const lastWeekApplied = candidates.filter(c => {
      const age = now - new Date(c.appliedAt).getTime();
      return age >= 7 * MS_DAY && age < 14 * MS_DAY;
    }).length;
    const appliedTrend = lastWeekApplied > 0
      ? Math.round(((thisWeekApplied - lastWeekApplied) / lastWeekApplied) * 100)
      : thisWeekApplied > 0 ? 100 : 0;
    const hiredThisMonth = candidates.filter(c =>
      c.status === 'hired' && (now - new Date(c.updatedAt).getTime()) < 30 * MS_DAY
    ).length;
    return {
      applied,
      screening,
      hired,
      rejected,
      avgDays,
      avgHiringDays,
      sparkData,
      appliedTrend,
      hiredThisMonth,
      openOpenings,
      totalOpenings,
      talentPool,
      pipeline: pipeline.length,
      overdueCandidates,
      delayedOpenings,
      conversionRate,
    };
  }, [candidates, openings]);

  // ── DnD handlers ──────────────────────────────────────────────────────────

  const activeDragCandidate = activeDragId
    ? candidates.find(c => c.id === activeDragId)
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const newStatus = over.id as CandidateStatus;
    if (!ALL_STATUSES.includes(newStatus)) return;

    const candidate = candidates.find(c => c.id === active.id);
    if (!candidate || candidate.status === newStatus) return;
    const now = new Date().toISOString();
    const historyEntry = createCandidateStageHistoryEntry({
      fromStatus: candidate.status,
      toStatus: newStatus,
      action: newStatus === 'hired' ? 'hired' : 'status_changed',
      actorId: null,
      actorEmail: null,
      createdAt: now,
    });

    // Optimistic update
    setCandidates(prev => prev.map(c =>
      c.id === candidate.id
        ? {
            ...c,
            status: newStatus,
            updatedAt: now,
            hiredAt: newStatus === 'hired' ? c.hiredAt ?? now : c.hiredAt,
            recruitmentHistory: [...(c.recruitmentHistory ?? []), historyEntry],
            latestApplication: c.latestApplication
              ? {
                  ...c.latestApplication,
                  stage: newStatus,
                  stageHistory: [...(c.latestApplication.stageHistory ?? []), historyEntry],
                }
              : c.latestApplication,
          }
        : c
    ));

    try {
      const result = await apiFetch(`/api/hr/candidates/${candidate.id}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify({
          status: newStatus,
          decisionAction: newStatus === 'hired' ? 'hired' : 'status_changed',
        }),
      });
      const onboardingId = typeof result?.onboardingId === 'string' ? result.onboardingId : undefined;
      if (onboardingId) {
        setCandidates(prev => prev.map(c =>
          c.id === candidate.id
            ? {
                ...c,
                onboardingId,
                latestApplication: c.latestApplication
                  ? { ...c.latestApplication, onboardingId }
                  : c.latestApplication,
              }
            : c
        ));
        void loadData();
      }
    } catch {
      // Rollback
      setCandidates(prev => prev.map(c =>
        c.id === candidate.id ? { ...c, status: candidate.status } : c
      ));
    }
  };

  // ── Event handlers ─────────────────────────────────────────────────────────

  const handleUpdated = (updated: Candidate) => {
    setCandidates(prev => prev.map(c => c.id === updated.id ? updated : c));
    setDetailCandidate(updated);
    if (updated.status === 'hired') void loadData();
  };

  const handleDeleted = (id: string) => {
    setCandidates(prev => prev.filter(c => c.id !== id));
    setDetailCandidate(null);
    setDeleteCandidate(null);
  };

  const handleOpeningsFilterFromTab = (openingId: string) => {
    setViewMode('kanban');
    setFilterOpening(openingId);
  };

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (authLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!canView) {
    return <p className="text-slate-400 p-6">Sem permissão para acessar Recrutamento.</p>;
  }

  if (error) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-slate-400">{error}</p>
        <button onClick={loadData} className="text-sm text-indigo-400 hover:text-indigo-300">Tentar novamente</button>
      </div>
    );
  }

  const activeFilters = [filterOpening, filterLocation, filterSource, filterRating, filterEligibility, sortMode !== 'recent' ? sortMode : ''].filter(Boolean).length;
  const sectionMeta = RECRUITMENT_SECTION_META[section];

  const FUNNEL_COLORS: Record<string, string> = {
    applied: 'bg-blue-500',
    screening: 'bg-indigo-500',
    interview: 'bg-purple-500',
    technical_test: 'bg-pink-500',
    offer: 'bg-amber-500',
    hired: 'bg-green-500',
  };

  return (
    <div className="personal-recruitment-density flex min-h-[calc(100vh-5rem)] w-full min-w-0 flex-col space-y-3 overflow-x-hidden rounded-xl border border-white/70 bg-white/85 p-3 text-slate-900 shadow-sm backdrop-blur">

      {refreshError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900"><span>{refreshError}</span><button type="button" onClick={() => void loadData()} className="font-black text-amber-800 underline underline-offset-2">Tentar atualizar novamente</button></div> : null}

      {/* A integração possui um cabeçalho próprio com status, busca e histórico. */}
      {section !== 'integration' && <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-400">{sectionMeta.eyebrow}</p>
          <h1 className="text-lg font-bold tracking-tight text-slate-950">{sectionMeta.title}</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {sectionMeta.description}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {section === 'jobs' && viewMode !== 'openings' && selectedOpening && (
            <button
              type="button"
              onClick={() => { setViewMode('openings'); setFilterOpening(''); }}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-slate-950 px-3 text-xs font-medium text-white shadow-sm hover:bg-slate-800"
            >
              <Briefcase className="h-4 w-4" />
              Voltar para vagas
            </button>
          )}
        </div>
      </div>}

      {/* ─── Stats row ─── */}
      {section === 'jobs' && (viewMode === 'list' || viewMode === 'kanban') && (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Vagas abertas</p>
            <p className="text-3xl font-bold leading-none text-slate-950">{stats.openOpenings}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">{stats.totalOpenings} no total</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Inscritos</p>
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-3xl font-bold leading-none text-slate-950">{stats.applied}</p>
                {stats.appliedTrend !== 0 && (
                  <span className={`mt-1 flex items-center gap-0.5 text-xs font-bold ${stats.appliedTrend > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                      {stats.appliedTrend > 0
                        ? <path d="M4 1L7 6H1L4 1Z" />
                        : <path d="M4 7L7 2H1L4 7Z" />}
                    </svg>
                    {Math.abs(stats.appliedTrend)}%
                  </span>
                )}
              </div>
              <svg width="48" height="28" className="flex-shrink-0 text-indigo-400">
                {stats.sparkData.map((v, i) => {
                  const max = Math.max(...stats.sparkData, 1);
                  const bh = Math.max((v / max) * 24, 2);
                  return (
                    <rect key={i} x={i * 7} y={28 - bh} width={5} height={bh}
                      rx="1" fill="currentColor" opacity={0.3 + 0.7 * (v / max)} />
                  );
                })}
              </svg>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">No funil</p>
            <p className="text-3xl font-bold leading-none text-slate-950">{stats.pipeline}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">{stats.screening} em triagem</p>
          </div>

          <div className={`rounded-2xl border p-4 ${stats.overdueCandidates > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
            <p className={`mb-3 text-[11px] font-bold uppercase tracking-wider ${stats.overdueCandidates > 0 ? 'text-red-500' : 'text-slate-500'}`}>Em atraso</p>
            <p className={`text-3xl font-bold leading-none ${stats.overdueCandidates > 0 ? 'text-red-700' : 'text-slate-950'}`}>{stats.overdueCandidates}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">{stats.delayedOpenings} vaga{stats.delayedOpenings !== 1 ? 's' : ''} com inscrição vencida</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Contratados</p>
            <p className="text-3xl font-bold leading-none text-slate-950">{stats.hired}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">{stats.conversionRate}% de conversão</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Banco talentos</p>
            <p className="text-3xl font-bold leading-none text-slate-950">{stats.talentPool}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">Fechamento médio: {stats.avgHiringDays}d</p>
          </div>
        </div>
      )}

      {/* ─── Funnel ─── */}
      {section === 'jobs' && viewMode === 'list' && candidates.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-4">Funil de conversão</h3>
          {/* Stage labels + counts */}
          <div className="flex mb-3">
            {PIPELINE_STATUSES.map(status => {
              const count = candidates.filter(c => c.status === status).length;
              const cfg = STATUS_CONFIG[status];
              return (
                <div key={status} style={{ flex: 1 }} className="text-center min-w-0 px-1">
                  <p className="text-base font-bold text-slate-950 leading-none mb-1">{count}</p>
                  <p className="text-[10px] text-slate-500 truncate">{cfg.label}</p>
                </div>
              );
            })}
          </div>
          {/* Bar */}
          <div className="flex h-5 gap-0.5 rounded-lg overflow-hidden">
            {PIPELINE_STATUSES.map(status => {
              const count = candidates.filter(c => c.status === status).length;
              const total = candidates.filter(c => PIPELINE_STATUSES.includes(c.status)).length;
              const flex = total > 0 ? Math.max(count, 0.15) : 1;
              return (
                <div
                  key={status}
                  style={{ flex }}
                  className={`${FUNNEL_COLORS[status] ?? 'bg-slate-700'} rounded-sm`}
                  title={`${STATUS_CONFIG[status].label}: ${count}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Pipeline filters ─── */}
      {section === 'jobs' && viewMode !== 'openings' && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-3 shadow-sm">
          <div className="mr-2 hidden items-center gap-2 border-r border-slate-100 pr-3 text-sm font-semibold text-slate-950 md:flex">
            <Kanban className="h-4 w-4 text-slate-500" />
            Board
          </div>
          <div className="relative min-w-0 flex-1 basis-full sm:basis-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar candidato e e-mail…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
          </div>

          {openings.length > 0 && (
            <select value={filterOpening} onChange={e => setFilterOpening(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">Todas as vagas</option>
              {openings.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
          )}

          {locationOptions.length > 0 && (
            <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">Todas unidades</option>
              {locationOptions.map(loc => <option key={loc} value={loc}>{loc}</option>)}
            </select>
          )}

          {sourceOptions.length > 0 && (
            <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="">Todas origens</option>
              {sourceOptions.map(src => <option key={src} value={src}>{src}</option>)}
            </select>
          )}

          <select value={filterRating} onChange={e => setFilterRating(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
            <option value="">Avaliação</option>
            <option value="1">1+ estrela</option>
            <option value="2">2+ estrelas</option>
            <option value="3">3+ estrelas</option>
            <option value="4">4+ estrelas</option>
            <option value="5">5 estrelas</option>
          </select>

          <select value={filterEligibility} onChange={e => setFilterEligibility(e.target.value as CandidateEligibilityFilter)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
            <option value="">Elegibilidade</option>
            <option value="eligible">Apenas elegíveis</option>
            <option value="not_eligible">Não atende mínimo</option>
            <option value="scored">Com score</option>
          </select>

          <select value={sortMode} onChange={e => setSortMode(e.target.value as CandidateSortMode)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
            <option value="recent">Mais recentes</option>
            <option value="score_desc">Maior score</option>
            <option value="score_asc">Menor score</option>
            <option value="name">Nome A-Z</option>
          </select>

          {activeFilters > 0 && (
            <button
              onClick={() => {
                setFilterOpening('');
                setFilterLocation('');
                setFilterSource('');
                setFilterRating('');
                setFilterEligibility('');
                setSortMode('recent');
                setSearch('');
              }}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:border-slate-300 hover:text-slate-950">
              <X className="h-3 w-3" /> Limpar filtros
            </button>
          )}
          <button
            type="button"
            className="ml-auto flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
          </button>
        </div>
      )}

      {section === 'jobs' && viewMode !== 'openings' && selectedOpening && (
        <div className="rounded-2xl border border-pink-100 bg-pink-50/60 p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-pink-600 ring-1 ring-pink-100">
                  Processo seletivo
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {selectedOpening.location || 'Unidade não informada'}
                </span>
              </div>
              <h2 className="mt-2 text-lg font-bold text-slate-950">{selectedOpening.title}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {selectedOpeningRole?.name ?? selectedOpening.jobRoleName ?? 'Cargo não informado'} ·{' '}
                {selectedOpening.slots} vaga{selectedOpening.slots !== 1 ? 's' : ''} ·{' '}
                {selectedOpeningCandidates.length} candidato{selectedOpeningCandidates.length !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedOpeningPipelineStages.map(stage => {
                const cfg = STATUS_CONFIG[stage.id];
                return (
                  <span key={stage.id} className="rounded-xl border border-white bg-white/80 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm">
                    <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${cfg.color}`} />
                    {stage.label}: {selectedOpeningStatusCounts[stage.id]}
                  </span>
                );
              })}
              {selectedOpening.status === 'open' && (
                <a
                  href={`${PUBLIC_RECRUITMENT_URL}/${selectedOpening.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:text-slate-950"
                >
                  Ver vaga pública
                </a>
              )}
              <button
                type="button"
                onClick={() => { setViewMode('openings'); setFilterOpening(''); }}
                className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                Voltar para vagas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Kanban ─── */}
      {section === 'jobs' && viewMode === 'kanban' && (
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-h-0">
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex gap-4 overflow-x-auto rounded-2xl bg-slate-50/80 p-3 pb-4 custom-scrollbar">
              {visiblePipelineStages.map(stage => (
                <DroppableColumn
                  key={stage.id}
                  status={stage.id}
                  stage={stage}
                  candidates={pipelineCandidates.filter(c => c.status === stage.id)}
                  onCardOpen={setDetailCandidate}
                />
              ))}
            </div>
            <DragOverlay>
              {activeDragCandidate && (
                <div className="p-4 bg-slate-900 border border-indigo-500/50 rounded-xl shadow-2xl w-72 opacity-95">
                  <h4 className="font-bold text-white text-sm">{activeDragCandidate.name}</h4>
                  <p className="text-xs text-slate-400 mt-0.5">{activeDragCandidate.jobRoleName}</p>
                </div>
              )}
            </DragOverlay>
          </DndContext>

          {/* Archived */}
          {archivedCandidates.length > 0 && (
            <div>
              <button
                onClick={() => setShowArchived(p => !p)}
                className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-3">
                {showArchived ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <Archive className="h-3.5 w-3.5" />
                Arquivados ({archivedCandidates.length})
              </button>
              {showArchived && (
                <div className="flex gap-4 overflow-x-auto pb-2 custom-scrollbar">
                  {ARCHIVED_STATUSES.map(status => (
                    <DroppableColumn
                      key={status}
                      status={status}
                      candidates={archivedCandidates.filter(c => c.status === status)}
                      onCardOpen={setDetailCandidate}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── List / Triagem ─── */}
      {section === 'jobs' && viewMode === 'list' && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {filtered.length === 0 && (
            <div className="py-16 text-center text-slate-600 text-sm">Nenhum candidato encontrado.</div>
          )}

          {filtered.length > 0 && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="grid grid-cols-[2rem_1fr_minmax(0,140px)_88px_80px_80px_2rem] items-center px-4 py-2.5 border-b border-slate-800 bg-slate-900/80">
                <span />
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Nome</span>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider hidden md:block">Cargo</span>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider hidden lg:block">Avaliação</span>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider hidden lg:block">Inscrição</span>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider hidden sm:block">Origem</span>
                <span />
              </div>

              {ALL_STATUSES.map(status => {
                const group = filtered.filter(c => c.status === status);
                if (group.length === 0) return null;
                const cfg = STATUS_CONFIG[status];
                const isCollapsed = collapsedGroups.has(status);
                const toggle = () => setCollapsedGroups(prev => {
                  const next = new Set(prev);
                  if (next.has(status)) next.delete(status); else next.add(status);
                  return next;
                });

                return (
                  <div key={status} className="border-b border-slate-800/60 last:border-b-0">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-900/60 hover:bg-slate-800/40 transition-colors">
                      <button onClick={toggle} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                        {isCollapsed
                          ? <ChevronRight className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                          : <ChevronDown className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />}
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.color}`} />
                        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">{cfg.label}</span>
                        <span className="text-xs text-slate-600 ml-1">{group.length}</span>
                      </button>
                      {canManage && (
                        <button
                          onClick={() => setShowNewModal(true)}
                          className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-indigo-400 transition-colors px-2 py-1 rounded-lg hover:bg-indigo-500/10">
                          <Plus className="h-3 w-3" /> Adicionar
                        </button>
                      )}
                    </div>

                    {!isCollapsed && group.map((candidate, rowIdx) => {
                      const sourceColor = candidate.source
                        ? (SOURCE_TAG_COLORS[candidate.source] ?? SOURCE_TAG_COLORS['Outro'])
                        : null;
                      return (
                        <div
                          key={candidate.id}
                          onClick={() => setDetailCandidate(candidate)}
                          className="grid grid-cols-[2rem_1fr_minmax(0,140px)_88px_80px_80px_2rem] items-center px-4 py-3 border-t border-slate-800/40 hover:bg-slate-800/30 transition-colors cursor-pointer group"
                        >
                          <span className="text-[11px] text-slate-700 font-mono select-none">{rowIdx + 1}</span>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white group-hover:text-indigo-300 transition-colors truncate leading-snug">
                                {candidate.name}
                              </p>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="text-[11px] text-slate-500 truncate">{candidate.email}</p>
                                <EligibilityBadge candidate={candidate} />
                              </div>
                            </div>
                            {candidate.resumeUrl && <Paperclip className="h-3 w-3 text-slate-600 flex-shrink-0" />}
                          </div>
                          <span className="text-xs text-slate-400 truncate hidden md:block">{candidate.jobRoleName ?? '—'}</span>
                          <div className="hidden lg:block"><RatingStars value={candidate.rating ?? 0} readonly /></div>
                          <span className="text-[11px] text-slate-500 hidden lg:block">
                            {new Date(candidate.appliedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                          </span>
                          <div className="hidden sm:block">
                            {sourceColor && candidate.source ? (
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border truncate max-w-[72px] block text-center ${sourceColor}`}>
                                {candidate.source}
                              </span>
                            ) : <span className="text-[11px] text-slate-700">—</span>}
                          </div>
                          <div onClick={e => e.stopPropagation()}>
                            {canManage ? (
                              <ListRowMenu
                                candidate={candidate}
                                onOpen={() => setDetailCandidate(candidate)}
                                onDelete={() => setDeleteCandidate(candidate)}
                              />
                            ) : (
                              <button onClick={() => setDetailCandidate(candidate)}
                                className="p-1.5 text-slate-600 hover:text-white">
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Por vaga ─── */}
      {section === 'jobs' && viewMode === 'openings' && (
        <OpeningsView
          openings={openings}
          roles={roles}
          functions={functions}
          units={units}
          shiftDefinitions={shiftDefinitions}
          candidates={candidates}
          getToken={getToken}
          canManage={canManage}
          onRefresh={loadData}
          onCandidatesFilter={handleOpeningsFilterFromTab}
        />
      )}

      {/* ─── Banco de talentos ─── */}
      {section === 'talents' && (
        <TalentsView
          candidates={candidates}
          roles={roles}
          openings={openings}
          getToken={getToken}
          canManage={canManage}
          onOpen={setDetailCandidate}
          onReactivated={loadData}
        />
      )}

      {/* ─── Integração ─── */}
      {section === 'integration' && (
        <OnboardingView
          processes={onboardingProcesses}
          pageInfo={onboardingPageInfo}
          loadingMoreScope={loadingMoreOnboardingScope}
          roles={roles}
          jobFunctions={functions}
          units={units}
          shiftDefinitions={shiftDefinitions}
          getToken={getToken}
          canManage={canManage}
          canViewAso={canViewAso}
          canManageAso={canManageAso}
          canViewAccountant={canViewAccountant}
          canManageAccountant={canManageAccountant}
          canViewSensitiveData={canViewSensitiveData}
          canViewSignatures={canViewSignatures}
          canGenerateDocuments={canGenerateDocuments}
          canReviewDocuments={canReviewDocuments}
          canSendSignatures={canSendSignatures}
          onRefresh={loadData}
          onLoadMore={loadMoreOnboarding}
          onProcessUpdated={updateOnboardingProcess}
          onAsoPaymentUpdated={updateOnboardingAsoPayment}
          onAsoWorkflowUpdated={updateOnboardingAsoWorkflow}
        />
      )}

      {/* Modals */}
      {showNewModal && (
        <NewCandidateModal
          roles={roles}
          openings={openings}
          getToken={getToken}
          onClose={() => setShowNewModal(false)}
          onCreated={() => { loadData(); setShowNewModal(false); }}
        />
      )}

      {detailCandidate && (
        <CandidateDetailPanel
          candidate={detailCandidate}
          roles={roles}
          openings={openings}
          units={units}
          getToken={getToken}
          canManage={canManage}
          onClose={() => setDetailCandidate(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}

      {deleteCandidate && (
        <DeleteConfirmModal
          candidate={deleteCandidate}
          getToken={getToken}
          onClose={() => setDeleteCandidate(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
