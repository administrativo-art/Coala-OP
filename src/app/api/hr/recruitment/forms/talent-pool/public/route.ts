import { NextResponse } from 'next/server';

import { dbAdmin } from '@/lib/firebase-admin';
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
  return data.isArchived !== true &&
    data.active !== false &&
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

function cleanCityLabel(data: FirebaseFirestore.DocumentData) {
  const direct = cleanOptionLabel(data.city || data.cidade || data.municipio || data.municipality);
  if (direct) return direct;
  const address = data.address && typeof data.address === 'object' ? data.address as Record<string, unknown> : null;
  const addressCity = address ? cleanOptionLabel(address.city || address.cidade || address.municipio) : '';
  return addressCity || 'São Luís';
}

async function getPublicCityOptions() {
  const unitsSnap = await dbAdmin.collection('dp_units').get();
  const options = unitsSnap.docs
    .map(doc => doc.data())
    .filter(isActiveRecord)
    .map(cleanCityLabel)
    .filter(Boolean);
  return Array.from(new Set(options.length > 0 ? options : ['São Luís']))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

async function getPublicDepartmentOptions() {
  const departmentsSnap = await hrDbAdmin.collection('jobDepartments').orderBy('name').get();
  const departments = departmentsSnap.docs
    .map(doc => doc.data())
    .filter(isActiveRecord)
    .map(data => {
      const name = cleanOptionLabel(data.name);
      if (!name) return null;
      const description = cleanOptionLabel(data.description);
      return { name, description };
    })
    .filter((entry): entry is { name: string; description: string } => entry !== null);
  const names = Array.from(new Set(departments.map(item => item.name))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const descriptions = Object.fromEntries(
    departments
      .filter(item => item.description)
      .map(item => [item.name, item.description])
  );
  return { names, descriptions };
}

export async function GET() {
  const [doc, rolesFunctions, cities, departments] = await Promise.all([
    hrDbAdmin.collection('recruitmentForms').doc(TALENT_POOL_FORM_ID).get(),
    getPublicRoleFunctionOptions(),
    getPublicCityOptions(),
    getPublicDepartmentOptions(),
  ]);
  const form = normalizeRecruitmentFormConfig(
    doc.exists ? { id: doc.id, ...doc.data() } : DEFAULT_TALENT_POOL_FORM
  );

  const fallbackPublicForm = {
    ...DEFAULT_TALENT_POOL_FORM,
    questions: hydrateRecruitmentQuestionDynamicOptions(
      getPublicRecruitmentQuestions(DEFAULT_TALENT_POOL_FORM.questions),
      {
        rolesFunctions,
        cities,
        departments: departments.names,
        departmentDescriptions: departments.descriptions,
      }
    ),
  };

  const publicForm = form.status === 'published'
    ? {
        ...form,
        questions: hydrateRecruitmentQuestionDynamicOptions(
          getPublicRecruitmentQuestions(form.questions),
          {
            rolesFunctions,
            cities,
            departments: departments.names,
            departmentDescriptions: departments.descriptions,
          }
        ),
      }
    : fallbackPublicForm;

  return NextResponse.json(publicForm, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
