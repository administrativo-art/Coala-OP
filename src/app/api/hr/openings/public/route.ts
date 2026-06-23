import { NextResponse } from 'next/server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { getFeatureFlags } from '@/lib/feature-flags';
import type { HrFormQuestion } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toPublicQuestions(questions: HrFormQuestion[]) {
  return questions.map(question => ({
    id: question.id,
    text: question.text,
    type: question.type,
    required: question.required,
    eliminatory: question.eliminatory,
    weight: question.weight,
    config: question.config,
  }));
}

function isInsideApplicationWindow(data: FirebaseFirestore.DocumentData, now: string) {
  const start = typeof data.applicationStartAt === 'string' ? data.applicationStartAt : null;
  const end = typeof data.applicationEndAt === 'string'
    ? data.applicationEndAt
    : typeof data.closesAt === 'string'
      ? data.closesAt
      : null;

  if (start && start > now) return false;
  if (end && end < now) return false;
  return true;
}

export async function GET() {
  try {
    const flags = await getFeatureFlags();
    if (flags.kill_recruitment_public_landing) {
      return NextResponse.json([], { status: 200 });
    }

    // Evita índice composto: filtra por status sem orderBy no Firestore,
    // ordena no servidor pelo createdAt.
    const snapshot = await hrDbAdmin
      .collection('jobOpenings')
      .where('status', '==', 'open')
      .get();

    const now = new Date().toISOString();
    const openings = snapshot.docs
      .map(doc => {
        const data = doc.data();
        const formQuestions = Array.isArray(data.formQuestions)
          ? toPublicQuestions(data.formQuestions as HrFormQuestion[])
          : [];
        return {
          id: doc.id,
          jobRoleId: data.jobRoleId ?? null,
          functionId: data.functionId ?? null,
          unitId: data.unitId ?? null,
          shiftDefinitionId: data.shiftDefinitionId ?? null,
          title: data.title ?? '',
          slug: data.slug ?? '',
          jobRoleName: data.jobRoleName ?? null,
          functionName: data.functionName ?? null,
          description: data.description ?? null,
          requirements: Array.isArray(data.requirements) ? data.requirements : [],
          formQuestions,
          location: data.unitName ?? data.location ?? null,
          unitName: data.unitName ?? null,
          shiftDefinitionName: data.shiftDefinitionName ?? null,
          workType: data.workType ?? null,
          slots: data.slots ?? 1,
          applicationStartAt: data.applicationStartAt ?? null,
          applicationEndAt: data.applicationEndAt ?? null,
          closesAt: data.closesAt ?? null,
          createdAt: data.createdAt ?? '',
          isReceivingApplications: isInsideApplicationWindow(data, now),
        };
      })
      .filter(o => o.slug && o.title && o.isReceivingApplications)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return NextResponse.json(openings);
  } catch (err) {
    console.error('[hr/openings/public] Erro ao buscar vagas:', err);
    return NextResponse.json([], { status: 200 });
  }
}
