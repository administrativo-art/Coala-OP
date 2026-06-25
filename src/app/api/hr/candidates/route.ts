import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import { logAction } from '@/lib/log-action';
import { getConditionallyVisibleRecruitmentQuestions } from '@/lib/recruitment-forms';
import { applyRecruitmentScoring, calculateRecruitmentScore } from '@/lib/recruitment-scoring';
import {
  applicationStatusForCandidateStatus,
  createCandidateStageHistoryEntry,
  isCandidateStatus,
} from '@/lib/recruitment-pipeline';
import type { HrFormQuestion } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function maybeBackfillRecruitmentScore(params: {
  candidateId: string;
  applicationId: string;
  candidateData: FirebaseFirestore.DocumentData;
  applicationData: FirebaseFirestore.DocumentData;
  getOpeningData: (openingId: string) => Promise<FirebaseFirestore.DocumentData | null>;
}) {
  if (params.candidateData.recruitmentScore && params.applicationData.recruitmentScore) return null;

  const answers = asRecord(params.applicationData.formAnswers ?? params.candidateData.formAnswers);
  if (Object.keys(answers).length === 0) return null;

  const openingId = typeof params.applicationData.jobOpeningId === 'string'
    ? params.applicationData.jobOpeningId
    : typeof params.candidateData.jobOpeningId === 'string'
      ? params.candidateData.jobOpeningId
      : '';
  const openingData = openingId ? await params.getOpeningData(openingId) : null;
  const questions = Array.isArray(params.applicationData.formQuestionSnapshot)
    ? params.applicationData.formQuestionSnapshot as HrFormQuestion[]
    : Array.isArray(params.candidateData.formQuestionSnapshot)
      ? params.candidateData.formQuestionSnapshot as HrFormQuestion[]
      : Array.isArray(openingData?.formQuestions)
        ? openingData.formQuestions as HrFormQuestion[]
        : [];
  if (questions.length === 0) return null;

  const visibleQuestions = getConditionallyVisibleRecruitmentQuestions(questions, answers);
  const recruitmentScoring = params.applicationData.recruitmentScoring && typeof params.applicationData.recruitmentScoring === 'object'
    ? params.applicationData.recruitmentScoring
    : params.candidateData.recruitmentScoring && typeof params.candidateData.recruitmentScoring === 'object'
      ? params.candidateData.recruitmentScoring
      : openingData?.recruitmentScoring && typeof openingData.recruitmentScoring === 'object'
        ? openingData.recruitmentScoring
        : applyRecruitmentScoring(questions, openingData?.compositionPreset).snapshot;
  const recruitmentScore = calculateRecruitmentScore({
    questions: visibleQuestions,
    answers,
    snapshot: recruitmentScoring,
  });
  const patch = {
    recruitmentScoring,
    recruitmentScore,
    eligibilityStatus: recruitmentScore.status,
    rankingEligible: recruitmentScore.rankingEligible,
  };

  await Promise.all([
    hrDbAdmin.collection('applications').doc(params.applicationId).set(patch, { merge: true }),
    hrDbAdmin.collection('candidates').doc(params.candidateId).set(patch, { merge: true }),
  ]);

  return patch;
}

export async function GET(request: NextRequest) {
  const access = await assertHrAccess(request, 'view').catch(() => null);
  if (!access) return jsonError('Sem permissão para acessar candidatos.', 403);

  const snapshot = await hrDbAdmin.collection('candidates').orderBy('appliedAt', 'desc').get();
  const openingCache = new Map<string, Promise<FirebaseFirestore.DocumentData | null>>();
  const getOpeningData = (openingId: string) => {
    if (!openingCache.has(openingId)) {
      openingCache.set(openingId, hrDbAdmin.collection('jobOpenings').doc(openingId).get()
        .then(doc => doc.exists ? doc.data() ?? null : null));
    }
    return openingCache.get(openingId)!;
  };
  const candidates = await Promise.all(snapshot.docs.map(async (doc) => {
    let data = doc.data();
    const latestApplicationId = typeof data.latestApplicationId === 'string' ? data.latestApplicationId : null;
    if (!latestApplicationId) return { id: doc.id, ...data };

    const applicationDoc = await hrDbAdmin.collection('applications').doc(latestApplicationId).get();
    let latestApplication = applicationDoc.exists
      ? { id: applicationDoc.id, ...applicationDoc.data() }
      : null;
    if (applicationDoc.exists) {
      const applicationData = applicationDoc.data() ?? {};
      const backfilled = await maybeBackfillRecruitmentScore({
        candidateId: doc.id,
        applicationId: applicationDoc.id,
        candidateData: data,
        applicationData,
        getOpeningData,
      });
      if (backfilled) {
        data = { ...data, ...backfilled };
        latestApplication = latestApplication
          ? { ...latestApplication, ...backfilled }
          : { id: applicationDoc.id, ...applicationData, ...backfilled };
      }
    }
    return {
      id: doc.id,
      ...data,
      latestApplication,
    };
  }));
  return NextResponse.json(candidates);
}

export async function POST(request: NextRequest) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar candidatos.', 403);

  const body = await request.json();
  const now = new Date().toISOString();
  const email = normalizeEmail(body.email);

  if (!email) return jsonError('E-mail é obrigatório.');
  if (body.status !== undefined && !isCandidateStatus(body.status)) {
    return jsonError('Status inválido.');
  }

  const existing = await hrDbAdmin
    .collection('candidates')
    .where('email', '==', email)
    .limit(1)
    .get();

  const candidateRef = existing.empty ? hrDbAdmin.collection('candidates').doc() : existing.docs[0].ref;
  const existingData = existing.empty ? null : existing.docs[0].data();
  const existingStatus = isCandidateStatus(existingData?.status) ? existingData.status : null;
  const resolvedStatus = isCandidateStatus(body.status)
    ? body.status
    : (existingStatus ?? (body.jobOpeningId ? 'applied' : 'talent_pool'));
  const historyEntry = createCandidateStageHistoryEntry({
    fromStatus: existingStatus,
    toStatus: resolvedStatus,
    action: existing.empty ? 'created' : 'status_changed',
    note: typeof body.notes === 'string' ? body.notes : null,
    actorId: access.decoded.uid,
    actorEmail: access.decoded.email ?? null,
    createdAt: now,
  });
  let latestApplicationId = body.latestApplicationId ?? existingData?.latestApplicationId ?? null;

  if (body.jobOpeningId) {
    const applicationRef = hrDbAdmin.collection('applications').doc(`${candidateRef.id}_${body.jobOpeningId}`);
    const applicationDoc = await applicationRef.get();
    if (applicationDoc.exists && existingData?.jobOpeningId !== body.jobOpeningId) {
      return jsonError('Este candidato já tem candidatura para esta vaga.', 409);
    }
    latestApplicationId = applicationRef.id;
    await applicationRef.set({
      candidateId: candidateRef.id,
      jobOpeningId: body.jobOpeningId,
      jobRoleId: body.jobRoleId,
      jobRoleName: body.jobRoleName ?? null,
      stage: resolvedStatus,
      status: applicationStatusForCandidateStatus(resolvedStatus),
      source: body.source ?? 'manual',
      notes: body.notes ?? null,
      resumeUrl: body.resumeUrl ?? null,
      resumePath: body.resumePath ?? null,
      appliedAt: body.appliedAt || now,
      updatedAt: now,
      createdBy: access.decoded.uid,
      stageHistory: FieldValue.arrayUnion(historyEntry),
    }, { merge: true });
  }

  await candidateRef.set({
    ...body,
    email,
    status: resolvedStatus,
    latestApplicationId,
    recruitmentHistory: FieldValue.arrayUnion(historyEntry),
    appliedAt: body.appliedAt || now,
    updatedAt: now,
    createdBy: existingData?.createdBy ?? access.decoded.uid,
    firstAppliedAt: existingData?.firstAppliedAt ?? existingData?.appliedAt ?? body.appliedAt ?? now,
  }, { merge: true });

  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.candidates',
    action: existing.empty ? 'candidate_created' : 'candidate_updated',
    metadata: {
      target_type: 'candidate',
      target_id: candidateRef.id,
      target_name: body.name ?? email,
      email,
      job_opening_id: body.jobOpeningId ?? null,
      latest_application_id: latestApplicationId,
      reused: !existing.empty,
    },
    ttl_days: 365,
  });

  return NextResponse.json({ id: candidateRef.id, reused: !existing.empty }, { status: existing.empty ? 201 : 200 });
}
