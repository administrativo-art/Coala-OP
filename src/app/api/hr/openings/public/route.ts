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

    const roleIds = Array.from(
      new Set(
        snapshot.docs
          .map(doc => doc.data().jobRoleId)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      )
    );
    const roleEntries = await Promise.all(
      roleIds.map(async (roleId) => {
        const roleDoc = await hrDbAdmin.collection('jobRoles').doc(roleId).get();
        const questions = roleDoc.exists && Array.isArray(roleDoc.data()?.formQuestions)
          ? roleDoc.data()?.formQuestions as HrFormQuestion[]
          : [];
        return [roleId, toPublicQuestions(questions)] as const;
      })
    );
    const questionsByRoleId = new Map(roleEntries);

    const openings = snapshot.docs
      .map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          jobRoleId: data.jobRoleId ?? null,
          title: data.title ?? '',
          slug: data.slug ?? '',
          jobRoleName: data.jobRoleName ?? null,
          description: data.description ?? null,
          requirements: Array.isArray(data.requirements) ? data.requirements : [],
          formQuestions: typeof data.jobRoleId === 'string'
            ? questionsByRoleId.get(data.jobRoleId) ?? []
            : [],
          location: data.location ?? null,
          workType: data.workType ?? null,
          slots: data.slots ?? 1,
          closesAt: data.closesAt ?? null,
          createdAt: data.createdAt ?? '',
        };
      })
      .filter(o => o.slug && o.title)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return NextResponse.json(openings);
  } catch (err) {
    console.error('[hr/openings/public] Erro ao buscar vagas:', err);
    return NextResponse.json([], { status: 200 });
  }
}
