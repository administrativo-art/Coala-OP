import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import type { HrFormQuestion, HrQuestionType } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar vagas.', 403);

  const { id } = await context.params;
  const body = await request.json();
  const { title, description, requirements, location, workType, slots, status, closesAt, formQuestions } = body;

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (title !== undefined) update.title = title;
  if (description !== undefined) update.description = description;
  if (requirements !== undefined) update.requirements = requirements;
  if (formQuestions !== undefined) update.formQuestions = normalizeFormQuestions(formQuestions);
  if (location !== undefined) update.location = location;
  if (workType !== undefined) update.workType = workType;
  if (slots !== undefined) update.slots = Number(slots);
  if (status !== undefined) update.status = status;
  if (closesAt !== undefined) update.closesAt = closesAt;

  await hrDbAdmin.collection('jobOpenings').doc(id).update(update);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar vagas.', 403);

  const { id } = await context.params;
  await hrDbAdmin.collection('jobOpenings').doc(id).delete();
  return NextResponse.json({ ok: true });
}
