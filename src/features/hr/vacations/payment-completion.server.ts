import 'server-only';

import { createHash } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import { PDFDocument } from 'pdf-lib';

import { createAutentiqueDocument, resendAutentiqueSignatures } from '@/lib/autentique.server';
import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError, reportSystemError } from '@/lib/observability';
import type { DPVacationSignatureParticipant, DPVacationWorkflow } from '@/types';

import { downloadVacationAutentiqueSignedPdf } from './autentique-signed-pdf.server';
import { vacationReceiptSignatureMessage } from './emails';

function conflict(code: string, safeMessage: string) {
  return new AppError({ code, kind: 'CONFLICT', safeMessage, httpStatus: 409 });
}

function notFound() {
  return new AppError({
    code: 'DP_VACATION_NOT_FOUND',
    kind: 'NOT_FOUND',
    safeMessage: 'Registro de férias não encontrado.',
    httpStatus: 404,
  });
}

function participantMap(participants: DPVacationSignatureParticipant[]) {
  return Object.fromEntries(participants.map((participant) => [participant.providerSignatureId, participant]));
}

function participantsFromRequest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value as Record<string, unknown>).flatMap((entry): DPVacationSignatureParticipant[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const participant = entry as Record<string, unknown>;
    const providerSignatureId = typeof participant.providerSignatureId === 'string' ? participant.providerSignatureId : '';
    const email = typeof participant.email === 'string' ? participant.email : '';
    const name = typeof participant.name === 'string' ? participant.name : '';
    if (!providerSignatureId || !email || !name) return [];
    return [{
      ...participant,
      providerSignatureId,
      party: 'employee',
      email,
      name,
      status: ['sent', 'viewed', 'signed', 'rejected', 'delivery_failed'].includes(String(participant.status))
        ? participant.status as DPVacationSignatureParticipant['status']
        : 'sent',
    } as DPVacationSignatureParticipant];
  });
}

async function ensureVacationReceiptSignatureSent(vacationId: string) {
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  const snapshot = await vacationRef.get();
  if (!snapshot.exists) throw notFound();
  const vacation = snapshot.data() ?? {};
  const workflow = vacation.workflow as DPVacationWorkflow | undefined;
  if (!workflow || workflow.payment.status !== 'paid') {
    throw conflict('DP_VACATION_PAYMENT_NOT_CONFIRMED', 'O pagamento ainda não foi confirmado.');
  }
  if (workflow.receipt.status !== 'approved' || !workflow.receipt.reviewedValues) {
    throw conflict('DP_VACATION_RECEIPT_NOT_APPROVED', 'O recibo precisa estar aprovado pelo RH.');
  }
  if (!workflow.receipt.originalStoragePath || !workflow.receipt.originalHashSha256 || !workflow.receipt.originalDocumentId) {
    throw conflict('DP_VACATION_RECEIPT_NOT_AVAILABLE', 'O recibo aprovado não está disponível.');
  }
  if (['sent', 'signed'].includes(workflow.receiptSignature.status)) {
    return { sent: true, idempotent: true, signatureRequestId: workflow.receiptSignature.signatureRequestId ?? null };
  }
  const userSnapshot = await dbAdmin.collection('users').doc(String(vacation.userId ?? '')).get();
  if (!userSnapshot.exists) throw conflict('DP_VACATION_EMPLOYEE_NOT_FOUND', 'A colaboradora não foi encontrada.');
  const employeeName = String(userSnapshot.get('username') ?? '').trim();
  const employeeEmail = String(userSnapshot.get('email') ?? '').trim().toLowerCase();
  if (!employeeName || !employeeEmail) {
    throw conflict('DP_VACATION_EMPLOYEE_CONTACT_REQUIRED', 'Informe o nome e o e-mail da colaboradora.');
  }
  const [buffer] = await getStorage(adminApp)
    .bucket(firebaseClientConfig.storageBucket)
    .file(workflow.receipt.originalStoragePath)
    .download();
  const actualHash = createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== workflow.receipt.originalHashSha256) {
    throw new AppError({
      code: 'DP_VACATION_RECEIPT_INTEGRITY',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'O recibo falhou na conferência de integridade.',
      metadata: { vacationId },
    });
  }
  const pdf = await PDFDocument.load(buffer);
  const signaturePage = Math.max(1, pdf.getPageCount());
  const requestId = `vacation_receipt_${vacationId}_${workflow.receipt.originalDocumentId}`;
  const requestRef = hrDbAdmin.collection('hrSignatureRequests').doc(requestId);
  const existingRequest = await requestRef.get();
  const existingProviderDocumentId = String(existingRequest.get('providerDocumentId') ?? '').trim();
  if (existingProviderDocumentId && ['sent', 'signed'].includes(String(existingRequest.get('status') ?? ''))) {
    const recoveredParticipants = participantsFromRequest(existingRequest.get('participants'));
    const recoveredAt = new Date().toISOString();
    await dbAdmin.runTransaction(async (transaction) => {
      const fresh = await transaction.get(vacationRef);
      if (!fresh.exists) throw notFound();
      const freshWorkflow = fresh.get('workflow') as DPVacationWorkflow;
      transaction.update(vacationRef, {
        workflow: {
          ...freshWorkflow,
          currentStage: 'receipt_signature',
          receiptSignature: {
            ...freshWorkflow.receiptSignature,
            status: 'sent',
            signatureRequestId: requestId,
            providerDocumentId: existingProviderDocumentId,
            participants: recoveredParticipants,
            sentAt: String(existingRequest.get('sentAt') ?? recoveredAt),
            lastError: null,
          },
          updatedAt: recoveredAt,
        },
        updatedAt: new Date(recoveredAt),
        updatedBy: 'system:vacation-receipt-signature',
      });
    });
    if (existingRequest.get('status') === 'signed') {
      await syncVacationReceiptSignatureRequest({ vacationId, signatureRequestId: requestId });
    }
    return { sent: true, idempotent: true, signatureRequestId: requestId };
  }
  const requestedAt = new Date().toISOString();
  await dbAdmin.runTransaction(async (transaction) => {
    const fresh = await transaction.get(vacationRef);
    if (!fresh.exists) throw notFound();
    const freshWorkflow = fresh.get('workflow') as DPVacationWorkflow;
    if (freshWorkflow.payment.status !== 'paid') throw conflict('DP_VACATION_PAYMENT_NOT_CONFIRMED', 'O pagamento ainda não foi confirmado.');
    if (freshWorkflow.receipt.status !== 'approved' || !freshWorkflow.receipt.reviewedValues) {
      throw conflict('DP_VACATION_RECEIPT_NOT_APPROVED', 'O recibo precisa estar aprovado pelo RH.');
    }
    if (['sending', 'sent', 'signed'].includes(freshWorkflow.receiptSignature.status)) {
      throw conflict('DP_VACATION_RECEIPT_SIGNATURE_STARTED', 'O recibo já foi encaminhado para assinatura.');
    }
    transaction.update(vacationRef, {
      workflow: {
        ...freshWorkflow,
        currentStage: 'receipt_signature',
        steps: freshWorkflow.steps.map((step) => {
          if (step.id === 'payment') return { ...step, status: 'completed', completedAt: freshWorkflow.payment.paidAt ?? requestedAt, completedBy: 'system:bank-reconciliation' };
          if (step.id === 'receipt_signature') return { ...step, status: 'in_progress', startedAt: step.startedAt ?? requestedAt };
          return step;
        }),
        receiptSignature: {
          ...freshWorkflow.receiptSignature,
          status: 'sending',
          signatureRequestId: requestId,
          lastError: null,
        },
        updatedAt: requestedAt,
      },
      updatedAt: new Date(requestedAt),
      updatedBy: 'system:vacation-receipt-signature',
    });
    transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
      vacationId,
      type: 'VACATION_RECEIPT_SIGNATURE_REQUESTED',
      message: 'Pagamento confirmado e envio do recibo para assinatura iniciado.',
      at: requestedAt,
      actorId: 'system:bank-reconciliation',
      actorEmail: null,
      actorName: 'Sistema',
      data: { signatureRequestId: requestId, receiptDocumentId: workflow.receipt.originalDocumentId },
    });
  });
  await requestRef.set({
    type: 'vacation_receipt_signature',
    purpose: 'vacation_receipt',
    status: 'sending',
    provider: 'autentique',
    vacationId,
    employeeId: String(vacation.userId ?? ''),
    documentId: workflow.receipt.originalDocumentId,
    documentStoragePath: workflow.receipt.originalStoragePath,
    documentHash: actualHash,
    documentName: `Coala Shakes - RH | Recibo de Férias - ${employeeName}`,
    signers: [{ party: 'employee', name: employeeName, email: employeeEmail, avatarUrl: userSnapshot.get('avatarUrl') ?? null }],
    requestedAt,
    requestedBy: 'system:bank-reconciliation',
    requestedByName: 'Sistema',
    updatedAt: requestedAt,
  }, { merge: true });

  try {
    const created = await createAutentiqueDocument({
      buffer,
      fileName: workflow.receipt.originalFileName || `recibo-de-ferias-${vacationId}.pdf`,
      documentName: `Coala Shakes - RH | Recibo de Férias - ${employeeName}`,
      message: vacationReceiptSignatureMessage({
        employeeName,
        vacationStartDate: String(vacation.startDate ?? ''),
        vacationEndDate: String(vacation.endDate ?? ''),
      }),
      signers: [{
        email: employeeEmail,
        name: employeeName,
        action: 'SIGN',
        positions: [{ x: '62.0', y: '86.0', z: signaturePage, element: 'SIGNATURE' }],
      }],
    });
    const sentAt = new Date().toISOString();
    const participants = created.document.signatures.flatMap((signature): DPVacationSignatureParticipant[] => {
      const providerSignatureId = String(signature.public_id ?? '').trim();
      if (!providerSignatureId) return [];
      return [{
        party: 'employee',
        providerSignatureId,
        name: String(signature.name ?? signature.user?.name ?? employeeName),
        email: String(signature.email ?? signature.user?.email ?? employeeEmail).toLowerCase(),
        avatarUrl: userSnapshot.get('avatarUrl') ?? null,
        status: 'sent',
        invitedAt: sentAt,
        emailSentAt: signature.email_events?.sent ?? null,
        emailDeliveredAt: signature.email_events?.delivered ?? null,
        emailOpenedAt: signature.email_events?.opened ?? null,
      }];
    });
    await requestRef.set({
      status: 'sent',
      sandbox: created.sandbox,
      providerDocumentId: created.document.id,
      providerCreatedAt: created.document.created_at,
      providerSignatures: created.document.signatures,
      participants: participantMap(participants),
      sentAt,
      updatedAt: sentAt,
    }, { merge: true });
    await dbAdmin.runTransaction(async (transaction) => {
      const fresh = await transaction.get(vacationRef);
      if (!fresh.exists) throw notFound();
      const freshWorkflow = fresh.get('workflow') as DPVacationWorkflow;
      if (freshWorkflow.receiptSignature.signatureRequestId !== requestId) return;
      transaction.update(vacationRef, {
        workflow: {
          ...freshWorkflow,
          receiptSignature: {
            ...freshWorkflow.receiptSignature,
            status: 'sent',
            providerDocumentId: created.document.id,
            participants,
            sentAt,
            lastError: null,
          },
          updatedAt: sentAt,
        },
        updatedAt: new Date(sentAt),
        updatedBy: 'system:vacation-receipt-signature',
      });
      transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
        vacationId,
        type: 'VACATION_RECEIPT_SIGNATURE_SENT',
        message: 'Recibo de férias enviado à colaboradora para assinatura.',
        at: sentAt,
        actorId: 'system:vacation-receipt-signature',
        actorEmail: null,
        actorName: 'Sistema',
        data: { signatureRequestId: requestId, providerDocumentId: created.document.id, signaturePage },
      });
    });
    return { sent: true, idempotent: false, signatureRequestId: requestId };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const safeMessage = 'Não foi possível enviar o recibo para assinatura.';
    await requestRef.set({ status: 'failed', lastError: safeMessage, failedAt, updatedAt: failedAt }, { merge: true });
    await dbAdmin.runTransaction(async (transaction) => {
      const failedSnapshot = await transaction.get(vacationRef);
      if (!failedSnapshot.exists) return;
      const failedWorkflow = failedSnapshot.get('workflow') as DPVacationWorkflow | undefined;
      if (!failedWorkflow || failedWorkflow.receiptSignature.signatureRequestId !== requestId) return;
      transaction.update(vacationRef, {
        workflow: {
          ...failedWorkflow,
          receiptSignature: {
            ...failedWorkflow.receiptSignature,
            status: 'failed',
            lastError: safeMessage,
          },
          updatedAt: failedAt,
        },
        updatedAt: new Date(failedAt),
        updatedBy: 'system:vacation-receipt-signature',
      });
    });
    throw new AppError({
      code: 'DP_VACATION_RECEIPT_SIGNATURE_SEND_FAILED',
      kind: 'TRANSIENT_EXTERNAL',
      safeMessage,
      cause: error,
      metadata: { vacationId, signatureRequestId: requestId },
    });
  }
}

export async function completeVacationPayment(params: {
  vacationId: string;
  paymentRequestId: string;
  amount: number;
  paidAt: string;
  proofStoragePath?: string | null;
}) {
  const vacationRef = dbAdmin.collection('dp_vacations').doc(params.vacationId);
  let shouldDispatch = false;
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const workflow = snapshot.get('workflow') as DPVacationWorkflow | undefined;
    if (!workflow || workflow.payment.paymentRequestId !== params.paymentRequestId) {
      throw conflict('DP_VACATION_PAYMENT_REQUEST_MISMATCH', 'O pagamento confirmado não pertence a estas férias.');
    }
    const alreadyPaid = workflow.payment.status === 'paid';
    const nextWorkflow: DPVacationWorkflow = {
      ...workflow,
      currentStage: ['sent', 'signed'].includes(workflow.receiptSignature.status) ? workflow.currentStage : 'receipt_signature',
      steps: workflow.steps.map((step) => {
        if (step.id === 'payment') return { ...step, status: 'completed', completedAt: params.paidAt, completedBy: 'system:bank-reconciliation' };
        if (step.id === 'receipt_signature' && !['sent', 'signed'].includes(workflow.receiptSignature.status)) {
          return { ...step, status: 'in_progress', startedAt: step.startedAt ?? params.paidAt };
        }
        return step;
      }),
      payment: {
        ...workflow.payment,
        status: 'paid',
        amount: params.amount,
        paidAt: params.paidAt,
        proofStoragePath: params.proofStoragePath ?? null,
        lastError: null,
      },
      receiptSignature: workflow.receiptSignature.status === 'blocked_until_payment'
        ? { ...workflow.receiptSignature, status: 'ready' }
        : workflow.receiptSignature,
      updatedAt: params.paidAt,
    };
    transaction.update(vacationRef, {
      workflow: nextWorkflow,
      updatedAt: new Date(params.paidAt),
      updatedBy: 'system:bank-reconciliation',
    });
    if (!alreadyPaid) {
      transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
        vacationId: params.vacationId,
        type: 'VACATION_PAYMENT_CONFIRMED',
        message: 'Pagamento das férias confirmado pelo fluxo bancário.',
        at: params.paidAt,
        actorId: 'system:bank-reconciliation',
        actorEmail: null,
        actorName: 'Sistema',
        data: { paymentRequestId: params.paymentRequestId, amount: params.amount },
      });
    }
    shouldDispatch = !['sending', 'sent', 'signed'].includes(nextWorkflow.receiptSignature.status);
  });
  if (shouldDispatch) {
    await ensureVacationReceiptSignatureSent(params.vacationId).catch((error) => {
      reportSystemError({
        error,
        source: 'job',
        operation: 'send-vacation-receipt-after-payment',
        routeOrJob: 'bank-payment-source-completion',
        metadata: { vacationId: params.vacationId, paymentRequestId: params.paymentRequestId },
      });
    });
  }
}

export async function retryVacationReceiptSignature(vacationId: string) {
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  const snapshot = await vacationRef.get();
  if (!snapshot.exists) throw notFound();
  const workflow = snapshot.get('workflow') as DPVacationWorkflow | undefined;
  const pendingParticipantIds = workflow?.receiptSignature.participants
    ?.filter((participant) => participant.status !== 'signed')
    .map((participant) => participant.providerSignatureId)
    .filter(Boolean) ?? [];
  if (workflow?.receiptSignature.providerDocumentId && pendingParticipantIds.length) {
    await resendAutentiqueSignatures(pendingParticipantIds);
    const resentAt = new Date().toISOString();
    await dbAdmin.runTransaction(async (transaction) => {
      const fresh = await transaction.get(vacationRef);
      if (!fresh.exists) throw notFound();
      const freshWorkflow = fresh.get('workflow') as DPVacationWorkflow;
      transaction.update(vacationRef, {
        workflow: {
          ...freshWorkflow,
          receiptSignature: {
            ...freshWorkflow.receiptSignature,
            status: 'sent',
            participants: freshWorkflow.receiptSignature.participants?.map((participant) => (
              pendingParticipantIds.includes(participant.providerSignatureId)
                ? { ...participant, status: 'sent', invitedAt: resentAt, deliveryFailureReason: null }
                : participant
            )),
            lastError: null,
          },
          updatedAt: resentAt,
        },
        updatedAt: new Date(resentAt),
        updatedBy: 'system:vacation-receipt-signature',
      });
      transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
        vacationId,
        type: 'VACATION_RECEIPT_SIGNATURE_RESENT',
        message: 'O convite pendente do recibo foi reenviado à colaboradora.',
        at: resentAt,
        actorId: 'system:vacation-receipt-signature',
        actorEmail: null,
        actorName: 'Sistema',
        data: { providerSignatureIds: pendingParticipantIds },
      });
    });
    return { sent: true, resent: true, signatureRequestId: workflow.receiptSignature.signatureRequestId ?? null };
  }
  return ensureVacationReceiptSignatureSent(vacationId);
}

export async function syncVacationReceiptSignatureRequest(params: {
  vacationId: string;
  signatureRequestId: string;
}) {
  const requestRef = hrDbAdmin.collection('hrSignatureRequests').doc(params.signatureRequestId);
  const request = await requestRef.get();
  if (!request.exists || request.get('vacationId') !== params.vacationId || request.get('purpose') !== 'vacation_receipt') return null;
  const participants = participantsFromRequest(request.get('participants'));
  const vacationRef = dbAdmin.collection('dp_vacations').doc(params.vacationId);
  const signedUrl = typeof request.get('signedFileUrl') === 'string' ? String(request.get('signedFileUrl')) : '';
  if (request.get('status') !== 'signed' || !signedUrl) {
    const updatedAt = new Date().toISOString();
    const failedParticipant = participants.find((participant) => (
      participant.status === 'delivery_failed' || participant.status === 'rejected'
    ));
    await dbAdmin.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(vacationRef);
      if (!snapshot.exists) throw notFound();
      const workflow = snapshot.get('workflow') as DPVacationWorkflow;
      if (workflow.receiptSignature.signatureRequestId !== params.signatureRequestId) return;
      transaction.update(vacationRef, {
        workflow: {
          ...workflow,
          receiptSignature: {
            ...workflow.receiptSignature,
            status: failedParticipant ? 'failed' : workflow.receiptSignature.status,
            participants,
            lastError: failedParticipant?.deliveryFailureReason
              ?? (failedParticipant ? 'O convite não foi concluído pela colaboradora.' : workflow.receiptSignature.lastError ?? null),
          },
          updatedAt,
        },
        updatedAt: new Date(updatedAt),
        updatedBy: 'system:autentique',
      });
    });
    return { signed: false };
  }
  const buffer = await downloadVacationAutentiqueSignedPdf(signedUrl);
  const signedHashSha256 = createHash('sha256').update(buffer).digest('hex');
  const signedStoragePath = `hr/vacations/${params.vacationId}/receipt/signed/${params.signatureRequestId}.pdf`;
  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(signedStoragePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType: 'application/pdf',
      cacheControl: 'private, max-age=0, no-store',
      metadata: { vacationId: params.vacationId, signatureRequestId: params.signatureRequestId, signedHashSha256 },
    },
  });
  const signedAt = typeof request.get('signedAt') === 'string' ? String(request.get('signedAt')) : new Date().toISOString();
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const workflow = snapshot.get('workflow') as DPVacationWorkflow;
    if (workflow.receiptSignature.signatureRequestId !== params.signatureRequestId) return;
    if (workflow.receiptSignature.status === 'signed' && workflow.receiptSignature.signedHashSha256 === signedHashSha256) return;
    transaction.update(vacationRef, {
      workflow: {
        ...workflow,
        currentStage: 'closure',
        steps: workflow.steps.map((step) => {
          if (step.id === 'receipt_signature') return { ...step, status: 'completed', completedAt: signedAt, completedBy: 'system:autentique' };
          if (step.id === 'closure') return { ...step, status: 'in_progress', startedAt: step.startedAt ?? signedAt };
          return step;
        }),
        receiptSignature: {
          ...workflow.receiptSignature,
          status: 'signed',
          providerDocumentId: String(request.get('providerDocumentId') ?? workflow.receiptSignature.providerDocumentId ?? ''),
          participants,
          signedAt,
          signedStoragePath,
          signedHashSha256,
          signedDocumentId: workflow.receipt.originalDocumentId ?? null,
          lastError: null,
        },
        closure: { ...workflow.closure, status: 'ready' },
        updatedAt: signedAt,
      },
      updatedAt: new Date(signedAt),
      updatedBy: 'system:autentique',
    });
    transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
      vacationId: params.vacationId,
      type: 'VACATION_RECEIPT_SIGNED',
      message: 'Recibo de férias assinado e arquivado. A trilha está pronta para conferência final do RH.',
      at: signedAt,
      actorId: 'system:autentique',
      actorEmail: null,
      actorName: 'Autentique',
      data: { signatureRequestId: params.signatureRequestId, signedHashSha256 },
    });
  });
  await requestRef.set({ archiveStatus: 'completed', signedStoragePath, signedHashSha256, updatedAt: signedAt }, { merge: true });
  return { signed: true };
}
