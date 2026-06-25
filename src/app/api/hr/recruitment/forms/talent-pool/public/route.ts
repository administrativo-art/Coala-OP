import { NextResponse } from 'next/server';

import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import {
  DEFAULT_TALENT_POOL_FORM,
  TALENT_POOL_FORM_ID,
  getPublicRecruitmentQuestions,
  hydrateRecruitmentQuestionDynamicOptions,
  normalizeRecruitmentFormConfig,
} from '@/lib/recruitment-forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isActiveRecord(data: FirebaseFirestore.DocumentData) {
  return data.active !== false &&
    data.isActive !== false &&
    data.status !== 'inactive' &&
    data.status !== 'inativo' &&
    data.status !== 'terminated';
}

function cleanOptionLabel(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

async function getPublicRoleFunctionOptions() {
  const [rolesSnap, functionsSnap] = await Promise.all([
    hrDbAdmin.collection('jobRoles').orderBy('name').get(),
    hrDbAdmin.collection('jobFunctions').orderBy('name').get(),
  ]);

  const options = [
    ...rolesSnap.docs
      .map(doc => doc.data())
      .filter(isActiveRecord)
      .map(data => cleanOptionLabel(data.publicTitle || data.name))
      .filter(Boolean)
      .map(label => `Cargo · ${label}`),
    ...functionsSnap.docs
      .map(doc => doc.data())
      .filter(isActiveRecord)
      .map(data => cleanOptionLabel(data.publicTitle || data.name))
      .filter(Boolean)
      .map(label => `Função · ${label}`),
  ];

  return Array.from(new Set(options)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export async function GET() {
  const [doc, rolesFunctions] = await Promise.all([
    hrDbAdmin.collection('recruitmentForms').doc(TALENT_POOL_FORM_ID).get(),
    getPublicRoleFunctionOptions(),
  ]);
  const form = normalizeRecruitmentFormConfig(
    doc.exists ? { id: doc.id, ...doc.data() } : DEFAULT_TALENT_POOL_FORM
  );

  const fallbackPublicForm = {
    ...DEFAULT_TALENT_POOL_FORM,
    questions: hydrateRecruitmentQuestionDynamicOptions(
      getPublicRecruitmentQuestions(DEFAULT_TALENT_POOL_FORM.questions),
      { rolesFunctions }
    ),
  };

  const publicForm = form.status === 'published'
    ? {
        ...form,
        questions: hydrateRecruitmentQuestionDynamicOptions(
          getPublicRecruitmentQuestions(form.questions),
          { rolesFunctions }
        ),
      }
    : fallbackPublicForm;

  return NextResponse.json(publicForm, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
