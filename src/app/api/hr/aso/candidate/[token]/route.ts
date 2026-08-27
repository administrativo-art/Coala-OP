import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';

import { hashAsoToken } from '@/features/hr/aso/workflow';
import { adminApp } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
function text(value: unknown, max = 1000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0, must-revalidate' },
  });
}

async function findProcess(token: string) {
  const result = await hrDbAdmin.collection('onboardingProcesses').where('asoCandidateTokenHash', '==', hashAsoToken(token)).limit(1).get();
  return result.empty ? null : result.docs[0];
}

function uploadOpen(appointmentAt: string) {
  if (!appointmentAt) return false;
  const date = appointmentAt.slice(0, 10);
  return Date.now() >= new Date(`${date}T00:00:00-03:00`).getTime();
}

function validSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return false;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const snapshot = await findProcess(token);
  if (!snapshot) return json({ error: 'Link inválido.' }, 404);
  const process = snapshot.data(); const workflow = record(process.asoWorkflow); const appointment = record(workflow.appointment);
  const expiresAt = text(process.asoCandidateTokenExpiresAt, 40);
  if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) return json({ error: 'Este link expirou. Solicite um novo link ao RH.' }, 410);
  return json({
    candidateName: text(process.candidateName, 240),
    examType: process.asoExamType === 'dismissal' ? 'dismissal' : 'admission',
    uploadEnabled: uploadOpen(text(workflow.appointmentAt, 40)), uploadOpensOn: text(appointment.date, 10),
    alreadyUploaded: Boolean(text(record(workflow.asoDocument).storagePath, 1500)) && text(record(workflow.asoDocument).status, 30) !== 'rejected', expiresAt,
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const snapshot = await findProcess(token);
  if (!snapshot) return json({ error: 'Link inválido.' }, 404);
  const process = snapshot.data(); const workflow = record(process.asoWorkflow);
  const expiresAt = text(process.asoCandidateTokenExpiresAt, 40);
  if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) return json({ error: 'Este link expirou.' }, 410);
  if (!uploadOpen(text(workflow.appointmentAt, 40))) return json({ error: 'O envio será liberado no dia do exame.' }, 409);
  const form = await request.formData(); const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'Selecione o arquivo do ASO.' }, 400);
  if (!ALLOWED_TYPES.has(file.type)) return json({ error: 'Envie o ASO em PDF, JPG ou PNG.' }, 400);
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) return json({ error: 'O arquivo deve ter até 15 MB.' }, 400);
  const buffer = Buffer.from(await file.arrayBuffer()); const hashSha256 = createHash('sha256').update(buffer).digest('hex');
  if (!validSignature(buffer, file.type)) return json({ error: 'O conteúdo do arquivo não corresponde ao formato informado.' }, 400);
  const now = new Date().toISOString(); const extension = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
  const storagePath = `hr/onboarding/${snapshot.id}/aso/returned/${randomUUID()}.${extension}`;
  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, { resumable: false, metadata: { contentType: file.type, cacheControl: 'private, max-age=0, no-store', metadata: { onboardingId: snapshot.id, hashSha256 } } });
  const asoDocument = { fileName: file.name.slice(0, 240), storagePath, hashSha256, mimeType: file.type, size: file.size, uploadedAt: now, status: 'received', reviewedAt: null, reviewedBy: null, rejectionReason: null };
  const examLabel = process.asoExamType === 'dismissal' ? 'demissional' : 'admissional';
  await Promise.all([
    snapshot.ref.set({ asoWorkflow: { ...workflow, status: 'aso_received', asoDocument, updatedAt: now }, asoCandidateTokenUsedAt: now, updatedAt: now }, { merge: true }),
    snapshot.ref.collection('asoEvents').doc(randomUUID()).set({ type: 'ASO_UPLOADED_BY_CANDIDATE', at: now, actorId: null, actorEmail: text(process.candidateEmail, 320) || null, fileName: asoDocument.fileName, hashSha256, size: file.size }),
    hrDbAdmin.collection('hrNotifications').doc(`aso_received_${snapshot.id}_${hashSha256.slice(0, 16)}`).set({ type: 'aso_received', status: 'pending', onboardingId: snapshot.id, title: 'ASO recebido para conferência', message: `${text(process.candidateName, 240) || 'O colaborador'} enviou o ASO ${examLabel}.`, channels: ['in_app'], recipient: { strategy: 'hr_pool' }, createdAt: now, updatedAt: now }),
  ]);
  return json({ ok: true });
}
