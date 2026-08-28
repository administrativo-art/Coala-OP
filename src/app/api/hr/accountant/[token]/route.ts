import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { hashAccountantToken } from '@/features/hr/accountant/workflow';
import {
  prepareAccountantRegistryUpload,
  registryUploadAlreadyExists,
  storeAccountantRegistryUpload,
} from '@/features/hr/accountant/registry-upload.server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value: unknown, max = 1000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function clientEvidence(request: NextRequest) { return { ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null, userAgent: request.headers.get('user-agent')?.slice(0, 500) || null }; }

async function findProcess(token: string) {
  const result = await hrDbAdmin.collection('onboardingProcesses').where('accountantTokenHash', '==', hashAccountantToken(token)).limit(1).get();
  return result.empty ? null : result.docs[0];
}

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params; const snapshot = await findProcess(token);
  if (!snapshot) return NextResponse.json({ error: 'Link inválido.' }, { status: 404 });
  const process = snapshot.data(); const workflow = record(process.accountantWorkflow); const registry = record(workflow.registryDocument);
  const expiresAt = text(process.accountantTokenExpiresAt, 40);
  if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) return NextResponse.json({ error: 'Este link expirou. Solicite um novo link ao RH.' }, { status: 410 });
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
  const validation = await prepareAccountantRegistryUpload(file);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: validation.status });
  if (await registryUploadAlreadyExists(snapshot.id, validation.upload.hashSha256)) {
    return NextResponse.json({ error: 'Este mesmo arquivo já foi enviado anteriormente.' }, { status: 409 });
  }
  const now = new Date().toISOString();
  const evidence = clientEvidence(request);
  const registryDocument = await storeAccountantRegistryUpload({
    processId: snapshot.id,
    candidateName: text(process.candidateName, 180),
    upload: validation.upload,
    uploadedAt: now,
    uploader: 'accountant_public_link',
    ...evidence,
  });
  await Promise.all([
    snapshot.ref.set({ accountantWorkflow: { ...workflow, status: 'registry_received', registryDocument, updatedAt: now }, updatedAt: now }, { merge: true }),
    snapshot.ref.collection('accountantEvents').doc(randomUUID()).set({ type: 'ACCOUNTANT_REGISTRY_UPLOADED', at: now, actorId: null, actorEmail: null, versionId: registryDocument.versionId, hashSha256: registryDocument.hashSha256, size: registryDocument.size, ...evidence }),
    hrDbAdmin.collection('hrNotifications').doc(`accountant_registry_${snapshot.id}_${registryDocument.versionId}`).set({ type: 'accountant_registry_received', status: 'pending', onboardingId: snapshot.id, title: 'Ficha de registro recebida', message: `A contabilidade enviou a ficha de registro de ${text(process.candidateName, 240) || 'um colaborador'}.`, channels: ['in_app'], recipient: { strategy: 'hr_pool' }, createdAt: now, updatedAt: now }),
  ]);
  return NextResponse.json({ ok: true });
}
