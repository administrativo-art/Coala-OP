import { NextResponse } from 'next/server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { getFeatureFlags } from '@/lib/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    const openings = snapshot.docs
      .map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title ?? '',
          slug: data.slug ?? '',
          jobRoleName: data.jobRoleName ?? null,
          description: data.description ?? null,
          requirements: Array.isArray(data.requirements) ? data.requirements : [],
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
