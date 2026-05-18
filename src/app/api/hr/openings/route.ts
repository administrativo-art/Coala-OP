import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import { logAction } from '@/lib/log-action';
import type { HrFormQuestion, HrQuestionType } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const QUESTION_TYPES: HrQuestionType[] = [
  'text',
  'yes_no',
  'select',
  'multi_select',
  'number_range',
  'date',
  'location',
  'file_upload',
];

function normalizeFormQuestions(value: unknown): HrFormQuestion[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): HrFormQuestion | null => {
      if (!item || typeof item !== 'object') return null;
      const data = item as Record<string, unknown>;
      const text = typeof data.text === 'string' ? data.text.trim().slice(0, 240) : '';
      const type = QUESTION_TYPES.includes(data.type as HrQuestionType)
        ? data.type as HrQuestionType
        : 'text';

      if (!text) return null;

      const rawConfig = data.config && typeof data.config === 'object' && !Array.isArray(data.config)
        ? data.config as Record<string, unknown>
        : undefined;
      const options = Array.isArray(rawConfig?.options)
        ? rawConfig.options
          .filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
          .map(option => option.trim().slice(0, 120))
        : [];

      return {
        id: typeof data.id === 'string' && data.id.trim() ? data.id.trim() : randomUUID(),
        text,
        type,
        required: data.required === true,
        scored: false,
        weight: data.weight === 'low' || data.weight === 'high' ? data.weight : 'medium',
        eliminatory: data.eliminatory === true,
        tags: Array.isArray(data.tags)
          ? data.tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean)
          : [],
        config: options.length > 0 ? { options } : undefined,
      };
    })
    .filter((item): item is HrFormQuestion => item !== null)
    .slice(0, 30);
}

export async function GET(request: NextRequest) {
  const access = await assertHrAccess(request, 'view').catch(() => null);
  if (!access) return jsonError('Sem permissão.', 403);

  const snapshot = await hrDbAdmin.collection('jobOpenings').orderBy('createdAt', 'desc').get();
  const openings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return NextResponse.json(openings);
}

export async function POST(request: NextRequest) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar vagas.', 403);

  const body = await request.json();
  const { title, jobRoleId, description, requirements, location, workType, slots, closesAt, formQuestions } = body;

  if (!title?.trim() || !jobRoleId) {
    return jsonError('Título e cargo são obrigatórios.');
  }

  const now = new Date().toISOString();
  const baseSlug = slugify(title.trim());
  const slug = `${baseSlug}-${Date.now().toString(36)}`;

  // Resolve role name and inherit formQuestions if none provided
  let jobRoleName: string | undefined;
  let inheritedQuestions: unknown[] = [];
  try {
    const roleDoc = await hrDbAdmin.collection('jobRoles').doc(jobRoleId).get();
    const roleData = roleDoc.data();
    jobRoleName = roleData?.name;
    if (!Array.isArray(formQuestions) || formQuestions.length === 0) {
      if (Array.isArray(roleData?.formQuestions)) {
        inheritedQuestions = roleData.formQuestions;
      }
    }
  } catch {
    // best-effort
  }

  const resolvedQuestions = Array.isArray(formQuestions) && formQuestions.length > 0
    ? formQuestions
    : inheritedQuestions;

  const ref = await hrDbAdmin.collection('jobOpenings').add({
    title: title.trim(),
    slug,
    jobRoleId,
    jobRoleName,
    description: description?.trim() || null,
    requirements: Array.isArray(requirements) ? requirements : [],
    formQuestions: normalizeFormQuestions(resolvedQuestions),
    location: location?.trim() || null,
    workType: workType || null,
    slots: Number(slots) || 1,
    status: 'open',
    closesAt: closesAt || null,
    createdAt: now,
    updatedAt: now,
    createdBy: access.decoded.uid,
  });

  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.openings',
    action: 'opening_created',
    metadata: {
      target_type: 'job_opening',
      target_id: ref.id,
      target_name: title.trim(),
      job_role_id: jobRoleId,
      job_role_name: jobRoleName ?? null,
      slots: Number(slots) || 1,
      status: 'open',
    },
    ttl_days: 365,
  });

  return NextResponse.json({ id: ref.id, slug }, { status: 201 });
}
