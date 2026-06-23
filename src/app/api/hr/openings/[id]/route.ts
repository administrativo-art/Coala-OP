import { NextRequest, NextResponse } from 'next/server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import { logAction } from '@/lib/log-action';
import { normalizeRecruitmentQuestions } from '@/lib/recruitment-forms';
import { normalizeRecruitmentStages } from '@/lib/recruitment-pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar vagas.', 403);

  const { id } = await context.params;
  const body = await request.json();
  const { title, description, requirements, location, workType, slots, status, closesAt, formQuestions, pipelineStages } = body;

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (title !== undefined) update.title = title;
  if (description !== undefined) update.description = description;
  if (requirements !== undefined) update.requirements = requirements;
  if (formQuestions !== undefined) update.formQuestions = normalizeRecruitmentQuestions(formQuestions);
  if (pipelineStages !== undefined) update.pipelineStages = normalizeRecruitmentStages(pipelineStages);
  if (location !== undefined) update.location = location;
  if (workType !== undefined) update.workType = workType;
  if (slots !== undefined) update.slots = Number(slots);
  if (status !== undefined) update.status = status;
  if (closesAt !== undefined) update.closesAt = closesAt;

  const currentDoc = await hrDbAdmin.collection('jobOpenings').doc(id).get();
  const before = currentDoc.data() ?? {};
  await hrDbAdmin.collection('jobOpenings').doc(id).update(update);
  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.openings',
    action: 'opening_updated',
    metadata: {
      target_type: 'job_opening',
      target_id: id,
      target_name: update.title ?? before.title ?? id,
      changed_fields: Object.keys(update).filter((key) => key !== 'updatedAt'),
      before: {
        title: before.title ?? null,
        status: before.status ?? null,
        slots: before.slots ?? null,
        location: before.location ?? null,
      },
      after: {
        title: update.title ?? before.title ?? null,
        status: update.status ?? before.status ?? null,
        slots: update.slots ?? before.slots ?? null,
        location: update.location ?? before.location ?? null,
      },
    },
    ttl_days: 365,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar vagas.', 403);

  const { id } = await context.params;
  const currentDoc = await hrDbAdmin.collection('jobOpenings').doc(id).get();
  const before = currentDoc.data() ?? {};
  await hrDbAdmin.collection('jobOpenings').doc(id).delete();
  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.openings',
    action: 'opening_deleted',
    metadata: {
      target_type: 'job_opening',
      target_id: id,
      target_name: before.title ?? id,
      status: before.status ?? null,
      slots: before.slots ?? null,
    },
    ttl_days: 365,
  });
  return NextResponse.json({ ok: true });
}
