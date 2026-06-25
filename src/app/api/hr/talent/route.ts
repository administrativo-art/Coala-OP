import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { getFeatureFlags } from '@/lib/feature-flags';
import type { HrFormQuestion } from '@/types';
import { createCandidateStageHistoryEntry, isCandidateStatus } from '@/lib/recruitment-pipeline';
import {
  DEFAULT_TALENT_POOL_FORM,
  TALENT_POOL_FORM_ID,
  getPublicRecruitmentQuestions,
  getRecruitmentQuestionOptions,
  hasRecruitmentAnswer,
  hydrateRecruitmentQuestionDynamicOptions,
  normalizeRecruitmentFormConfig,
} from '@/lib/recruitment-forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TALENT_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const TALENT_LIMIT_MAX = 5;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function trimText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function getClientKey(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

function isRateLimited(key: string) {
  const now = Date.now();
  for (const [bucketKey, bucket] of rateBuckets.entries()) {
    if (now > bucket.resetAt) rateBuckets.delete(bucketKey);
  }

  const current = rateBuckets.get(key);
  if (!current || now > current.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + TALENT_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > TALENT_LIMIT_MAX;
}

function isAllowedResumeUrl(value: unknown) {
  return typeof value === 'string' &&
    value.startsWith('https://firebasestorage.googleapis.com/') &&
    value.length <= 1200;
}

function isActiveRecord(data: FirebaseFirestore.DocumentData) {
  return data.active !== false &&
    data.isActive !== false &&
    data.status !== 'inactive' &&
    data.status !== 'inativo' &&
    data.status !== 'terminated';
}

function cleanOptionLabel(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

async function getPublicRoleFunctionOptions() {
  const [rolesSnap, functionsSnap] = await Promise.all([
    hrDbAdmin.collection('jobRoles').orderBy('name').get(),
    hrDbAdmin.collection('jobFunctions').orderBy('name').get(),
  ]);

  const options = [
    ...rolesSnap.docs
      .map(doc => doc.data())
      .filter(isActiveRecord)
      .map(data => cleanOptionLabel(data.publicTitle || data.name))
      .filter(Boolean)
      .map(label => `Cargo · ${label}`),
    ...functionsSnap.docs
      .map(doc => doc.data())
      .filter(isActiveRecord)
      .map(data => cleanOptionLabel(data.publicTitle || data.name))
      .filter(Boolean)
      .map(label => `Função · ${label}`),
  ];

  return Array.from(new Set(options)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function formatTalentPreferenceAnswer(value: unknown, maxLength: number) {
  if (Array.isArray(value)) {
    return value
      .map(entry => trimText(entry, 120))
      .filter(Boolean)
      .join(', ')
      .slice(0, maxLength);
  }
  return trimText(value, maxLength);
}

function normalizeTalentFormAnswers(rawAnswers: unknown, questions: HrFormQuestion[]) {
  if (rawAnswers !== undefined && (typeof rawAnswers !== 'object' || rawAnswers === null || Array.isArray(rawAnswers))) {
    throw new Error('Respostas do formulário inválidas.');
  }

  const input = (rawAnswers ?? {}) as Record<string, unknown>;
  if (JSON.stringify(input).length > 12_000) {
    throw new Error('Respostas do formulário acima do limite permitido.');
  }

  const normalized: Record<string, unknown> = {};
  for (const question of questions) {
    const raw = input[question.id];
    if (question.required && !hasRecruitmentAnswer(raw)) {
      throw new Error(`Responda o campo obrigatório: ${question.text}`);
    }
    if (!hasRecruitmentAnswer(raw)) continue;

    const options = getRecruitmentQuestionOptions(question);
    if (question.type === 'yes_no') {
      if (typeof raw !== 'boolean') throw new Error(`Resposta inválida para: ${question.text}`);
      normalized[question.id] = raw;
      continue;
    }
    if (question.type === 'select') {
      const value = trimText(raw, 200);
      if (!value) throw new Error(`Resposta inválida para: ${question.text}`);
      if (options.length > 0 && !options.includes(value)) throw new Error(`Resposta inválida para: ${question.text}`);
      normalized[question.id] = value;
      continue;
    }
    if (question.type === 'multi_select') {
      if (!Array.isArray(raw)) throw new Error(`Resposta inválida para: ${question.text}`);
      const values = raw.map(entry => trimText(entry, 200)).filter(Boolean);
      if (options.length > 0 && values.some(value => !options.includes(value))) {
        throw new Error(`Resposta inválida para: ${question.text}`);
      }
      if (question.required && values.length === 0) throw new Error(`Responda o campo obrigatório: ${question.text}`);
      normalized[question.id] = Array.from(new Set(values));
      continue;
    }
    if (question.type === 'number_range') {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`Resposta inválida para: ${question.text}`);
      normalized[question.id] = value;
      continue;
    }
    if (question.type === 'date') {
      const value = trimText(raw, 40);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Resposta inválida para: ${question.text}`);
      normalized[question.id] = value;
      continue;
    }
    if (question.type === 'file_upload') {
      if (!isAllowedResumeUrl(raw)) throw new Error(`Arquivo inválido para: ${question.text}`);
      normalized[question.id] = raw;
      continue;
    }

    normalized[question.id] = trimText(raw, 1000);
  }

  return normalized;
}

function createQuestionSnapshot(questions: HrFormQuestion[]) {
  return questions.map(question => ({
    id: question.id,
    text: question.text,
    type: question.type,
    sectionId: question.sectionId ?? null,
    sectionTitle: question.sectionTitle ?? null,
    sectionOrder: question.sectionOrder ?? null,
    parentQuestionId: question.parentQuestionId ?? null,
    subquestionOrder: question.subquestionOrder ?? null,
    required: question.required,
    active: question.active !== false,
    eliminatory: question.eliminatory,
    weight: question.weight,
    config: question.config ?? null,
  }));
}

export async function POST(request: NextRequest) {
  const flags = await getFeatureFlags();
  if (flags.kill_recruitment_public_landing) {
    return jsonError('Cadastro temporariamente indisponível.', 503);
  }

  if (isRateLimited(getClientKey(request))) {
    return jsonError('Muitas tentativas. Tente novamente em alguns minutos.', 429);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Payload inválido.');

  const name = trimText(body.name, 120);
  const email = trimText(body.email, 180).toLowerCase();
  const phone = trimText(body.phone, 40);
  const rolePreference = trimText(body.rolePreference, 120);
  const unitPreference = trimText(body.unitPreference, 120);
  const notes = trimText(body.message, 1500);
  const rawFormAnswers = body.formAnswers;
  const resumeUrl = isAllowedResumeUrl(body.resumeUrl) ? body.resumeUrl : null;
  const resumePath = trimText(body.resumePath, 500) || null;
  const consentAccepted = body.consentAccepted === true;
  const website = trimText(body.website, 200);

  if (website) return jsonError('Cadastro não aceito.', 400);
  if (!consentAccepted) return jsonError('É necessário aceitar o tratamento dos dados para enviar o cadastro.');
  if (!name) return jsonError('Nome é obrigatório.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError('E-mail inválido.');
  }

  const [formDoc, rolesFunctions] = await Promise.all([
    hrDbAdmin.collection('recruitmentForms').doc(TALENT_POOL_FORM_ID).get(),
    getPublicRoleFunctionOptions(),
  ]);
  const formConfig = normalizeRecruitmentFormConfig(
    formDoc.exists ? { id: formDoc.id, ...formDoc.data() } : DEFAULT_TALENT_POOL_FORM
  );
  const fallbackPublicForm = {
    ...DEFAULT_TALENT_POOL_FORM,
    questions: hydrateRecruitmentQuestionDynamicOptions(
      getPublicRecruitmentQuestions(DEFAULT_TALENT_POOL_FORM.questions),
      { rolesFunctions }
    ),
  };

  const publicForm = formConfig.status === 'published'
    ? {
        ...formConfig,
        questions: hydrateRecruitmentQuestionDynamicOptions(
          getPublicRecruitmentQuestions(formConfig.questions),
          { rolesFunctions }
        ),
      }
    : fallbackPublicForm;
  let formAnswers: Record<string, unknown>;
  try {
    formAnswers = normalizeTalentFormAnswers(rawFormAnswers, publicForm.questions);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Respostas do formulário inválidas.');
  }
  const formQuestionSnapshot = createQuestionSnapshot(publicForm.questions);

  const resolvedRolePreference = rolePreference || formatTalentPreferenceAnswer(formAnswers.preferred_role, 500);
  const resolvedUnitPreference = unitPreference || formatTalentPreferenceAnswer(formAnswers.preferred_unit, 120);
  const resolvedNotes = notes || trimText(formAnswers.message, 1500);

  const existing = await hrDbAdmin
    .collection('candidates')
    .where('email', '==', email)
    .limit(1)
    .get();

  const now = new Date().toISOString();
  const candidateRef = existing.empty ? hrDbAdmin.collection('candidates').doc() : existing.docs[0].ref;
  const existingData = existing.empty ? null : existing.docs[0].data();
  const jobRoleName = resolvedRolePreference || 'Banco de talentos';
  const existingStatus = isCandidateStatus(existingData?.status) ? existingData.status : null;
  const status = existingStatus && existingStatus !== 'withdrawn' ? existingStatus : 'talent_pool';
  const historyEntry = createCandidateStageHistoryEntry({
    fromStatus: existingStatus,
    toStatus: status,
    action: existing.empty ? 'created' : 'talent_pool',
    note: resolvedNotes || null,
    actorId: 'public',
    actorEmail: null,
    createdAt: now,
  });

  await candidateRef.set({
    name,
    email,
    phone: phone || null,
    jobRoleId: existingData?.jobRoleId ?? 'talent_pool',
    jobRoleName,
    status,
    notes: resolvedNotes || null,
    source: 'talent_pool',
    resumeUrl,
    resumePath,
    formAnswers,
    formQuestionSnapshot,
    rating: existingData?.rating ?? 0,
    consent: {
      accepted: true,
      acceptedAt: now,
      purpose: 'talent_pool',
      retention: 'recruitment_process',
    },
    talentPool: {
      rolePreference: resolvedRolePreference || null,
      unitPreference: resolvedUnitPreference || null,
      submittedAt: now,
      formId: publicForm.id,
      formVersion: publicForm.version,
    },
    publicMetadata: {
      ip: getClientKey(request),
      userAgent: request.headers.get('user-agent')?.slice(0, 300) || null,
    },
    recruitmentHistory: FieldValue.arrayUnion(historyEntry),
    appliedAt: existingData?.appliedAt ?? now,
    updatedAt: now,
    createdBy: existingData?.createdBy ?? 'public',
    firstAppliedAt: existingData?.firstAppliedAt ?? existingData?.appliedAt ?? now,
  }, { merge: true });

  return NextResponse.json({ ok: true, id: candidateRef.id, reused: !existing.empty }, { status: existing.empty ? 201 : 200 });
}
