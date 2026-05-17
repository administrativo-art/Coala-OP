import { NextRequest, NextResponse } from 'next/server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';

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
  const { title, jobRoleId, description, requirements, location, workType, slots, closesAt } = body;

  if (!title?.trim() || !jobRoleId) {
    return jsonError('Título e cargo são obrigatórios.');
  }

  const now = new Date().toISOString();
  const baseSlug = slugify(title.trim());
  const slug = `${baseSlug}-${Date.now().toString(36)}`;

  // Resolve role name
  let jobRoleName: string | undefined;
  try {
    const roleDoc = await hrDbAdmin.collection('jobRoles').doc(jobRoleId).get();
    jobRoleName = roleDoc.data()?.name;
  } catch {
    // best-effort
  }

  const ref = await hrDbAdmin.collection('jobOpenings').add({
    title: title.trim(),
    slug,
    jobRoleId,
    jobRoleName,
    description: description?.trim() || null,
    requirements: Array.isArray(requirements) ? requirements : [],
    location: location?.trim() || null,
    workType: workType || null,
    slots: Number(slots) || 1,
    status: 'open',
    closesAt: closesAt || null,
    createdAt: now,
    updatedAt: now,
    createdBy: access.decoded.uid,
  });

  return NextResponse.json({ id: ref.id, slug }, { status: 201 });
}
