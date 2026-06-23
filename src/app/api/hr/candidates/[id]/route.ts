import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import { logAction } from '@/lib/log-action';
import {
  applicationStatusForCandidateStatus,
  createCandidateStageHistoryEntry,
  isCandidateDecisionAction,
  isCandidateStatus,
} from '@/lib/recruitment-pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar candidatos.', 403);

  const { id } = await context.params;
  const body = await request.json();
  const now = new Date().toISOString();
  const currentDoc = await hrDbAdmin.collection('candidates').doc(id).get();
  const before = currentDoc.data() ?? {};
  const { decisionAction, decisionNote, ...candidatePatch } = body;
  const status = isCandidateStatus(candidatePatch.status) ? candidatePatch.status : null;

  if (candidatePatch.status !== undefined && !status) {
    return jsonError('Status inválido.');
  }

  const beforeStatus = isCandidateStatus(before.status) ? before.status : null;
  const statusChanged = !!status && status !== beforeStatus;
  const historyEntry = statusChanged
    ? createCandidateStageHistoryEntry({
        fromStatus: beforeStatus,
        toStatus: status,
        action: isCandidateDecisionAction(decisionAction) ? decisionAction : null,
        note: typeof decisionNote === 'string' ? decisionNote : null,
        actorId: access.decoded.uid,
        actorEmail: access.decoded.email ?? null,
        createdAt: now,
      })
    : null;

  await hrDbAdmin.collection('candidates').doc(id).update({
    ...candidatePatch,
    updatedAt: now,
    ...(historyEntry ? { recruitmentHistory: FieldValue.arrayUnion(historyEntry) } : {}),
  });

  const latestApplicationId = typeof candidatePatch.latestApplicationId === 'string'
    ? candidatePatch.latestApplicationId
    : before.latestApplicationId;
  if (latestApplicationId && status) {
    await hrDbAdmin.collection('applications').doc(latestApplicationId).set({
      stage: status,
      status: applicationStatusForCandidateStatus(status),
      updatedAt: now,
      updatedBy: access.decoded.uid,
      ...(historyEntry ? { stageHistory: FieldValue.arrayUnion(historyEntry) } : {}),
    }, { merge: true });
  }

  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.candidates',
    action: 'candidate_updated',
    metadata: {
      target_type: 'candidate',
      target_id: id,
      target_name: before.name ?? before.email ?? id,
      changed_fields: Object.keys(candidatePatch),
      decision_action: historyEntry?.action ?? null,
      before: {
        status: before.status ?? null,
        jobOpeningId: before.jobOpeningId ?? null,
        latestApplicationId: before.latestApplicationId ?? null,
      },
      after: {
        status: candidatePatch.status ?? before.status ?? null,
        jobOpeningId: candidatePatch.jobOpeningId ?? before.jobOpeningId ?? null,
        latestApplicationId,
      },
    },
    ttl_days: 365,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar candidatos.', 403);

  const { id } = await context.params;
  const currentDoc = await hrDbAdmin.collection('candidates').doc(id).get();
  const before = currentDoc.data() ?? {};
  await hrDbAdmin.collection('candidates').doc(id).delete();
  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.candidates',
    action: 'candidate_deleted',
    metadata: {
      target_type: 'candidate',
      target_id: id,
      target_name: before.name ?? before.email ?? id,
      email: before.email ?? null,
      status: before.status ?? null,
    },
    ttl_days: 365,
  });
  return NextResponse.json({ ok: true });
}
