import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import { assertFormalizationAccess } from '@/features/hr/lib/server-access';
import { createAsoToken, formatAsoAppointment, isoAfterDays } from '@/features/hr/aso/workflow';
import { candidateAsoEmailContent, clinicAsoEmailContent } from '@/features/hr/aso/emails';
import { selectLatestSocialContract, type CompanyDocumentMetadata } from '@/features/hr/aso/company-document-selection';
import { sendEmail, EMAIL_SENDERS } from '@/lib/email/resend';
import { renderCoalaEmail } from '@/lib/email/template';
import { adminApp } from '@/lib/firebase-admin';
import { dbAdmin } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { createPaymentRequest, refreshPaymentRequest, submitPaymentRequest } from '@/features/financial/payment-requests/service.server';
import { getPaymentRequest } from '@/features/financial/payment-requests/repository.server';
import { getTermination, saveTermination } from '@/features/hr/termination/server';
import { applyAccountantReadiness, patchStep } from '@/features/hr/termination/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PUBLIC_URL = process.env.NEXT_PUBLIC_RECRUITMENT_URL?.trim() || 'https://vagas.coalashakes.com';

function text(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function email(value: unknown) {
  const normalized = text(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function addEvent(processId: string, type: string, access: Awaited<ReturnType<typeof assertFormalizationAccess>>, data: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  await hrDbAdmin.collection('onboardingProcesses').doc(processId).collection('asoEvents').doc(randomUUID()).set({
    type, at: now, actorId: access.decoded.uid, actorEmail: access.decoded.email ?? null, ...data,
  });
}

async function latestGuide(processId: string, workflow: Record<string, unknown>): Promise<({ id: string } & Record<string, unknown>) | null> {
  const id = text(workflow.latestGuideId);
  if (!id) return null;
  const snapshot = await hrDbAdmin.collection('onboardingProcesses').doc(processId).collection('generatedDocuments').doc(id).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() as Record<string, unknown> } : null;
}

async function latestSocialContract() {
  const snapshot = await dbAdmin.collection('companyDocuments').where('category', '==', 'Societário').get();
  const documents = snapshot.docs.map((document) => ({
    id: document.id,
    ref: document.ref,
    ...(document.data() as Record<string, unknown>),
  })) as Array<CompanyDocumentMetadata & {
    ref: DocumentReference;
    version?: unknown;
    contentHash?: unknown;
  }>;
  return selectLatestSocialContract(documents);
}

async function fileResponse(storagePath: string, fileName: string, mimeType: string) {
  const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).download();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertFormalizationAccess(request, 'aso.view').catch(() => null);
  if (!access) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
  const { id } = await context.params;
  const snapshot = await hrDbAdmin.collection('onboardingProcesses').doc(id).get();
  if (!snapshot.exists) return NextResponse.json({ error: 'Integração não encontrada.' }, { status: 404 });
  const process = snapshot.data() ?? {};
  const workflow = record(process.asoWorkflow);
  const asset = request.nextUrl.searchParams.get('asset');
  if (asset === 'guide') {
    const guide = await latestGuide(id, workflow);
    if (!guide) return NextResponse.json({ error: 'Guia não encontrada.' }, { status: 404 });
    return fileResponse(text(guide.storagePath, 1500), text(guide.fileName, 300) || 'guia-aso.pdf', 'application/pdf');
  }
  if (asset === 'aso') {
    const aso = record(workflow.asoDocument);
    if (!text(aso.storagePath, 1500)) return NextResponse.json({ error: 'ASO ainda não recebido.' }, { status: 404 });
    return fileResponse(text(aso.storagePath, 1500), text(aso.fileName, 300) || 'aso.pdf', text(aso.mimeType, 100) || 'application/pdf');
  }
  const events = await snapshot.ref.collection('asoEvents').orderBy('at', 'desc').limit(50).get();
  return NextResponse.json({ workflow, events: events.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertFormalizationAccess(request, 'aso.manage').catch(() => null);
  if (!access) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
  const { id } = await context.params;
  const processRef = hrDbAdmin.collection('onboardingProcesses').doc(id);
  const snapshot = await processRef.get();
  if (!snapshot.exists) return NextResponse.json({ error: 'Integração não encontrada.' }, { status: 404 });
  const process = snapshot.data() ?? {};
  const workflow = record(process.asoWorkflow);
  const body = await request.json().catch(() => ({}));
  const action = text(body.action, 80);
  const now = new Date().toISOString();

  if (action === 'validate_guide') {
    const guide = await latestGuide(id, workflow);
    if (!guide) return NextResponse.json({ error: 'Gere a guia antes de validá-la.' }, { status: 409 });
    const validation = { documentId: guide.id, validatedAt: now, validatedBy: access.decoded.uid, validatedByEmail: access.decoded.email ?? null };
    await Promise.all([
      processRef.set({ asoWorkflow: { ...workflow, status: 'guide_validated', guideValidation: validation, updatedAt: now }, updatedAt: now }, { merge: true }),
      processRef.collection('generatedDocuments').doc(guide.id).set({ validationStatus: 'validated', ...validation }, { merge: true }),
      addEvent(id, 'GUIDE_VALIDATED', access, { documentId: guide.id }),
    ]);
    return NextResponse.json({ ok: true });
  }

  if (action === 'request_payment') {
    const guide = await latestGuide(id, workflow);
    const validation = record(workflow.guideValidation);
    if (!guide || text(validation.documentId) !== guide.id) return NextResponse.json({ error: 'Valide a versão atual da guia antes de solicitar o pagamento.' }, { status: 409 });
    let clinicEntityId = text(body.clinicEntityId, 180) || text(workflow.clinicEntityId, 180);
    if (!clinicEntityId) {
      const activeClinics = await hrDbAdmin.collection('asoClinicConfigs').where('active', '==', true).limit(2).get();
      if (activeClinics.size !== 1) return NextResponse.json({ error: 'Selecione a clínica responsável pelo ASO.' }, { status: 409 });
      clinicEntityId = activeClinics.docs[0].id;
    }
    const clinicSnapshot = await hrDbAdmin.collection('asoClinicConfigs').doc(clinicEntityId).get();
    if (!clinicSnapshot.exists || clinicSnapshot.get('active') === false) return NextResponse.json({ error: 'A clínica selecionada está ausente ou inativa.' }, { status: 409 });
    const amount = Number(clinicSnapshot.get('asoPrice'));
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'O valor do ASO não está configurado para a clínica.' }, { status: 409 });
    const actor = { uid: access.decoded.uid, email: access.decoded.email ?? null, name: access.actorName };
    let payment = await createPaymentRequest({
      sourceType: 'aso', sourceId: id, beneficiaryReference: { sourceType: 'entity', sourceId: clinicEntityId },
      amount, description: text(clinicSnapshot.get('defaultPaymentDescription'), 140) || `Pagamento de ASO ${process.asoExamType === 'dismissal' ? 'demissional' : 'admissional'}`,
    }, actor);
    if (payment.status === 'ready_to_submit' || payment.status === 'failed') payment = await submitPaymentRequest(payment.id, actor);
    const clinicName = payment.beneficiarySnapshot.name;
    const clinicEmail = email(clinicSnapshot.get('schedulingEmail'));
    await Promise.all([
      processRef.set({ asoWorkflow: { ...workflow, status: 'guide_validated', clinicEntityId, paymentRequestId: payment.id, paymentStatus: payment.status, clinic: { ...record(workflow.clinic), name: clinicName, email: clinicEmail }, updatedAt: now }, updatedAt: now }, { merge: true }),
      addEvent(id, 'ASO_PAYMENT_REQUESTED', access, { paymentRequestId: payment.id, clinicEntityId, amount, paymentStatus: payment.status }),
    ]);
    return NextResponse.json({ ok: true, payment });
  }

  if (action === 'refresh_payment') {
    const paymentRequestId = text(workflow.paymentRequestId, 180);
    if (!paymentRequestId) return NextResponse.json({ error: 'O pagamento do ASO ainda não foi solicitado.' }, { status: 409 });
    const payment = await refreshPaymentRequest(paymentRequestId, { uid: access.decoded.uid, email: access.decoded.email ?? null, name: access.actorName });
    await processRef.set({ asoWorkflow: { ...workflow, paymentStatus: payment.status, paymentProofStoragePath: payment.proofStoragePath ?? null, paymentConfirmedAt: payment.paidAt ?? null, updatedAt: now }, updatedAt: now }, { merge: true });
    await addEvent(id, 'ASO_PAYMENT_REFRESHED', access, { paymentRequestId, paymentStatus: payment.status });
    return NextResponse.json({ ok: true, payment });
  }

  if (action === 'send_clinic_email') {
    const paymentRequestId = text(workflow.paymentRequestId, 180);
    if (!paymentRequestId) return NextResponse.json({ error: 'Solicite e confirme o pagamento do ASO antes do envio à clínica.' }, { status: 409 });
    const payment = await getPaymentRequest(paymentRequestId);
    if (payment.status !== 'paid' || !payment.proofStoragePath) return NextResponse.json({ error: 'O e-mail só será liberado após o Banco Inter confirmar o pagamento e o comprovante estar disponível.' }, { status: 409 });
    const clinicEntityId = text(workflow.clinicEntityId, 180);
    const clinicConfig = clinicEntityId ? await hrDbAdmin.collection('asoClinicConfigs').doc(clinicEntityId).get() : null;
    const clinicEmail = email(clinicConfig?.get('schedulingEmail'));
    if (!clinicEmail) return NextResponse.json({ error: 'O e-mail da clínica não está configurado.' }, { status: 409 });
    const clinicName = payment.beneficiarySnapshot.name;
    const guide = await latestGuide(id, workflow);
    const validation = record(workflow.guideValidation);
    if (!guide || text(validation.documentId) !== guide.id) return NextResponse.json({ error: 'Valide a versão atual da guia antes do envio.' }, { status: 409 });
    const socialContract = await latestSocialContract();
    if (!socialContract) return NextResponse.json({ error: 'Nenhum contrato social em PDF ativo foi encontrado em Documentos da empresa.' }, { status: 409 });
    const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
    const [pdf, socialContractPdf, paymentProofPdf] = await Promise.all([
      bucket.file(text(guide.storagePath, 1500)).download().then(([contents]) => contents),
      bucket.file(text(socialContract.storagePath, 1500)).download().then(([contents]) => contents),
      bucket.file(payment.proofStoragePath).download().then(([contents]) => contents),
    ]);
    const inboundDomain = process.env.ASO_INBOUND_DOMAIN?.trim();
    if (!inboundDomain) return NextResponse.json({ error: 'O domínio de recebimento das respostas do ASO ainda não foi configurado.' }, { status: 503 });
    const replyToken = createAsoToken();
    const replyUrl = `${PUBLIC_URL}/aso/clinica/${replyToken.token}`;
    const communicationId = `aso_clinic_${id}_${guide.id}`;
    const employerUnit = text(process.employerUnitId)
      ? (await dbAdmin.collection('dp_units').doc(text(process.employerUnitId)).get()).data() ?? {}
      : {};
    const companyCnpj = text(process.employerCnpj, 30);
    const companyAddress = text(process.employerAddress, 600) || text(employerUnit.address, 600) || 'Endereço não informado';
    const companyContacts = text(process.asoCompanyContacts, 500) || (companyCnpj.replace(/\D/g, '') === '14276603000125'
      ? '(99) 9-8111-1119 (Tiago Brasil) ou (98) 9-8809-0880 (Cesar Thimótheo)'
      : 'Contato do RH não informado');
    const contractAttachmentName = 'Anexo 1 - Contrato social.pdf';
    const proofAttachmentName = 'Anexo 2 - Comprovante de pagamento.pdf';
    const guideAttachmentName = 'Anexo 3 - Guia de solicitação do ASO.pdf';
    const clinicEmailContent = clinicAsoEmailContent({
      candidateName: text(process.candidateName, 240), jobFunction: text(process.functionName, 240) || text(process.jobRoleName, 240),
      companyName: text(process.employerUnitName, 240) || text(process.unitName, 240), companyCnpj,
      companyAddress, companyContacts,
      attachments: [
        { label: 'Contrato social', fileName: contractAttachmentName },
        { label: 'Comprovante de pagamento', fileName: proofAttachmentName },
        { label: 'Guia de solicitação do ASO', fileName: guideAttachmentName },
      ],
      examType: process.asoExamType === 'dismissal' ? 'dismissal' : 'admission',
    });
    const communicationRef = hrDbAdmin.collection('emailCommunications').doc(communicationId);
    await communicationRef.set({
      onboardingId: id, event: 'aso_clinic_request', category: 'aso_clinic_request', recipient: clinicEmail,
      subject: clinicEmailContent.subject,
      status: 'pending', generatedDocumentId: guide.id,
      socialContractDocumentId: socialContract.id,
      socialContractVersion: socialContract.version ?? null,
      socialContractContentHash: text(socialContract.contentHash, 128) || null,
      createdAt: now, updatedAt: now,
    }, { merge: true });
    try {
      const result = await sendEmail({
        from: EMAIL_SENDERS.formalization,
        to: clinicEmail,
        replyTo: `aso+${replyToken.token}@${inboundDomain}`,
        subject: clinicEmailContent.subject,
        html: renderCoalaEmail({
          brandName: 'Coala Shakes', title: clinicEmailContent.title,
          message: clinicEmailContent.message,
          highlightBlock: { text: clinicEmailContent.emphasis, tone: 'green', action: { label: 'Informar data e horário', url: replyUrl } },
          footer: null,
        }),
        text: `${clinicEmailContent.text}\n${replyUrl}`,
        attachments: [
          { filename: contractAttachmentName, content: socialContractPdf.toString('base64'), contentType: 'application/pdf' },
          { filename: proofAttachmentName, content: paymentProofPdf.toString('base64'), contentType: 'application/pdf' },
          { filename: guideAttachmentName, content: pdf.toString('base64'), contentType: 'application/pdf' },
        ],
        tags: [{ name: 'category', value: 'aso_clinic_request' }, { name: 'onboarding_id', value: id.slice(0, 256) }],
      });
      await Promise.all([
        communicationRef.set({ status: 'accepted', providerId: result.id, acceptedAt: now, updatedAt: now }, { merge: true }),
        processRef.set({
          asoClinicTokenHash: replyToken.hash, asoClinicTokenExpiresAt: isoAfterDays(30),
          asoWorkflow: { ...workflow, status: 'email_sent', appointmentStatus: 'awaiting_clinic', clinic: { email: clinicEmail, name: clinicName, communicationId, providerId: result.id, emailStatus: 'accepted', sentAt: now }, updatedAt: now }, updatedAt: now,
        }, { merge: true }),
        socialContract.ref.set({ accessCount: FieldValue.increment(1), lastAccessedAt: Timestamp.now() }, { merge: true }),
        socialContract.ref.collection('audit').add({ action: 'DOCUMENT_ATTACHED_TO_ASO_EMAIL', actorId: access.decoded.uid, actorName: access.actorName, onboardingId: id, providerId: result.id, at: Timestamp.now() }),
        addEvent(id, 'CLINIC_EMAIL_SENT', access, { recipient: clinicEmail, documentId: guide.id, socialContractDocumentId: socialContract.id, providerId: result.id }),
      ]);
      return NextResponse.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha no envio.';
      await communicationRef.set({ status: 'failed', lastError: message, updatedAt: now }, { merge: true });
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (action === 'register_clinic_response') {
    const date = text(body.date, 10); const time = text(body.time, 5); const location = text(body.location, 500);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !location) return NextResponse.json({ error: 'Informe data, horário e local.' }, { status: 400 });
    const appointment = { date, time, location, instructions: text(body.instructions, 2000) || null, source: 'manual', responseText: text(body.responseText, 12000) || null, confidence: 1, proposedAt: now };
    await Promise.all([
      processRef.set({ asoWorkflow: { ...workflow, status: 'appointment_pending_review', appointmentStatus: 'awaiting_clinic', appointment, clinic: { ...record(workflow.clinic), repliedAt: now }, updatedAt: now }, updatedAt: now }, { merge: true }),
      addEvent(id, 'CLINIC_RESPONSE_REGISTERED', access, { source: 'manual', date, time, location }),
    ]);
    return NextResponse.json({ ok: true });
  }

  if (action === 'confirm_appointment') {
    const current = record(workflow.appointment);
    const date = text(body.date, 10) || text(current.date, 10); const time = text(body.time, 5) || text(current.time, 5); const location = text(body.location, 500) || text(current.location, 500);
    const instructions = text(body.instructions, 2000) || text(current.instructions, 2000) || null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !location) return NextResponse.json({ error: 'Informe data, horário e local antes de confirmar.' }, { status: 400 });
    const recipient = email(process.candidateEmail);
    if (!recipient) return NextResponse.json({ error: 'O candidato não possui e-mail válido.' }, { status: 409 });
    const uploadToken = createAsoToken();
    const appointmentAt = `${date}T${time}:00-03:00`;
    const expiresAt = new Date(new Date(appointmentAt).getTime() + 21 * 24 * 60 * 60 * 1000).toISOString();
    const uploadUrl = `${PUBLIC_URL}/aso/candidato/${uploadToken.token}`;
    const appointmentLabel = formatAsoAppointment(date, time);
    const candidateEmailContent = candidateAsoEmailContent({ candidateName: text(process.candidateName, 240), appointmentLabel, instructions, uploadUrl, examType: process.asoExamType === 'dismissal' ? 'dismissal' : 'admission' });
    const communicationId = `aso_candidate_${id}_${date}_${time.replace(':', '')}`;
    const result = await sendEmail({
      from: EMAIL_SENDERS.formalization, to: recipient,
      subject: candidateEmailContent.subject,
      html: renderCoalaEmail({
        brandName: 'Coala Shakes', title: candidateEmailContent.title,
        message: candidateEmailContent.message,
        highlightBlock: { text: candidateEmailContent.locationBlock, tone: 'green', action: { label: 'Abrir localização no Google Maps', url: candidateEmailContent.mapsUrl } },
        afterActionMessage: candidateEmailContent.afterActionMessage,
        secondaryAction: { label: 'Enviar ASO', url: uploadUrl },
        secondaryActionLead: 'Após o exame, envie o ASO digitalizado por esse link:',
        secondaryActionVariant: 'highlight',
        footer: 'Este é um e-mail automático e não aceita respostas.',
      }),
      text: candidateEmailContent.text,
      tags: [{ name: 'category', value: 'aso_candidate_notice' }, { name: 'onboarding_id', value: id.slice(0, 256) }],
    });
    await Promise.all([
      hrDbAdmin.collection('emailCommunications').doc(communicationId).set({ onboardingId: id, event: 'aso_candidate_notice', category: 'aso_candidate_notice', recipient, providerId: result.id, status: 'accepted', acceptedAt: now, createdAt: now, updatedAt: now }),
      processRef.set({
        asoCandidateTokenHash: uploadToken.hash, asoCandidateTokenExpiresAt: expiresAt,
        asoWorkflow: { ...workflow, status: 'candidate_notified', appointmentStatus: 'confirmed', appointmentAt, appointment: { ...current, date, time, location, instructions, confirmedAt: now, confirmedBy: access.decoded.uid }, candidateNotification: { providerId: result.id, emailStatus: 'accepted', sentAt: now, uploadExpiresAt: expiresAt }, updatedAt: now }, updatedAt: now,
      }, { merge: true }),
      addEvent(id, 'APPOINTMENT_CONFIRMED_AND_CANDIDATE_NOTIFIED', access, { date, time, location, recipient, providerId: result.id }),
    ]);
    return NextResponse.json({ ok: true });
  }

  if (action === 'review_aso') {
    const aso = record(workflow.asoDocument);
    if (!text(aso.storagePath, 1500)) return NextResponse.json({ error: 'Nenhum ASO foi recebido.' }, { status: 409 });
    const decision = text(body.decision, 20);
    if (!['approved', 'rejected'].includes(decision)) return NextResponse.json({ error: 'Decisão inválida.' }, { status: 400 });
    const reason = text(body.reason, 2000);
    if (decision === 'rejected' && reason.length < 3) return NextResponse.json({ error: 'Informe o motivo da rejeição.' }, { status: 400 });
    await Promise.all([
      processRef.set({ asoWorkflow: { ...workflow, status: decision === 'approved' ? 'completed' : 'aso_received', asoDocument: { ...aso, status: decision, reviewedAt: now, reviewedBy: access.decoded.uid, rejectionReason: decision === 'rejected' ? reason : null }, updatedAt: now }, updatedAt: now }, { merge: true }),
      addEvent(id, decision === 'approved' ? 'ASO_APPROVED' : 'ASO_REJECTED', access, { reason: reason || null }),
    ]);
    if (process.processKind === 'termination_aso') {
      const termination = await getTermination(id);
      if (termination) {
        await saveTermination(applyAccountantReadiness({
          ...termination,
          asoWorkflow: { status: decision, reviewedAt: now, rejectionReason: decision === 'rejected' ? reason : null },
          steps: patchStep(termination.steps, 'aso', {
            status: decision === 'approved' ? 'completed' : 'blocked',
            ...(decision === 'approved' ? { completedAt: now, completedBy: access.decoded.uid, blockedReason: null } : { blockedReason: reason }),
          }),
          lastActivityAt: now,
          updatedAt: now,
        }, now));
      }
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
}
