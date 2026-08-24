import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import { assertFormalizationAccess } from '@/features/hr/lib/server-access';
import { createAsoToken, formatAsoAppointment, isoAfterDays, missingAsoEmailPrerequisites } from '@/features/hr/aso/workflow';
import { candidateAsoEmailContent, clinicAsoEmailContent, renderCandidateAsoAppointmentEmail, renderClinicAsoRequestEmail } from '@/features/hr/aso/emails';
import { selectLatestSocialContract, type CompanyDocumentMetadata } from '@/features/hr/aso/company-document-selection';
import { ASO_GUIDE_TEMPLATE_VERSION } from '@/features/hr/aso/guide-version';
import { asoClinicEmailInlineAttachments } from '@/features/hr/aso/clinic-email-assets.server';
import { resolveAsoClinicEmailCompany } from '@/features/hr/aso/clinic-email-company.server';
import { sendEmail, EMAIL_SENDERS } from '@/lib/email/resend';
import { adminApp } from '@/lib/firebase-admin';
import { dbAdmin } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { createPaymentRequest, refreshPaymentRequest } from '@/features/financial/payment-requests/service.server';
import { getPaymentRequest } from '@/features/financial/payment-requests/repository.server';
import { getTermination, saveTermination } from '@/features/hr/termination/server';
import { applyAccountantReadiness, patchStep } from '@/features/hr/termination/core';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import { missingAccountantPrerequisites } from '@/features/hr/accountant/workflow';
import type { OnboardingDocument } from '@/types';
import { essentialPublicFormDataReady } from '@/features/hr/onboarding/public-form-revision';
import { clinicLocationFromConfig, clinicLocationLabel, readClinicLocation } from '@/features/hr/aso/clinic-location';
import { resolveAsoClinicLocation } from '@/features/hr/aso/clinic-location.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PUBLIC_URL = process.env.NEXT_PUBLIC_RECRUITMENT_URL?.trim() || 'https://vagas.coalashakes.com';
const ASO_INBOUND_DOMAIN = process.env.ASO_INBOUND_DOMAIN?.trim() || '';

function text(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function email(value: unknown) {
  const normalized = text(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function formatCpf(value: unknown) {
  const digits = text(value, 24).replace(/\D/g, '').slice(0, 11);
  return digits.length === 11
    ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
    : text(value, 24);
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
  const snapshot = await dbAdmin.collection('companyDocuments').where('category', '==', 'Societário').limit(25).get();
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

async function buildAsoRequestSnapshot(process: Record<string, unknown>, clinicEntityId: string) {
  if (!process.publicFormSubmittedAt) throw new Error('A candidata ainda não enviou o formulário da integração.');
  const answers = record(process.publicFormAnswers);
  const [clinicSnapshot, entitySnapshot, employerUnitSnapshot] = await Promise.all([
    hrDbAdmin.collection('asoClinicConfigs').doc(clinicEntityId).get(),
    dbAdmin.collection('entities').doc(clinicEntityId).get(),
    text(process.employerUnitId) ? dbAdmin.collection('dp_units').doc(text(process.employerUnitId)).get() : Promise.resolve(null),
  ]);
  if (!clinicSnapshot.exists || clinicSnapshot.get('active') === false) throw new Error('A clínica selecionada está ausente ou inativa.');
  if (!entitySnapshot.exists || entitySnapshot.get('status') === 'inactive') throw new Error('O cadastro da clínica não está disponível.');
  const clinicEmail = email(clinicSnapshot.get('schedulingEmail'));
  const clinicPrice = Number(clinicSnapshot.get('asoPrice'));
  const candidateEmail = email(process.candidateEmail);
  const companyCnpj = CnpjValidator.clean(text(process.employerCnpj, 30));
  const employerUnit = employerUnitSnapshot?.data() ?? {};
  const clinicName = text(entitySnapshot.get('name'), 240) || text(entitySnapshot.get('razao_social'), 240) || 'Clínica';
  const clinicLocation = clinicLocationFromConfig(clinicName, clinicSnapshot.get('address'));
  const snapshot = {
    candidateName: text(process.candidateName, 240),
    candidateEmail,
    candidateCpf: formatCpf(answers.cpf),
    jobFunction: text(process.functionName, 240) || text(process.jobRoleName, 240),
    expectedAdmissionDate: text(process.expectedAdmissionDate, 10) || null,
    examType: process.asoExamType === 'dismissal' ? 'dismissal' : 'admission',
    companyName: text(process.employerUnitName, 240) || text(process.unitName, 240),
    companyCnpj,
    companyAddress: text(process.employerAddress, 600) || text(employerUnit.address, 600),
    companyContacts: text(process.asoCompanyContacts, 500) || (companyCnpj === '14276603000125'
      ? '(99) 9-8111-1119 (Tiago Brasil) ou (98) 9-8809-0880 (Cesar Thimótheo)'
      : 'Contato do RH não informado'),
    clinicEntityId,
    clinicName,
    clinicEmail,
    clinicPrice,
    clinicLocation,
  } as const;
  const missing = [
    !snapshot.candidateName ? 'nome da candidata' : null,
    !snapshot.candidateEmail ? 'e-mail da candidata' : null,
    !snapshot.candidateCpf ? 'CPF da candidata' : null,
    !snapshot.jobFunction ? 'cargo ou função' : null,
    !CnpjValidator.validate(snapshot.companyCnpj).valid ? 'CNPJ responsável válido' : null,
    !snapshot.companyName ? 'empresa responsável' : null,
    !snapshot.companyAddress ? 'endereço da empresa' : null,
    !snapshot.clinicEmail ? 'e-mail de agendamento da clínica' : null,
    !Number.isFinite(snapshot.clinicPrice) || snapshot.clinicPrice <= 0 ? 'valor do ASO na clínica' : null,
    !snapshot.clinicLocation ? 'endereço da clínica' : null,
  ].filter((value): value is string => Boolean(value));
  if (missing.length) throw new Error(`Complete os dados da solicitação. Falta: ${missing.join('; ')}.`);
  const { clinicLocation: _clinicLocation, ...fingerprintSnapshot } = snapshot;
  const fingerprint = createHash('sha256').update(JSON.stringify(fingerprintSnapshot)).digest('hex');
  return { ...snapshot, fingerprint };
}

function emailWasAccepted(status: unknown, providerId: unknown) {
  return Boolean(text(providerId, 300)) && ['accepted', 'delivered', 'delayed'].includes(text(status, 40));
}

function essentialFormDataReady(process: Record<string, unknown>) {
  return essentialPublicFormDataReady({
    publicFormSubmittedAt: process.publicFormSubmittedAt,
    candidateName: process.candidateName,
    publicFormAnswers: process.publicFormAnswers,
  });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
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
  const view = request.nextUrl.searchParams.get('view');
  if (view === 'workflow') {
    return NextResponse.json({ workflow }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (view === 'payment') {
    const paymentRequestId = text(workflow.paymentRequestId, 180);
    if (!paymentRequestId) {
      return NextResponse.json({
        workflow: {
          paymentRequestId: null,
          paymentStatus: workflow.paymentStatus ?? null,
          paymentProofStoragePath: workflow.paymentProofStoragePath ?? null,
          paymentConfirmedAt: workflow.paymentConfirmedAt ?? null,
        },
      }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const payment = await getPaymentRequest(paymentRequestId);
    return NextResponse.json({
      workflow: {
        paymentRequestId,
        paymentStatus: payment.status,
        paymentProofStoragePath: payment.proofStoragePath ?? null,
        paymentConfirmedAt: payment.paidAt ?? null,
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
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
  if (asset === 'payment_proof') {
    const paymentRequestId = text(workflow.paymentRequestId, 180);
    if (!paymentRequestId) return NextResponse.json({ error: 'O pagamento do ASO ainda não foi solicitado.' }, { status: 404 });
    const payment = await getPaymentRequest(paymentRequestId);
    if (!payment.proofStoragePath) return NextResponse.json({ error: 'Comprovante de pagamento ainda não disponível.' }, { status: 404 });
    return fileResponse(payment.proofStoragePath, 'Comprovante de pagamento.pdf', 'application/pdf');
  }
  if (asset === 'social_contract') {
    const contract = await latestSocialContract();
    if (!contract) return NextResponse.json({ error: 'Contrato social em PDF não encontrado.' }, { status: 404 });
    const fileName = text(contract.standardizedName, 300) || text(contract.originalName, 300) || 'Contrato social.pdf';
    return fileResponse(text(contract.storagePath, 1500), fileName, 'application/pdf');
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

  if (action === 'validate_request') {
    if (text(workflow.startedAt, 40)) {
      return NextResponse.json({ error: 'A solicitação não pode ser alterada depois que o processo do ASO foi iniciado.' }, { status: 409 });
    }
    const clinicEntityId = text(body.clinicEntityId, 180) || text(workflow.clinicEntityId, 180);
    if (!clinicEntityId) return NextResponse.json({ error: 'Selecione a clínica responsável pelo ASO.' }, { status: 409 });
    if (text(workflow.paymentRequestId, 180) && clinicEntityId !== text(workflow.clinicEntityId, 180)) {
      return NextResponse.json({ error: 'A clínica não pode ser alterada depois que o PIX foi enviado para pagamento.' }, { status: 409 });
    }
    try {
      const current = await buildAsoRequestSnapshot(process, clinicEntityId);
      const requestValidation = {
        id: randomUUID(),
        ...current,
        validatedAt: now,
        validatedBy: access.decoded.uid,
        validatedByEmail: access.decoded.email ?? null,
      };
      await Promise.all([
        processRef.set({
          asoWorkflow: {
            ...workflow,
            status: 'request_validated',
            clinicEntityId,
            clinic: {
              ...record(workflow.clinic),
              name: current.clinicName,
              email: current.clinicEmail,
            },
            requestValidation,
            updatedAt: now,
          },
          updatedAt: now,
        }, { merge: true }),
        addEvent(id, 'ASO_REQUEST_VALIDATED', access, {
          requestValidationId: requestValidation.id,
          fingerprint: requestValidation.fingerprint,
          clinicEntityId,
        }),
      ]);
      return NextResponse.json({ ok: true, requestValidation });
    } catch (error) {
      return NextResponse.json({ error: errorMessage(error, 'Não foi possível preparar a solicitação do ASO.') }, { status: 409 });
    }
  }

  if (action === 'start_process') {
    if (process.status === 'cancelled' || process.status === 'completed') {
      return NextResponse.json({ error: 'Esta integração não permite iniciar o processo do ASO.' }, { status: 409 });
    }
    const requestValidation = record(workflow.requestValidation);
    const clinicEntityId = text(requestValidation.clinicEntityId, 180) || text(workflow.clinicEntityId, 180);
    if (!clinicEntityId || !text(requestValidation.fingerprint, 128)) {
      return NextResponse.json({ error: 'Atualize as guias antes de iniciar o processo do ASO.' }, { status: 409 });
    }

    let currentRequest: Awaited<ReturnType<typeof buildAsoRequestSnapshot>>;
    try {
      currentRequest = await buildAsoRequestSnapshot(process, clinicEntityId);
    } catch (error) {
      return NextResponse.json({ error: errorMessage(error, 'A solicitação precisa ser atualizada novamente.') }, { status: 409 });
    }
    if (currentRequest.fingerprint !== text(requestValidation.fingerprint, 128)) {
      return NextResponse.json({ error: 'Os dados da solicitação mudaram. Atualize as guias antes de iniciar.' }, { status: 409 });
    }

    const paymentRequestId = text(workflow.paymentRequestId, 180);
    if (!paymentRequestId) {
      return NextResponse.json({ error: 'Envie o PIX para pagamento antes de enviar a solicitação à clínica.' }, { status: 409 });
    }
    let payment;
    try {
      payment = await getPaymentRequest(paymentRequestId);
    } catch (error) {
      return NextResponse.json({ error: errorMessage(error, 'Não foi possível consultar o pagamento do ASO.') }, { status: 409 });
    }
    if (payment.sourceType !== 'aso') return NextResponse.json({ error: 'A solicitação bancária não pertence a este ASO.' }, { status: 409 });
    if (Math.abs(Number(payment.amount) - currentRequest.clinicPrice) > 0.005) {
      return NextResponse.json({ error: 'O valor da clínica mudou depois da criação do PIX. Revise o cadastro antes de continuar.' }, { status: 409 });
    }
    const guide = await latestGuide(id, workflow);
    const missing = missingAsoEmailPrerequisites({
      expectedAdmissionDate: text(process.expectedAdmissionDate, 10) || null,
      essentialFormDataReady: essentialFormDataReady(process),
      paymentPaid: payment.status === 'paid' && Boolean(payment.proofStoragePath),
      requestPdfReady: Boolean(
        guide
        && text(guide.templateVersion, 80) === ASO_GUIDE_TEMPLATE_VERSION
        && workflow.latestGuideRequiresRegeneration !== true
      ),
    });
    if (missing.length > 0) {
      return NextResponse.json({ error: `Conclua os pré-requisitos antes de enviar a solicitação à clínica: ${missing.join('; ')}.` }, { status: 409 });
    }
    if (!guide) return NextResponse.json({ error: 'Gere a solicitação do ASO em PDF antes de enviá-la à clínica.' }, { status: 409 });

    const clinicCommunicationRef = hrDbAdmin.collection('emailCommunications').doc(`aso_clinic_start_${id}`);
    const clinicCommunicationSnapshot = await clinicCommunicationRef.get();
    let clinicEmailResult = {
      recipient: currentRequest.clinicEmail,
      recipientName: currentRequest.clinicName,
      purpose: 'Solicitação de agendamento do ASO',
      status: text(clinicCommunicationSnapshot.get('status'), 40) || 'pending',
      providerId: text(clinicCommunicationSnapshot.get('providerId'), 300) || null,
      error: null as string | null,
    };
    if (!emailWasAccepted(clinicCommunicationSnapshot.get('status'), clinicCommunicationSnapshot.get('providerId'))) {
      const replyToken = createAsoToken();
      const replyUrl = `${PUBLIC_URL}/aso/clinica/${replyToken.token}`;
      const [socialContract, emailCompany, inlineAttachments] = await Promise.all([
        latestSocialContract(),
        resolveAsoClinicEmailCompany(),
        asoClinicEmailInlineAttachments(),
      ]);
      const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
      let paymentProofContents: Buffer;
      let guideContents: Buffer;
      try {
        const [paymentProofDownload, guideDownload] = await Promise.all([
          bucket.file(payment.proofStoragePath!).download(),
          bucket.file(text(guide.storagePath, 1500)).download(),
        ]);
        [paymentProofContents] = paymentProofDownload;
        [guideContents] = guideDownload;
      } catch {
        return NextResponse.json({ error: 'A solicitação ou o comprovante de pagamento não está disponível para o envio.' }, { status: 409 });
      }
      const guideAttachment = { filename: 'Solicitação do ASO.pdf', content: guideContents.toString('base64'), contentType: 'application/pdf' };
      const paymentAttachment = { filename: 'Comprovante de pagamento.pdf', content: paymentProofContents.toString('base64'), contentType: 'application/pdf' };
      let contractAttachment: { filename: string; content: string; contentType: string } | null = null;
      if (socialContract) {
        try {
          const [contents] = await bucket.file(text(socialContract.storagePath, 1500)).download();
          contractAttachment = { filename: 'Contrato social.pdf', content: contents.toString('base64'), contentType: 'application/pdf' };
        } catch {
          contractAttachment = null;
        }
      }
      const attachmentDescriptions = [
        { label: 'Solicitação do ASO', fileName: guideAttachment.filename },
        { label: 'Comprovante de pagamento', fileName: paymentAttachment.filename },
        ...(contractAttachment ? [{ label: 'Contrato social', fileName: contractAttachment.filename }] : []),
      ];
      const clinicContent = clinicAsoEmailContent({
        candidateName: currentRequest.candidateName,
        candidateCpf: currentRequest.candidateCpf,
        jobFunction: currentRequest.jobFunction,
        ...emailCompany,
        attachments: attachmentDescriptions,
        examType: currentRequest.examType,
      });
      await Promise.all([
        processRef.set({ asoClinicTokenHash: replyToken.hash, asoClinicTokenExpiresAt: isoAfterDays(30), updatedAt: now }, { merge: true }),
        clinicCommunicationRef.set({
          onboardingId: id,
          event: 'aso_clinic_request',
          category: 'aso_clinic_request',
          recipient: currentRequest.clinicEmail,
          subject: clinicContent.subject,
          status: 'pending',
          requestValidationId: text(requestValidation.id, 180) || null,
          generatedDocumentId: guide.id,
          socialContractDocumentId: socialContract?.id ?? null,
          createdAt: clinicCommunicationSnapshot.get('createdAt') ?? now,
          updatedAt: now,
        }, { merge: true }),
      ]);
      try {
        const result = await sendEmail({
          from: EMAIL_SENDERS.formalization,
          to: currentRequest.clinicEmail,
          ...(ASO_INBOUND_DOMAIN ? { replyTo: `aso+${replyToken.token}@${ASO_INBOUND_DOMAIN}` } : {}),
          subject: clinicContent.subject,
          html: renderClinicAsoRequestEmail({
            candidateName: currentRequest.candidateName,
            candidateCpf: currentRequest.candidateCpf,
            jobFunction: currentRequest.jobFunction,
            ...emailCompany,
            attachments: attachmentDescriptions,
            replyUrl,
            examType: currentRequest.examType,
          }),
          text: `${clinicContent.text}\n\nInforme o agendamento: ${replyUrl}`,
          attachments: [guideAttachment, paymentAttachment, ...(contractAttachment ? [contractAttachment] : []), ...inlineAttachments],
          tags: [{ name: 'category', value: 'aso_clinic_request' }, { name: 'onboarding_id', value: id.slice(0, 256) }],
        });
        clinicEmailResult = { ...clinicEmailResult, status: 'accepted', providerId: result.id };
        await Promise.all([
          clinicCommunicationRef.set({ status: 'accepted', providerId: result.id, acceptedAt: now, updatedAt: now }, { merge: true }),
          ...(socialContract ? [
            socialContract.ref.set({ accessCount: FieldValue.increment(1), lastAccessedAt: Timestamp.now() }, { merge: true }),
            socialContract.ref.collection('audit').add({ action: 'DOCUMENT_ATTACHED_TO_ASO_EMAIL', actorId: access.decoded.uid, actorName: access.actorName, onboardingId: id, providerId: result.id, at: Timestamp.now() }),
          ] : []),
        ]);
      } catch (error) {
        const message = errorMessage(error, 'Falha no envio à clínica.');
        clinicEmailResult = { ...clinicEmailResult, status: 'failed', error: message };
        await clinicCommunicationRef.set({ status: 'failed', lastError: message, updatedAt: now }, { merge: true });
      }
    }

    const latestProcessSnapshot = await processRef.get();
    const latestWorkflow = record(latestProcessSnapshot.get('asoWorkflow'));
    const startedAt = text(latestWorkflow.startedAt, 40) || text(workflow.startedAt, 40) || now;
    const nextWorkflow = {
      ...latestWorkflow,
      status: text(latestWorkflow.startedAt) && text(latestWorkflow.status) ? latestWorkflow.status : 'process_started',
      startedAt,
      startedBy: text(latestWorkflow.startedBy) || text(workflow.startedBy) || access.decoded.uid,
      startedByEmail: latestWorkflow.startedByEmail ?? workflow.startedByEmail ?? access.decoded.email ?? null,
      clinicEntityId,
      requestValidation,
      paymentRequestId: payment.id,
      paymentStatus: payment.status,
      appointmentStatus: latestWorkflow.appointmentStatus ?? workflow.appointmentStatus ?? 'awaiting_clinic',
      clinic: {
        ...record(latestWorkflow.clinic),
        name: currentRequest.clinicName,
        email: currentRequest.clinicEmail,
        location: currentRequest.clinicLocation,
        communicationId: clinicCommunicationRef.id,
        providerId: clinicEmailResult.providerId,
        emailStatus: clinicEmailResult.status,
        ...(!clinicEmailResult.error ? { sentAt: record(latestWorkflow.clinic).sentAt ?? record(workflow.clinic).sentAt ?? now, lastError: null } : { lastError: clinicEmailResult.error }),
      },
      updatedAt: now,
    };
    const paymentMessage = payment.status === 'awaiting_financial_authorization'
      ? 'Solicitação enviada ao Financeiro. Após a autorização, o PIX seguirá automaticamente pelo Banco Inter.'
      : payment.status === 'paid'
        ? 'PIX confirmado pelo Banco Inter.'
        : 'A solicitação de PIX já está em processamento no fluxo do Banco Inter.';
    const result = {
      emails: [clinicEmailResult],
      payment: {
        amount: payment.amount,
        beneficiary: payment.beneficiarySnapshot.name,
        maskedDestination: payment.beneficiarySnapshot.maskedPaymentDestination,
        status: payment.status,
        message: paymentMessage,
      },
    };
    await Promise.all([
      processRef.set({ asoWorkflow: nextWorkflow, updatedAt: now }, { merge: true }),
      addEvent(id, text(workflow.startedAt) || text(latestWorkflow.startedAt) ? 'ASO_PROCESS_RETRIED' : 'ASO_PROCESS_STARTED', access, {
        clinicEmailStatus: clinicEmailResult.status,
        paymentRequestId: payment.id,
        paymentStatus: payment.status,
      }),
    ]);
    return NextResponse.json({
      ok: clinicEmailResult.status !== 'failed',
      result,
      ...(clinicEmailResult.status === 'failed'
        ? { warning: 'O processo foi iniciado, mas o envio à clínica ficou pendente. Use “Tentar envio à clínica” após corrigir a falha.' }
        : {}),
    });
  }

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
    const requestValidation = record(workflow.requestValidation);
    const clinicEntityId = text(requestValidation.clinicEntityId, 180) || text(workflow.clinicEntityId, 180);
    if (!clinicEntityId || !text(requestValidation.fingerprint, 128)) {
      return NextResponse.json({ error: 'Atualize as guias antes de enviar o PIX para pagamento.' }, { status: 409 });
    }
    let currentRequest: Awaited<ReturnType<typeof buildAsoRequestSnapshot>>;
    try {
      currentRequest = await buildAsoRequestSnapshot(process, clinicEntityId);
    } catch (error) {
      return NextResponse.json({ error: errorMessage(error, 'A solicitação precisa ser atualizada novamente.') }, { status: 409 });
    }
    if (currentRequest.fingerprint !== text(requestValidation.fingerprint, 128)) {
      return NextResponse.json({ error: 'Os dados da solicitação mudaram. Atualize as guias antes de enviar o PIX para pagamento.' }, { status: 409 });
    }
    const clinicSnapshot = await hrDbAdmin.collection('asoClinicConfigs').doc(clinicEntityId).get();
    if (!clinicSnapshot.exists || clinicSnapshot.get('active') === false) return NextResponse.json({ error: 'A clínica selecionada está ausente ou inativa.' }, { status: 409 });
    const amount = currentRequest.clinicPrice;
    const actor = { uid: access.decoded.uid, email: access.decoded.email ?? null, name: access.actorName };
    const payment = await createPaymentRequest({
      sourceType: 'aso', sourceId: id, beneficiaryReference: { sourceType: 'entity', sourceId: clinicEntityId },
      amount, description: text(clinicSnapshot.get('defaultPaymentDescription'), 140) || `Pagamento de ASO ${process.asoExamType === 'dismissal' ? 'demissional' : 'admissional'}`,
    }, actor);
    const clinicName = payment.beneficiarySnapshot.name;
    const clinicEmail = email(clinicSnapshot.get('schedulingEmail'));
    await Promise.all([
      processRef.set({ asoWorkflow: { ...workflow, status: 'request_validated', clinicEntityId, paymentRequestId: payment.id, paymentStatus: payment.status, paymentProofStoragePath: payment.proofStoragePath ?? null, paymentConfirmedAt: payment.paidAt ?? null, clinic: { ...record(workflow.clinic), name: clinicName, email: clinicEmail }, updatedAt: now }, updatedAt: now }, { merge: true }),
      addEvent(id, 'ASO_PAYMENT_REQUESTED', access, { paymentRequestId: payment.id, clinicEntityId, amount, paymentStatus: payment.status }),
      hrDbAdmin.collection('hrNotifications').doc(`aso_payment_${id}`).set({
        type: 'aso_payment_authorization', status: payment.status === 'paid' ? 'completed' : 'pending', onboardingId: id, terminationId: text(process.sourceTerminationId) || null,
        title: `Pagamento de ASO — ${text(process.candidateName, 180) || 'colaborador'}`,
        message: `Autorize o PIX de ${amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} para ${clinicName}. Após a autorização, o sistema enviará automaticamente ao Banco Inter.`,
        channels: ['in_app'], recipient: { strategy: 'financial_pool' }, createdAt: now, updatedAt: now,
      }, { merge: true }),
    ]);
    return NextResponse.json({ ok: true, payment });
  }

  if (action === 'refresh_payment') {
    const paymentRequestId = text(workflow.paymentRequestId, 180);
    if (!paymentRequestId) return NextResponse.json({ error: 'O pagamento do ASO ainda não foi solicitado.' }, { status: 409 });
    let payment = await getPaymentRequest(paymentRequestId);
    if (payment.sourceType !== 'aso') return NextResponse.json({ error: 'A solicitação bancária não pertence a este ASO.' }, { status: 409 });
    if (payment.interRequestId && ['awaiting_bank_approval', 'processing', 'failed', 'rejected', 'approval_expired', 'paid'].includes(payment.status)) {
      payment = await refreshPaymentRequest(paymentRequestId, { uid: access.decoded.uid, email: access.decoded.email ?? null, name: access.actorName });
      if (payment.sourceType !== 'aso') return NextResponse.json({ error: 'A solicitação bancária não pertence a este ASO.' }, { status: 409 });
    }
    await processRef.set({ asoWorkflow: { ...workflow, paymentStatus: payment.status, paymentProofStoragePath: payment.proofStoragePath ?? null, paymentConfirmedAt: payment.paidAt ?? null, updatedAt: now }, updatedAt: now }, { merge: true });
    await addEvent(id, 'ASO_PAYMENT_REFRESHED', access, { paymentRequestId, paymentStatus: payment.status });
    return NextResponse.json({ ok: true, payment });
  }

  if (action === 'send_clinic_email') {
    const paymentRequestId = text(workflow.paymentRequestId, 180);
    if (!paymentRequestId) return NextResponse.json({ error: 'Solicite e confirme o pagamento do ASO antes do envio à clínica.' }, { status: 409 });
    const payment = await getPaymentRequest(paymentRequestId);
    if (payment.sourceType !== 'aso') return NextResponse.json({ error: 'A solicitação bancária não pertence a este ASO.' }, { status: 409 });
    if (payment.status !== 'paid' || !payment.proofStoragePath) return NextResponse.json({ error: 'O e-mail só será liberado após o Banco Inter confirmar o pagamento e o comprovante estar disponível.' }, { status: 409 });
    const guide = await latestGuide(id, workflow);
    const missing = missingAsoEmailPrerequisites({
      expectedAdmissionDate: text(process.expectedAdmissionDate, 10) || null,
      essentialFormDataReady: essentialFormDataReady(process),
      paymentPaid: true,
      requestPdfReady: Boolean(
        guide
        && text(guide.templateVersion, 80) === ASO_GUIDE_TEMPLATE_VERSION
        && workflow.latestGuideRequiresRegeneration !== true
      ),
    });
    if (missing.length > 0) return NextResponse.json({ error: `Conclua os pré-requisitos antes de enviar o e-mail: ${missing.join('; ')}.` }, { status: 409 });
    const clinicEntityId = text(workflow.clinicEntityId, 180);
    const clinicConfig = clinicEntityId ? await hrDbAdmin.collection('asoClinicConfigs').doc(clinicEntityId).get() : null;
    const clinicEmail = email(clinicConfig?.get('schedulingEmail'));
    if (!clinicEmail) return NextResponse.json({ error: 'O e-mail da clínica não está configurado.' }, { status: 409 });
    const clinicName = payment.beneficiarySnapshot.name;
    const validation = record(workflow.guideValidation);
    if (!guide || text(validation.documentId) !== guide.id) return NextResponse.json({ error: 'Valide a versão atual da guia antes do envio.' }, { status: 409 });
    const [socialContract, emailCompany, inlineAttachments] = await Promise.all([
      latestSocialContract(),
      resolveAsoClinicEmailCompany(),
      asoClinicEmailInlineAttachments(),
    ]);
    if (!socialContract) return NextResponse.json({ error: 'Nenhum contrato social em PDF ativo foi encontrado em Documentos da empresa.' }, { status: 409 });
    const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
    const [pdf, socialContractPdf, paymentProofPdf] = await Promise.all([
      bucket.file(text(guide.storagePath, 1500)).download().then(([contents]) => contents),
      bucket.file(text(socialContract.storagePath, 1500)).download().then(([contents]) => contents),
      bucket.file(payment.proofStoragePath).download().then(([contents]) => contents),
    ]);
    const inboundDomain = ASO_INBOUND_DOMAIN;
    if (!inboundDomain) return NextResponse.json({ error: 'O domínio de recebimento das respostas do ASO ainda não foi configurado.' }, { status: 503 });
    const replyToken = createAsoToken();
    const replyUrl = `${PUBLIC_URL}/aso/clinica/${replyToken.token}`;
    const communicationId = `aso_clinic_${id}_${guide.id}`;
    const contractAttachmentName = 'Anexo 1 - Contrato social.pdf';
    const proofAttachmentName = 'Anexo 2 - Comprovante de pagamento.pdf';
    const guideAttachmentName = 'Anexo 3 - Guia de solicitação do ASO.pdf';
    const clinicEmailContent = clinicAsoEmailContent({
      candidateName: text(process.candidateName, 240), jobFunction: text(process.functionName, 240) || text(process.jobRoleName, 240),
      ...emailCompany,
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
        html: renderClinicAsoRequestEmail({
          candidateName: text(process.candidateName, 240),
          jobFunction: text(process.functionName, 240) || text(process.jobRoleName, 240),
          ...emailCompany,
          attachments: [
            { label: 'Contrato social', fileName: contractAttachmentName },
            { label: 'Comprovante de pagamento', fileName: proofAttachmentName },
            { label: 'Guia de solicitação do ASO', fileName: guideAttachmentName },
          ],
          replyUrl,
          examType: process.asoExamType === 'dismissal' ? 'dismissal' : 'admission',
        }),
        text: `${clinicEmailContent.text}\n${replyUrl}`,
        attachments: [
          { filename: contractAttachmentName, content: socialContractPdf.toString('base64'), contentType: 'application/pdf' },
          { filename: proofAttachmentName, content: paymentProofPdf.toString('base64'), contentType: 'application/pdf' },
          { filename: guideAttachmentName, content: pdf.toString('base64'), contentType: 'application/pdf' },
          ...inlineAttachments,
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
    const date = text(body.date, 10); const time = text(body.time, 5);
    const requestValidation = record(workflow.requestValidation); const clinic = record(workflow.clinic);
    const clinicEntityId = text(workflow.clinicEntityId, 180) || text(requestValidation.clinicEntityId, 180);
    const storedLocation = readClinicLocation(clinic.location) || readClinicLocation(requestValidation.clinicLocation);
    const clinicLocation = storedLocation || await resolveAsoClinicLocation(clinicEntityId, text(clinic.name, 240));
    const location = clinicLocationLabel(clinicLocation);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: 'Informe data e horário.' }, { status: 400 });
    if (!clinicLocation || !location) return NextResponse.json({ error: 'O endereço da clínica não está configurado.' }, { status: 409 });
    const appointment = { date, time, location, instructions: null, source: 'manual', responseText: text(body.responseText, 12000) || null, confidence: 1, proposedAt: now };
    await Promise.all([
      processRef.set({ asoWorkflow: { ...workflow, status: 'appointment_pending_review', appointmentStatus: 'awaiting_clinic', appointment, clinic: { ...clinic, location: clinicLocation, repliedAt: now }, updatedAt: now }, updatedAt: now }, { merge: true }),
      addEvent(id, 'CLINIC_RESPONSE_REGISTERED', access, { source: 'manual', date, time, location }),
    ]);
    return NextResponse.json({ ok: true });
  }

  if (action === 'confirm_appointment') {
    const current = record(workflow.appointment);
    const date = text(body.date, 10) || text(current.date, 10); const time = text(body.time, 5) || text(current.time, 5);
    const requestValidation = record(workflow.requestValidation); const clinic = record(workflow.clinic);
    const clinicEntityId = text(workflow.clinicEntityId, 180) || text(requestValidation.clinicEntityId, 180);
    const storedLocation = readClinicLocation(clinic.location) || readClinicLocation(requestValidation.clinicLocation);
    const clinicLocation = storedLocation || await resolveAsoClinicLocation(clinicEntityId, text(clinic.name, 240));
    const location = clinicLocationLabel(clinicLocation);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: 'Informe data e horário antes de confirmar.' }, { status: 400 });
    if (!clinicLocation || !location) return NextResponse.json({ error: 'O endereço da clínica não está configurado.' }, { status: 409 });
    const recipient = email(process.candidateEmail);
    if (!recipient) return NextResponse.json({ error: 'O candidato não possui e-mail válido.' }, { status: 409 });
    const uploadToken = createAsoToken();
    const appointmentAt = `${date}T${time}:00-03:00`;
    const expiresAt = new Date(new Date(appointmentAt).getTime() + 21 * 24 * 60 * 60 * 1000).toISOString();
    const uploadUrl = `${PUBLIC_URL}/aso/candidato/${uploadToken.token}`;
    const appointmentLabel = formatAsoAppointment(date, time);
    const candidateEmailContent = candidateAsoEmailContent({ candidateName: text(process.candidateName, 240), appointmentLabel, uploadUrl, location: clinicLocation, examType: process.asoExamType === 'dismissal' ? 'dismissal' : 'admission' });
    const communicationId = `aso_candidate_${id}_${date}_${time.replace(':', '')}`;
    const result = await sendEmail({
      from: EMAIL_SENDERS.formalization, to: recipient,
      subject: candidateEmailContent.subject,
      html: renderCandidateAsoAppointmentEmail({
        candidateName: text(process.candidateName, 240),
        appointmentDate: date,
        appointmentTime: time,
        uploadUrl,
        location: clinicLocation,
        examType: process.asoExamType === 'dismissal' ? 'dismissal' : 'admission',
      }),
      text: candidateEmailContent.text,
      tags: [{ name: 'category', value: 'aso_candidate_notice' }, { name: 'onboarding_id', value: id.slice(0, 256) }],
    });
    await Promise.all([
      hrDbAdmin.collection('emailCommunications').doc(communicationId).set({ onboardingId: id, event: 'aso_candidate_notice', category: 'aso_candidate_notice', recipient, providerId: result.id, status: 'accepted', acceptedAt: now, createdAt: now, updatedAt: now }),
      processRef.set({
        asoCandidateTokenHash: uploadToken.hash, asoCandidateTokenExpiresAt: expiresAt,
        asoWorkflow: { ...workflow, status: 'candidate_notified', appointmentStatus: 'confirmed', appointmentAt, appointment: { ...current, date, time, location, instructions: null, confirmedAt: now, confirmedBy: access.decoded.uid }, clinic: { ...clinic, location: clinicLocation }, candidateNotification: { providerId: result.id, emailStatus: 'accepted', sentAt: now, uploadExpiresAt: expiresAt }, updatedAt: now }, updatedAt: now,
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
    const advancedToAccountant = decision === 'approved'
      && process.processKind !== 'termination_aso'
      && missingAccountantPrerequisites({
        documents: Array.isArray(process.documents) ? process.documents as OnboardingDocument[] : [],
        asoApproved: true,
        expectedAdmissionDate: text(process.expectedAdmissionDate, 10) || null,
        publicFormAnswers: process.publicFormAnswers,
      }).length === 0;
    await Promise.all([
      processRef.set({
        asoWorkflow: { ...workflow, status: decision === 'approved' ? 'completed' : 'aso_received', asoDocument: { ...aso, status: decision, reviewedAt: now, reviewedBy: access.decoded.uid, rejectionReason: decision === 'rejected' ? reason : null }, updatedAt: now },
        ...(advancedToAccountant ? { currentStage: 'accountant', currentStageStartedAt: now, status: 'accountant_pending' } : {}),
        updatedAt: now,
      }, { merge: true }),
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
    return NextResponse.json({ ok: true, advancedToAccountant });
  }

  return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
}
