import { NextRequest, NextResponse } from 'next/server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar vagas.', 403);

  const { id } = await context.params;
  const body = await request.json();
  const { title, description, requirements, location, workType, slots, status, closesAt } = body;

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (title !== undefined) update.title = title;
  if (description !== undefined) update.description = description;
  if (requirements !== undefined) update.requirements = requirements;
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
