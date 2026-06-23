import { NextRequest, NextResponse } from 'next/server';

import { assertHrAccess, serializeHrValue } from '@/features/hr/lib/server-access';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'view').catch(() => null);
  if (!access) return jsonError('Sem permissão para acessar candidato.', 403);

  const { id } = await context.params;
  const candidateDoc = await hrDbAdmin.collection('candidates').doc(id).get();
  if (!candidateDoc.exists) return jsonError('Candidato não encontrado.', 404);

  const [applicationsSnap, onboardingSnap] = await Promise.all([
    hrDbAdmin.collection('applications').where('candidateId', '==', id).get(),
    hrDbAdmin.collection('onboardingProcesses').where('candidateId', '==', id).get(),
  ]);

  const applications = applicationsSnap.docs
    .map((doc): Record<string, unknown> => ({
      id: doc.id,
      ...((serializeHrValue(doc.data()) as Record<string, unknown>) ?? {}),
    }))
    .sort((a, b) => String(b.appliedAt ?? b.updatedAt ?? '').localeCompare(String(a.appliedAt ?? a.updatedAt ?? '')));

  const onboardingProcesses = onboardingSnap.docs
    .map((doc): Record<string, unknown> => ({
      id: doc.id,
      ...((serializeHrValue(doc.data()) as Record<string, unknown>) ?? {}),
    }))
    .sort((a, b) => String(b.createdAt ?? b.updatedAt ?? '').localeCompare(String(a.createdAt ?? a.updatedAt ?? '')));

  return NextResponse.json({
    candidate: {
      id: candidateDoc.id,
      ...((serializeHrValue(candidateDoc.data()) as Record<string, unknown>) ?? {}),
    },
    applications,
    onboardingProcesses,
  });
}
