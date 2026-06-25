import { NextRequest, NextResponse } from 'next/server';

import { assertHrAccess } from '@/features/hr/lib/server-access';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { logAction } from '@/lib/log-action';
import {
  DEFAULT_TALENT_POOL_FORM,
  TALENT_POOL_FORM_ID,
  normalizeRecruitmentFormConfig,
} from '@/lib/recruitment-forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function removeUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => removeUndefinedDeep(item)) as T;
  }

  if (value instanceof Date) {
    return value;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, removeUndefinedDeep(entry)])
    ) as T;
  }

  return value;
}

export async function GET(request: NextRequest) {
  const access = await assertHrAccess(request, 'view').catch(() => null);
  if (!access) return jsonError('Sem permissão para acessar formulários de recrutamento.', 403);

  const doc = await hrDbAdmin.collection('recruitmentForms').doc(TALENT_POOL_FORM_ID).get();
  const form = normalizeRecruitmentFormConfig(
    doc.exists ? { id: doc.id, ...doc.data() } : DEFAULT_TALENT_POOL_FORM
  );

  return NextResponse.json(form);
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, 'manage').catch(() => null);
    if (!access) return jsonError('Sem permissão para gerenciar formulários de recrutamento.', 403);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return jsonError('Payload inválido.');

    const existingDoc = await hrDbAdmin.collection('recruitmentForms').doc(TALENT_POOL_FORM_ID).get();
    const existing = normalizeRecruitmentFormConfig(
      existingDoc.exists ? { id: existingDoc.id, ...existingDoc.data() } : DEFAULT_TALENT_POOL_FORM
    );
    const now = new Date().toISOString();
    const next = normalizeRecruitmentFormConfig({
      ...existing,
      ...body,
      id: TALENT_POOL_FORM_ID,
      kind: 'talent_pool',
      version: existing.version + 1,
      updatedAt: now,
      updatedBy: access.decoded.uid,
      publishedAt: body.status === 'draft' ? existing.publishedAt ?? null : now,
    });
    const writableForm = removeUndefinedDeep(next);

    await hrDbAdmin.collection('recruitmentForms').doc(TALENT_POOL_FORM_ID).set(writableForm, { merge: false });

    await logAction({
      user_id: access.decoded.uid,
      username: access.decoded.email ?? null,
      module: 'recruitment.forms',
      action: 'talent_pool_form_updated',
      metadata: {
        target_type: 'recruitment_form',
        target_id: TALENT_POOL_FORM_ID,
        status: next.status,
        question_count: next.questions.length,
        version: next.version,
      },
      ttl_days: 365,
    });

    return NextResponse.json(next);
  } catch (error) {
    console.error('[recruitment.forms] Falha ao salvar banco de talentos:', error);
    return jsonError('Falha ao salvar formulário de recrutamento.', 500);
  }
}
