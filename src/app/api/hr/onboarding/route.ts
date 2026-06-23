import { NextRequest, NextResponse } from 'next/server';

import { assertHrAccess, serializeHrValue } from '@/features/hr/lib/server-access';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const access = await assertHrAccess(request, 'view').catch(() => null);
  if (!access) return jsonError('Sem permissão para acessar onboarding.', 403);

  const snapshot = await hrDbAdmin
    .collection('onboardingProcesses')
    .orderBy('createdAt', 'desc')
    .get();

  return NextResponse.json({
    processes: snapshot.docs.map(doc => ({
      id: doc.id,
      ...((serializeHrValue(doc.data()) as Record<string, unknown>) ?? {}),
    })),
  });
}
