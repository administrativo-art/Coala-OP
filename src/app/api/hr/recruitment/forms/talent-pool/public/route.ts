import { NextResponse } from 'next/server';

import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import {
  DEFAULT_TALENT_POOL_FORM,
  TALENT_POOL_FORM_ID,
  normalizeRecruitmentFormConfig,
} from '@/lib/recruitment-forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const doc = await hrDbAdmin.collection('recruitmentForms').doc(TALENT_POOL_FORM_ID).get();
  const form = normalizeRecruitmentFormConfig(
    doc.exists ? { id: doc.id, ...doc.data() } : DEFAULT_TALENT_POOL_FORM
  );

  const publicForm = form.status === 'published' ? form : DEFAULT_TALENT_POOL_FORM;

  return NextResponse.json(publicForm, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
