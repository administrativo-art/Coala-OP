import { NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { getFeatureFlags } from '@/lib/feature-flags';
import { getPublicRecruitmentQuestions, hydrateRecruitmentQuestionDynamicOptions } from '@/lib/recruitment-forms';
import type { HrFormQuestion } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isActiveRecord(data: FirebaseFirestore.DocumentData) {
  return data.active !== false &&
    data.isActive !== false &&
    data.status !== 'inactive' &&
    data.status !== 'inativo' &&
    data.status !== 'terminated';
}

function normalizeUnitName(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

async function getPublicUnitOptions() {
  const unitsSnap = await dbAdmin.collection('dp_units').get();
  return Array.from(new Set(
    unitsSnap.docs
      .map(doc => doc.data())
      .filter(isActiveRecord)
      .map(data => normalizeUnitName(data.name))
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, 'pt-BR'));
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

function toPublicQuestions(questions: HrFormQuestion[], units: string[], rolesFunctions: string[]) {
  return hydrateRecruitmentQuestionDynamicOptions(
    getPublicRecruitmentQuestions(questions),
    { units, rolesFunctions }
  ).map(question => ({
    id: question.id,
    text: question.text,
    type: question.type,
    sectionId: question.sectionId,
    sectionTitle: question.sectionTitle,
    sectionOrder: question.sectionOrder,
    parentQuestionId: question.parentQuestionId,
    subquestionOrder: question.subquestionOrder,
    required: question.required,
    eliminatory: question.eliminatory,
    weight: question.weight,
    config: question.config,
    conditions: question.conditions,
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
    const [snapshot, publicUnits, rolesFunctions] = await Promise.all([
      hrDbAdmin
        .collection('jobOpenings')
        .where('status', '==', 'open')
        .get(),
      getPublicUnitOptions(),
      getPublicRoleFunctionOptions(),
    ]);

    const now = new Date().toISOString();
    const openings = snapshot.docs
      .map(doc => {
        const data = doc.data();
        const formQuestions = Array.isArray(data.formQuestions)
          ? toPublicQuestions(data.formQuestions as HrFormQuestion[], publicUnits, rolesFunctions)
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
          benefits: Array.isArray(data.benefits) ? data.benefits : [],
          publicSalaryRange: data.publicSalaryRange ?? null,
          applyButtonLabel: data.applyButtonLabel ?? null,
          formQuestions,
          location: data.unitName ?? data.location ?? null,
          workSchedule: data.workSchedule ?? data.shiftDefinitionName ?? null,
          unitName: data.unitName ?? null,
          shiftDefinitionName: data.shiftDefinitionName ?? null,
          workType: data.workType ?? null,
          contractTypeLabel: data.contractTypeLabel ?? null,
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
