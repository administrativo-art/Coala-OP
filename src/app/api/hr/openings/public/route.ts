import { NextResponse } from 'next/server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { getFeatureFlags } from '@/lib/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const flags = await getFeatureFlags();
  if (flags.kill_recruitment_public_landing) {
    return NextResponse.json({ error: 'Página de vagas temporariamente indisponível.' }, { status: 503 });
  }

  const snapshot = await hrDbAdmin
    .collection('jobOpenings')
    .where('status', '==', 'open')
    .orderBy('createdAt', 'desc')
    .get();

  const openings = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      title: data.title,
      slug: data.slug,
      jobRoleName: data.jobRoleName,
      description: data.description,
      requirements: data.requirements,
      location: data.location,
      workType: data.workType,
      slots: data.slots,
      closesAt: data.closesAt,
      createdAt: data.createdAt,
    };
  });

  return NextResponse.json(openings);
}
