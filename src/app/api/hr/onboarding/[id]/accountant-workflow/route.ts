import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';

import { accountantAdmissionEmailContent, renderAccountantAdmissionEmail } from '@/features/hr/accountant/emails';
import { accountantAttachmentName, accountantTokenExpiresAt, candidateDocumentsForAccountant, createAccountantToken, missingAccountantPrerequisites } from '@/features/hr/accountant/workflow';
import { assertFormalizationAccess } from '@/features/hr/lib/server-access';
import { sendEmail, EMAIL_SENDERS } from '@/lib/email/resend';
import { adminApp } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { applyOnboardingSignatureMode, normalizeOnboardingStages } from '@/lib/recruitment-onboarding';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import { resolveCompanyProcessContact } from '@/lib/company/company-process-contact.server';
import type { OnboardingDocument, OnboardingProcess, OnboardingStageId } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PUBLIC_URL = process.env.NEXT_PUBLIC_RECRUITMENT_URL?.trim() || 'https://vagas.coalashakes.com';
const MAX_EMAIL_ATTACHMENTS_BYTES = 35 * 1024 * 1024;

function text(value: unknown, max = 500) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function email(value: unknown) { const normalized = text(value, 320).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : ''; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function dateBr(value: string) { const [year, month, day] = value.slice(0, 10).split('-'); return year && month && day ? `${day}/${month}/${year}` : value; }
function extensionFrom(mimeType: string, storagePath: string) {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  return path.extname(storagePath).replace('.', '').toLowerCase() || 'bin';
}
function nextStatus(stage: OnboardingStageId): OnboardingProcess['status'] {
  if (stage === 'signature_preparation' || stage === 'signature') return 'contract_pending';
  if (stage === 'formalization_validation') return 'ready_to_create_user';
  if (stage === 'integration' || stage === 'probation') return 'active';
  if (stage === 'done') return 'completed';
  return stage === 'accountant' ? 'accountant_pending' : 'reviewing_documents';
}

async function addEvent(processId: string, type: string, access: Awaited<ReturnType<typeof assertFormalizationAccess>>, data: Record<string, unknown> = {}) {
  await hrDbAdmin.collection('onboardingProcesses').doc(processId).collection('accountantEvents').doc(randomUUID()).set({ type, at: new Date().toISOString(), actorId: access.decoded.uid, actorEmail: access.decoded.email ?? null, ...data });
}

async function latestForm(processId: string, workflow: Record<string, unknown>): Promise<({ id: string } & Record<string, unknown>) | null> {
  const id = text(workflow.latestFormId);
  if (!id) return null;
  const snapshot = await hrDbAdmin.collection('onboardingProcesses').doc(processId).collection('generatedDocuments').doc(id).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() as Record<string, unknown> } : null;
}

async function fileResponse(storagePath: string, fileName: string, mimeType: string) {
  const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).download();
  return new NextResponse(new Uint8Array(buffer), { headers: { 'Content-Type': mimeType, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`, 'Cache-Control': 'private, no-store' } });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertFormalizationAccess(request, 'accountant.view').catch(() => null);
  if (!access) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
  const { id } = await context.params;
  const snapshot = await hrDbAdmin.collection('onboardingProcesses').doc(id).get();
  if (!snapshot.exists) return NextResponse.json({ error: 'Integração não encontrada.' }, { status: 404 });
  const process = snapshot.data() ?? {}; const workflow = record(process.accountantWorkflow);
  const asset = request.nextUrl.searchParams.get('asset');
  if (asset === 'form') {
    const form = await latestForm(id, workflow);
    if (!form) return NextResponse.json({ error: 'Formulário do contador não encontrado.' }, { status: 404 });
    return fileResponse(text(form.storagePath, 1500), text(form.fileName, 300) || 'formulario-contador.pdf', 'application/pdf');
  }
  if (asset === 'registry') {
    const registry = record(workflow.registryDocument);
    if (!text(registry.storagePath, 1500)) return NextResponse.json({ error: 'Ficha de registro ainda não recebida.' }, { status: 404 });
    return fileResponse(text(registry.storagePath, 1500), text(registry.fileName, 300) || 'ficha-registro.pdf', 'application/pdf');
  }
  const events = await snapshot.ref.collection('accountantEvents').orderBy('at', 'desc').limit(50).get();
  return NextResponse.json({ workflow, events: events.docs.map((document) => ({ id: document.id, ...document.data() })) });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertFormalizationAccess(request, 'accountant.manage').catch(() => null);
  if (!access) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
  const { id } = await context.params;
  const processRef = hrDbAdmin.collection('onboardingProcesses').doc(id);
  const snapshot = await processRef.get();
  if (!snapshot.exists) return NextResponse.json({ error: 'Integração não encontrada.' }, { status: 404 });
  const process = snapshot.data() ?? {}; const workflow = record(process.accountantWorkflow);
  const body = await request.json().catch(() => ({})); const action = text(body.action, 80); const now = new Date().toISOString();

  if (action === 'validate_form') {
    const form = await latestForm(id, workflow);
    if (!form) return NextResponse.json({ error: 'Gere o formulário antes de validá-lo.' }, { status: 409 });
    const validation = { documentId: form.id, validatedAt: now, validatedBy: access.decoded.uid, validatedByEmail: access.decoded.email ?? null };
    await Promise.all([
      processRef.set({ accountantWorkflow: { ...workflow, status: 'form_validated', formValidation: validation, updatedAt: now }, updatedAt: now }, { merge: true }),
      processRef.collection('generatedDocuments').doc(form.id).set({ validationStatus: 'validated', ...validation }, { merge: true }),
      addEvent(id, 'ACCOUNTANT_FORM_VALIDATED', access, { documentId: form.id }),
    ]);
    return NextResponse.json({ ok: true });
  }

  if (action === 'send_email') {
    const configuredContact = await resolveCompanyProcessContact('onboarding');
    const recipient = email(body.accountantEmail) || configuredContact?.email || '';
    if (!recipient) return NextResponse.json({ error: 'Informe um e-mail válido do contador.' }, { status: 400 });
    if (!Array.isArray(body.selectedDocumentIds)) return NextResponse.json({ error: 'Confirme quais documentos do candidato devem compor o e-mail.' }, { status: 400 });
    const selectedDocumentIds: string[] = [...new Set<string>((body.selectedDocumentIds as unknown[]).map((value) => text(value, 180)).filter(Boolean))].slice(0, 120);
    const documents = Array.isArray(process.documents) ? process.documents as OnboardingDocument[] : [];
    const aso = record(record(process.asoWorkflow).asoDocument);
    const missing = missingAccountantPrerequisites({ documents, asoApproved: text(aso.status) === 'approved', expectedAdmissionDate: text(process.expectedAdmissionDate, 10) });
    if (missing.length) return NextResponse.json({ error: `O pacote ainda não pode ser enviado. Falta: ${missing.join('; ')}.` }, { status: 409 });
    const form = await latestForm(id, workflow); const validation = record(workflow.formValidation);
    if (!form || text(validation.documentId) !== form.id) return NextResponse.json({ error: 'Valide a versão atual do formulário antes do envio.' }, { status: 409 });
    const availableCandidateDocuments = candidateDocumentsForAccountant(documents);
    const availableDocumentIds = new Set(availableCandidateDocuments.map((document) => document.id));
    const unavailableSelection = selectedDocumentIds.filter((documentId) => !availableDocumentIds.has(documentId));
    if (unavailableSelection.length) return NextResponse.json({ error: 'A seleção contém documento indisponível, sem aprovação ou sem arquivo auditável. Atualize a página e revise os anexos.' }, { status: 409 });
    const candidateDocuments = candidateDocumentsForAccountant(documents, selectedDocumentIds);
    const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
    const sourceFiles = [
      { label: 'Formulário de admissão para a contabilidade', storagePath: text(form.storagePath, 1500), mimeType: 'application/pdf' },
      { label: 'ASO admissional finalizado', storagePath: text(aso.storagePath, 1500), mimeType: text(aso.mimeType, 100) || 'application/pdf' },
      ...candidateDocuments.map((document) => ({ label: document.label, storagePath: text(document.filePath, 1500), mimeType: '' })),
    ];
    const attachments = await Promise.all(sourceFiles.map(async (source, index) => {
      const file = bucket.file(source.storagePath); const [[contents], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
      const mimeType = source.mimeType || String(metadata.contentType || 'application/octet-stream');
      return { label: source.label, filename: accountantAttachmentName(index + 1, source.label, extensionFrom(mimeType, source.storagePath)), content: contents.toString('base64'), contentType: mimeType, size: contents.length, hashSha256: createHash('sha256').update(contents).digest('hex') };
    }));
    const totalSize = attachments.reduce((total, attachment) => total + attachment.size, 0);
    if (totalSize > MAX_EMAIL_ATTACHMENTS_BYTES) return NextResponse.json({ error: 'Os anexos ultrapassam 35 MB. Reduza os arquivos antes do envio.' }, { status: 413 });
    const uploadToken = createAccountantToken(); const uploadUrl = `${PUBLIC_URL}/contador/ficha-registro/${uploadToken.token}`;
    const emailContent = accountantAdmissionEmailContent({
      candidateName: text(process.candidateName, 240), jobFunction: text(process.functionName, 240) || text(process.jobRoleName, 240),
      companyName: text(process.employerUnitName, 240) || text(process.unitName, 240), companyCnpj: CnpjValidator.format(text(process.employerCnpj, 30)),
      admissionDate: dateBr(text(process.expectedAdmissionDate, 10)), attachmentLabels: attachments.map((attachment) => attachment.label), registryUploadUrl: uploadUrl,
    });
    const communicationId = `accountant_admission_${id}_${form.id}`;
    const communicationRef = hrDbAdmin.collection('emailCommunications').doc(communicationId);
    const attachmentManifest = attachments.map(({ label, filename, contentType, size, hashSha256 }) => ({ label, filename, contentType, size, hashSha256 }));
    await communicationRef.set({ onboardingId: id, event: 'accountant_admission_request', category: 'accountant_admission_request', recipient, subject: emailContent.subject, status: 'pending', generatedDocumentId: form.id, selectedDocumentIds, attachmentCount: attachments.length, attachmentManifest, createdAt: now, updatedAt: now }, { merge: true });
    try {
      const result = await sendEmail({
        from: EMAIL_SENDERS.formalization, to: recipient, subject: emailContent.subject,
        html: renderAccountantAdmissionEmail({
          candidateName: text(process.candidateName, 240),
          jobFunction: text(process.functionName, 240) || text(process.jobRoleName, 240),
          companyName: text(process.employerUnitName, 240) || text(process.unitName, 240),
          companyCnpj: CnpjValidator.format(text(process.employerCnpj, 30)),
          admissionDate: dateBr(text(process.expectedAdmissionDate, 10)),
          attachmentLabels: attachments.map((attachment) => attachment.label),
          registryUploadUrl: uploadUrl,
        }),
        text: emailContent.text,
        attachments: attachments.map(({ filename, content, contentType }) => ({ filename, content, contentType })),
        tags: [{ name: 'category', value: 'accountant_admission_request' }, { name: 'onboarding_id', value: id.slice(0, 256) }],
      });
      await Promise.all([
        communicationRef.set({ status: 'accepted', providerId: result.id, acceptedAt: now, updatedAt: now }, { merge: true }),
        processRef.set({ accountantTokenHash: uploadToken.hash, accountantTokenExpiresAt: accountantTokenExpiresAt(30), accountantWorkflow: { ...workflow, selectedDocumentIds, status: 'email_sent', email: { recipient, communicationId, providerId: result.id, status: 'accepted', sentAt: now }, package: { attachmentCount: attachments.length, attachmentLabels: attachments.map((attachment) => attachment.label), selectedDocumentIds, attachmentManifest, totalBytes: totalSize, sentAt: now }, updatedAt: now }, updatedAt: now }, { merge: true }),
        addEvent(id, 'ACCOUNTANT_EMAIL_SENT', access, { recipient, providerId: result.id, documentId: form.id, selectedDocumentIds, attachmentCount: attachments.length }),
      ]);
      return NextResponse.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha no envio.';
      await communicationRef.set({ status: 'failed', lastError: message, updatedAt: now }, { merge: true });
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (action === 'review_registry') {
    const registry = record(workflow.registryDocument); const decision = text(body.decision, 20); const reason = text(body.reason, 2000);
    if (!text(registry.storagePath, 1500)) return NextResponse.json({ error: 'Nenhuma ficha de registro foi recebida.' }, { status: 409 });
    if (!['approved', 'rejected'].includes(decision)) return NextResponse.json({ error: 'Decisão inválida.' }, { status: 400 });
    if (decision === 'rejected' && reason.length < 3) return NextResponse.json({ error: 'Informe o motivo da rejeição.' }, { status: 400 });
    const reviewedRegistry = { ...registry, status: decision, reviewedAt: now, reviewedBy: access.decoded.uid, rejectionReason: decision === 'rejected' ? reason : null };
    if (decision === 'approved') {
      const stages = applyOnboardingSignatureMode(normalizeOnboardingStages(process.stages), process.generateSignatureDocuments === true);
      const accountantIndex = stages.findIndex((stage) => stage.id === 'accountant'); const next = stages[accountantIndex + 1] ?? stages.find((stage) => stage.id === 'done')!;
      await Promise.all([
        processRef.set({ stages, currentStage: next.id, currentStageStartedAt: now, status: nextStatus(next.id), accountantWorkflow: { ...workflow, status: 'completed', registryDocument: reviewedRegistry, updatedAt: now }, updatedAt: now }, { merge: true }),
        addEvent(id, 'ACCOUNTANT_REGISTRY_APPROVED', access, { versionId: text(registry.versionId), nextStage: next.id }),
      ]);
    } else {
      await Promise.all([
        processRef.set({ accountantWorkflow: { ...workflow, status: 'registry_received', registryDocument: reviewedRegistry, updatedAt: now }, updatedAt: now }, { merge: true }),
        addEvent(id, 'ACCOUNTANT_REGISTRY_REJECTED', access, { versionId: text(registry.versionId), reason }),
      ]);
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
}
