import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';

import { hashAccountantToken } from '@/features/hr/accountant/workflow';
import { adminApp } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 15 * 1024 * 1024;
function text(value: unknown, max = 1000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function clientEvidence(request: NextRequest) { return { ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null, userAgent: request.headers.get('user-agent')?.slice(0, 500) || null }; }

async function findProcess(token: string) {
  const result = await hrDbAdmin.collection('onboardingProcesses').where('accountantTokenHash', '==', hashAccountantToken(token)).limit(1).get();
  return result.empty ? null : result.docs[0];
}

function validPdf(buffer: Buffer) { return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-'; }

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params; const snapshot = await findProcess(token);
  if (!snapshot) return NextResponse.json({ error: 'Link inválido.' }, { status: 404 });
  const process = snapshot.data(); const workflow = record(process.accountantWorkflow); const registry = record(workflow.registryDocument);
  const expiresAt = text(process.accountantTokenExpiresAt, 40);
  if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) return NextResponse.json({ error: 'Este link expirou. Solicite um novo link ao RH.' }, { status: 410 });
  const now = new Date().toISOString();
  await snapshot.ref.collection('accountantEvents').doc(randomUUID()).set({ type: 'ACCOUNTANT_UPLOAD_LINK_ACCESSED', at: now, actorId: null, actorEmail: null, ...clientEvidence(request) });
  return NextResponse.json({
    candidateName: text(process.candidateName, 240),
    companyName: text(process.employerUnitName, 240) || text(process.unitName, 240),
    alreadyUploaded: Boolean(text(registry.storagePath, 1500)) && text(registry.status, 30) !== 'rejected',
    rejected: text(registry.status, 30) === 'rejected', rejectionReason: text(registry.rejectionReason, 1000) || null, expiresAt,
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params; const snapshot = await findProcess(token);
  if (!snapshot) return NextResponse.json({ error: 'Link inválido.' }, { status: 404 });
  const process = snapshot.data(); const workflow = record(process.accountantWorkflow); const current = record(workflow.registryDocument);
  const expiresAt = text(process.accountantTokenExpiresAt, 40);
  if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) return NextResponse.json({ error: 'Este link expirou.' }, { status: 410 });
  if (text(current.storagePath, 1500) && text(current.status, 30) !== 'rejected') return NextResponse.json({ error: 'A ficha já foi enviada e está em conferência.' }, { status: 409 });
  const form = await request.formData(); const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Selecione a Ficha de Registro de Empregado.' }, { status: 400 });
  if (file.type !== 'application/pdf') return NextResponse.json({ error: 'Envie a ficha de registro em PDF.' }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'O arquivo deve ter até 15 MB.' }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!validPdf(buffer)) return NextResponse.json({ error: 'O arquivo enviado não é um PDF válido.' }, { status: 400 });
  const hashSha256 = createHash('sha256').update(buffer).digest('hex'); const versionId = randomUUID(); const now = new Date().toISOString();
  const storagePath = `hr/onboarding/${snapshot.id}/accountant/registry/${versionId}.pdf`;
  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, { resumable: false, metadata: { contentType: 'application/pdf', cacheControl: 'private, max-age=0, no-store', metadata: { onboardingId: snapshot.id, versionId, hashSha256 } } });
  const registryDocument = { versionId, fileName: `Ficha de registro - ${text(process.candidateName, 180) || 'colaborador'}.pdf`, originalName: file.name.slice(0, 240), storagePath, hashSha256, mimeType: 'application/pdf', size: file.size, uploadedAt: now, status: 'received', reviewedAt: null, reviewedBy: null, rejectionReason: null };
  await Promise.all([
    snapshot.ref.set({ accountantWorkflow: { ...workflow, status: 'registry_received', registryDocument, updatedAt: now }, updatedAt: now }, { merge: true }),
    snapshot.ref.collection('accountantRegistryVersions').doc(versionId).set({ ...registryDocument, uploader: 'accountant_public_link', ...clientEvidence(request) }),
    snapshot.ref.collection('accountantEvents').doc(randomUUID()).set({ type: 'ACCOUNTANT_REGISTRY_UPLOADED', at: now, actorId: null, actorEmail: null, versionId, hashSha256, size: file.size, ...clientEvidence(request) }),
    hrDbAdmin.collection('hrNotifications').doc(`accountant_registry_${snapshot.id}_${versionId}`).set({ type: 'accountant_registry_received', status: 'pending', onboardingId: snapshot.id, title: 'Ficha de registro recebida', message: `A contabilidade enviou a ficha de registro de ${text(process.candidateName, 240) || 'um colaborador'}.`, channels: ['in_app'], recipient: { strategy: 'hr_pool' }, createdAt: now, updatedAt: now }),
  ]);
  return NextResponse.json({ ok: true });
}
