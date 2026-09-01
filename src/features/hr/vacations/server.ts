import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { NextRequest } from 'next/server';

import { createPaymentRequest, refreshPaymentRequest } from '@/features/financial/payment-requests/service.server';
import { getPaymentRequest } from '@/features/financial/payment-requests/repository.server';
import { resolveDocumentLegalEntitySnapshot } from '@/features/hr/documents/legal-entity-snapshot.server';
import { applyCoalaLetterheadToPdf } from '@/features/hr/documents/letterhead-pdf.server';
import { resolveCompanyDocumentSignatory } from '@/features/hr/documents/company-document-signatory.server';
import { canAccessUserByUnit } from '@/lib/unit-access';
import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { financialDbAdmin } from '@/lib/firebase-financial-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError, reportSystemError } from '@/lib/observability';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import { resolveCompanyProcessContact } from '@/lib/company/company-process-contact.server';
import { EMAIL_SENDERS, sendEmail } from '@/lib/email/resend';
import { getHrEmployeeId } from '@/lib/hr/person-link';
import {
  createAutentiqueDocument,
  getAutentiqueDocumentSignatures,
  type AutentiqueCreatedDocument,
} from '@/lib/autentique.server';
import {
  advanceVacationWorkflowToNotice,
  cancelVacationWorkflow,
  createInitialVacationWorkflow,
} from '@/lib/dp-vacation-workflow';
import type {
  DPVacationRecord,
  DPVacationSignatureParticipant,
  DPVacationWorkflow,
  User,
} from '@/types';

import type {
  CreateVacationInput,
  ReviewVacationReceiptInput,
  UpdateVacationInput,
  VacationCoreInput,
} from './schemas';
import { vacationAccountantEmailContent } from './emails';
import { downloadVacationAutentiqueSignedPdf } from './autentique-signed-pdf.server';
import {
  retryVacationReceiptSignature,
  syncVacationReceiptSignatureRequest,
} from './payment-completion.server';
import { buildVacationNoticePdf } from './vacation-notice-pdf.server';

const VACATION_QUERY_LIMIT = 200;
const PUBLIC_RECRUITMENT_URL = process.env.NEXT_PUBLIC_RECRUITMENT_URL?.trim()
  || 'https://vagas.coalashakes.com';

function belemDateOnly(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Belem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateLength(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

function returnDate(endDate: string) {
  const [year, month, day] = endDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function actorName(context: ServerUserContext) {
  return String(context.userDoc.username ?? context.decoded.email ?? context.decoded.uid);
}

function canManageVacation(context: ServerUserContext, action: 'request' | 'approve' | 'view') {
  if (context.isDefaultAdmin) return true;
  if (action === 'request') return context.permissions.dp?.vacation?.request === true;
  if (action === 'approve') return context.permissions.dp?.vacation?.approve === true;
  return context.permissions.dp?.vacation?.viewAll === true;
}

function forbidden() {
  return new AppError({
    code: 'DP_VACATION_FORBIDDEN',
    kind: 'AUTHORIZATION',
    safeMessage: 'Sem permissão para alterar estas férias.',
    httpStatus: 403,
  });
}

function notFound() {
  return new AppError({
    code: 'DP_VACATION_NOT_FOUND',
    kind: 'NOT_FOUND',
    safeMessage: 'Registro de férias não encontrado.',
    httpStatus: 404,
  });
}

function conflict(code: string, safeMessage: string) {
  return new AppError({ code, kind: 'CONFLICT', safeMessage, httpStatus: 409 });
}

function cleanedCore(input: VacationCoreInput) {
  if (input.recordType === 'venda') {
    return {
      cycleId: input.cycleId,
      recordType: input.recordType,
      days: input.days,
      startDate: null,
      endDate: null,
      returnDate: null,
    } as const;
  }
  const startDate = input.startDate!;
  const endDate = input.endDate!;
  return {
    cycleId: input.cycleId,
    recordType: input.recordType,
    startDate,
    endDate,
    days: dateLength(startDate, endDate),
    returnDate: input.returnDate ?? returnDate(endDate),
  } as const;
}

function overlapping(left: Record<string, unknown>, right: ReturnType<typeof cleanedCore>) {
  if (right.recordType !== 'gozo' || left.recordType !== 'gozo') return false;
  if (left.status === 'REJECTED') return false;
  const leftStart = typeof left.startDate === 'string' ? left.startDate : '';
  const leftEnd = typeof left.endDate === 'string' ? left.endDate : '';
  return Boolean(leftStart && leftEnd && leftStart <= right.endDate && leftEnd >= right.startDate);
}

function serialize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof (value as { toDate?: unknown })?.toDate === 'function') {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serialize(entry)]));
  }
  return value;
}

function vacationEvent(
  context: ServerUserContext,
  vacationId: string,
  type: string,
  message: string,
  now: string,
  data: Record<string, unknown> = {},
) {
  return {
    vacationId,
    type,
    message,
    at: now,
    actorId: context.decoded.uid,
    actorEmail: context.decoded.email ?? null,
    actorName: actorName(context),
    data,
  };
}

async function assertTargetAccess(
  transaction: FirebaseFirestore.Transaction,
  context: ServerUserContext,
  userId: string,
) {
  const userSnapshot = await transaction.get(dbAdmin.collection('users').doc(userId));
  if (!userSnapshot.exists) {
    throw new AppError({
      code: 'DP_VACATION_USER_NOT_FOUND',
      kind: 'NOT_FOUND',
      safeMessage: 'Colaborador não encontrado.',
      httpStatus: 404,
    });
  }
  const target = userSnapshot.data() ?? {};
  const legacyUnitId = typeof target.unitId === 'string' ? target.unitId.trim() : '';
  const targetUnitIds = Array.isArray(target.unitIds)
    ? target.unitIds.filter((value): value is string => typeof value === 'string')
    : [];
  if (!canAccessUserByUnit(context.userDoc, {
    ...target,
    unitIds: legacyUnitId ? [...targetUnitIds, legacyUnitId] : targetUnitIds,
  }, {
    isDefaultAdmin: context.isDefaultAdmin,
  })) {
    throw forbidden();
  }
  return {
    id: userSnapshot.id,
    ...target,
  } as User;
}

async function relatedVacations(
  transaction: FirebaseFirestore.Transaction,
  userId: string,
) {
  const snapshot = await transaction.get(
    dbAdmin.collection('dp_vacations')
      .where('userId', '==', userId)
      .limit(VACATION_QUERY_LIMIT),
  );
  if (snapshot.size >= VACATION_QUERY_LIMIT) {
    throw conflict(
      'DP_VACATION_HISTORY_LIMIT',
      'Há registros demais para validar o histórico com segurança.',
    );
  }
  return snapshot.docs;
}

function validateAgainstHistory(
  documents: FirebaseFirestore.QueryDocumentSnapshot[],
  core: ReturnType<typeof cleanedCore>,
  options: { ignoreId?: string } = {},
) {
  const current = documents
    .filter((document) => document.id !== options.ignoreId)
    .map((document) => document.data())
    .filter((record) => record.status !== 'REJECTED');
  if (current.some((record) => overlapping(record, core))) {
    throw conflict('DP_VACATION_OVERLAP', 'Já existem férias sobrepostas para esta colaboradora.');
  }
  const usedDays = current
    .filter((record) => record.cycleId === core.cycleId)
    .reduce((total, record) => total + (Number(record.days) || 0), 0);
  if (usedDays + core.days > 30) {
    throw conflict('DP_VACATION_CYCLE_BALANCE', 'Os registros deste ciclo ultrapassariam 30 dias.');
  }
}

function safeFilePart(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'colaborador';
}

function requiredText(value: unknown, code: string, safeMessage: string) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw conflict(code, safeMessage);
  return normalized;
}

function vacationSourceFingerprint(input: {
  vacationId: string;
  userId: string;
  cycleId: string;
  startDate: string;
  endDate: string;
  returnDate: string;
  days: number;
  employeeName: string;
  employeeEmail: string;
  companyLegalName: string;
  companyCnpj: string;
  companyAddress: string;
}) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

async function resolveVacationEmployer(user: User) {
  const unitId = typeof user.employerUnitId === 'string' && user.employerUnitId.trim()
    ? user.employerUnitId.trim()
    : typeof user.unitId === 'string' && user.unitId.trim()
      ? user.unitId.trim()
      : null;
  const unit = unitId ? await dbAdmin.collection('dp_units').doc(unitId).get() : null;
  const rawCnpj = typeof user.employerCnpj === 'string' && user.employerCnpj.trim()
    ? user.employerCnpj
    : unit?.get('cnpj');
  const validation = CnpjValidator.validate(rawCnpj ?? '');
  if (!validation.valid) {
    throw conflict(
      'DP_VACATION_EMPLOYER_CNPJ_REQUIRED',
      'Defina o CNPJ da empregadora no cadastro da colaboradora antes de gerar o aviso.',
    );
  }
  const fallbackName = typeof user.employerUnitName === 'string' && user.employerUnitName.trim()
    ? user.employerUnitName.trim()
    : String(unit?.get('legalName') ?? unit?.get('name') ?? '').trim();
  const fallbackAddress = typeof user.employerAddress === 'string' && user.employerAddress.trim()
    ? user.employerAddress.trim()
    : String(unit?.get('address') ?? '').trim();
  const employer = await resolveDocumentLegalEntitySnapshot({
    cnpj: validation.clean,
    fallbackName,
    fallbackAddress,
  });
  if (!employer.legalName.trim()) {
    throw conflict(
      'DP_VACATION_EMPLOYER_NAME_REQUIRED',
      'Defina a razão social da empregadora antes de gerar o aviso.',
    );
  }
  return { ...employer, cnpj: validation.clean };
}

async function ensureVacationAccountantRequestSent(vacationId: string) {
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  const snapshot = await vacationRef.get();
  if (!snapshot.exists) throw notFound();
  const current = snapshot.data() ?? {};
  const workflow = current.workflow as DPVacationWorkflow | undefined;
  if (!workflow || workflow.notice.status !== 'signed' || !workflow.notice.signedStoragePath || !workflow.notice.signedHashSha256) {
    throw conflict('DP_VACATION_ACCOUNTANT_NOTICE_REQUIRED', 'O aviso assinado ainda não está disponível para a contabilidade.');
  }
  if (['sent', 'receipt_received', 'completed'].includes(workflow.accountant.status)) {
    return { sent: true, idempotent: true, recipientEmail: workflow.accountant.recipientEmail ?? null };
  }
  const userSnapshot = await dbAdmin.collection('users').doc(String(current.userId ?? '')).get();
  if (!userSnapshot.exists) throw conflict('DP_VACATION_EMPLOYEE_NOT_FOUND', 'A colaboradora vinculada às férias não foi encontrada.');
  const user = { id: userSnapshot.id, ...userSnapshot.data() } as User;
  const employer = await resolveVacationEmployer(user);
  const configuredContact = await resolveCompanyProcessContact('vacation', employer)
    ?? await resolveCompanyProcessContact('onboarding', employer);
  if (!configuredContact?.email) {
    throw conflict(
      'DP_VACATION_ACCOUNTANT_EMAIL_REQUIRED',
      'Defina no cadastro da empresa um e-mail setorial para férias ou integração.',
    );
  }
  const employeeName = requiredText(user.username, 'DP_VACATION_EMPLOYEE_NAME_REQUIRED', 'Informe o nome da colaboradora.');
  const startDate = requiredText(current.startDate, 'DP_VACATION_START_REQUIRED', 'Informe o início das férias.');
  const endDate = requiredText(current.endDate, 'DP_VACATION_END_REQUIRED', 'Informe o término das férias.');
  const cycleId = requiredText(current.cycleId, 'DP_VACATION_CYCLE_REQUIRED', 'Informe o período aquisitivo.');
  const correctionReason = workflow.receipt.status === 'correction_requested'
    ? workflow.receipt.correctionReason ?? null
    : null;
  const correctionRound = correctionReason ? (workflow.accountant.correctionRound ?? 0) + 1 : workflow.accountant.correctionRound ?? 0;
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  const tokenExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const communicationId = `vacation_accountant_${vacationId}_${correctionRound}`;
  const communicationRef = hrDbAdmin.collection('emailCommunications').doc(communicationId);
  const previousCommunication = await communicationRef.get();
  if (previousCommunication.get('providerId') && previousCommunication.get('status') !== 'failed') {
    const recoveredAt = new Date().toISOString();
    await vacationRef.set({
      workflow: {
        ...workflow,
        accountant: {
          ...workflow.accountant,
          status: 'sent',
          recipientEmail: configuredContact.email,
          communicationId,
          providerEmailId: String(previousCommunication.get('providerId')),
          emailStatus: String(previousCommunication.get('status') ?? 'accepted'),
          sentAt: String(previousCommunication.get('acceptedAt') ?? recoveredAt),
          lastError: null,
        },
        updatedAt: recoveredAt,
      },
      updatedAt: new Date(recoveredAt),
      updatedBy: 'system:vacation-accountant-email',
    }, { merge: true });
    return { sent: true, idempotent: true, recipientEmail: configuredContact.email };
  }

  const requestedAt = new Date().toISOString();
  await dbAdmin.runTransaction(async (transaction) => {
    const fresh = await transaction.get(vacationRef);
    if (!fresh.exists) throw notFound();
    const freshWorkflow = fresh.get('workflow') as DPVacationWorkflow;
    const allowed = ['ready_to_send', 'failed'].includes(freshWorkflow.accountant.status)
      || (freshWorkflow.accountant.status === 'correction_requested' && freshWorkflow.receipt.status === 'correction_requested');
    if (!allowed) {
      throw conflict('DP_VACATION_ACCOUNTANT_SEND_STATE', 'A solicitação à contabilidade já foi iniciada ou não está disponível.');
    }
    transaction.update(vacationRef, {
      workflow: {
        ...freshWorkflow,
        accountant: {
          ...freshWorkflow.accountant,
          status: 'sending',
          recipientEmail: configuredContact.email,
          communicationId,
          emailStatus: 'pending',
          tokenHash,
          tokenExpiresAt,
          correctionRound,
          lastError: null,
        },
        updatedAt: requestedAt,
      },
      updatedAt: new Date(requestedAt),
      updatedBy: 'system:vacation-accountant-email',
    });
    transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
      vacationId,
      type: correctionReason ? 'VACATION_RECEIPT_CORRECTION_SEND_REQUESTED' : 'VACATION_ACCOUNTANT_SEND_REQUESTED',
      message: correctionReason ? 'Reenvio do recibo solicitado à contabilidade.' : 'Envio do aviso assinado à contabilidade iniciado.',
      at: requestedAt,
      actorId: 'system:vacation-workflow',
      actorEmail: null,
      actorName: 'Sistema',
      data: { recipientEmail: configuredContact.email, communicationId, correctionRound },
    });
  });

  try {
    const [signedNotice] = await getStorage(adminApp)
    .bucket(firebaseClientConfig.storageBucket)
    .file(workflow.notice.signedStoragePath)
    .download();
  const actualHash = createHash('sha256').update(signedNotice).digest('hex');
  if (actualHash !== workflow.notice.signedHashSha256) {
    throw new AppError({
      code: 'DP_VACATION_SIGNED_NOTICE_INTEGRITY',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'O aviso assinado falhou na conferência de integridade.',
      metadata: { vacationId },
    });
  }
  const uploadUrl = `${PUBLIC_RECRUITMENT_URL}/ferias/contabilidade/${token}`;
  const email = vacationAccountantEmailContent({
    employeeName,
    companyLegalName: employer.legalName,
    acquisitionCycle: cycleId,
    vacationStartDate: startDate,
    vacationEndDate: endDate,
    receiptUploadUrl: uploadUrl,
    correctionReason,
  });
  await communicationRef.set({
    vacationId,
    event: correctionReason ? 'vacation_receipt_correction' : 'vacation_accountant_request',
    category: correctionReason ? 'vacation_receipt_correction' : 'vacation_accountant_request',
    recipient: configuredContact.email,
    subject: email.subject,
    status: 'pending',
    attachmentHashSha256: actualHash,
    createdAt: requestedAt,
    updatedAt: requestedAt,
  }, { merge: true });

    const result = await sendEmail({
      from: EMAIL_SENDERS.formalization,
      to: configuredContact.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: [{
        filename: `Aviso de férias assinado - ${employeeName}.pdf`,
        content: signedNotice.toString('base64'),
        contentType: 'application/pdf',
      }],
      tags: [
        { name: 'category', value: correctionReason ? 'vacation_receipt_correction' : 'vacation_accountant_request' },
        { name: 'vacation_id', value: vacationId.slice(0, 256) },
      ],
    });
    const sentAt = new Date().toISOString();
    await communicationRef.set({
      status: 'accepted',
      providerId: result.id,
      acceptedAt: sentAt,
      updatedAt: sentAt,
    }, { merge: true });
    await dbAdmin.runTransaction(async (transaction) => {
      const fresh = await transaction.get(vacationRef);
      if (!fresh.exists) throw notFound();
      const freshWorkflow = fresh.get('workflow') as DPVacationWorkflow;
      if (freshWorkflow.accountant.communicationId !== communicationId
        || freshWorkflow.accountant.tokenHash !== tokenHash) return;
      transaction.update(vacationRef, {
        workflow: {
          ...freshWorkflow,
          accountant: {
            ...freshWorkflow.accountant,
            status: 'sent',
            providerEmailId: result.id,
            emailStatus: 'accepted',
            sentAt,
            lastError: null,
          },
          receipt: correctionReason
            ? { ...freshWorkflow.receipt, status: 'correction_requested' }
            : freshWorkflow.receipt,
          updatedAt: sentAt,
        },
        updatedAt: new Date(sentAt),
        updatedBy: 'system:vacation-accountant-email',
      });
      transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
        vacationId,
        type: correctionReason ? 'VACATION_RECEIPT_CORRECTION_SENT' : 'VACATION_ACCOUNTANT_SENT',
        message: correctionReason ? 'Solicitação de correção enviada à contabilidade.' : 'Aviso assinado e link do recibo enviados à contabilidade.',
        at: sentAt,
        actorId: 'system:vacation-workflow',
        actorEmail: null,
        actorName: 'Sistema',
        data: { recipientEmail: configuredContact.email, communicationId, providerEmailId: result.id },
      });
    });
    return { sent: true, idempotent: false, recipientEmail: configuredContact.email };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const safeMessage = 'Não foi possível enviar a solicitação à contabilidade.';
    await communicationRef.set({ status: 'failed', lastError: safeMessage, failedAt, updatedAt: failedAt }, { merge: true });
    await dbAdmin.runTransaction(async (transaction) => {
      const failedSnapshot = await transaction.get(vacationRef);
      if (!failedSnapshot.exists) return;
      const failedWorkflow = failedSnapshot.get('workflow') as DPVacationWorkflow | undefined;
      if (!failedWorkflow || failedWorkflow.accountant.communicationId !== communicationId) return;
      transaction.update(vacationRef, {
        workflow: {
          ...failedWorkflow,
          accountant: {
            ...failedWorkflow.accountant,
            status: 'failed',
            emailStatus: 'failed',
            lastError: safeMessage,
          },
          updatedAt: failedAt,
        },
        updatedAt: new Date(failedAt),
        updatedBy: 'system:vacation-accountant-email',
      });
    });
    throw new AppError({
      code: 'DP_VACATION_ACCOUNTANT_EMAIL_FAILED',
      kind: 'TRANSIENT_EXTERNAL',
      safeMessage,
      cause: error,
      metadata: { vacationId, communicationId },
    });
  }
}

async function attemptVacationAccountantDispatch(vacationId: string) {
  try {
    return await ensureVacationAccountantRequestSent(vacationId);
  } catch (error) {
    const failedAt = new Date().toISOString();
    const safeMessage = error instanceof AppError
      ? error.safeMessage
      : 'Não foi possível iniciar a solicitação à contabilidade.';
    const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
    await dbAdmin.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(vacationRef);
      if (!snapshot.exists) return;
      const workflow = snapshot.get('workflow') as DPVacationWorkflow | undefined;
      if (!workflow || ['sent', 'receipt_received', 'completed'].includes(workflow.accountant.status)) return;
      transaction.update(vacationRef, {
        workflow: {
          ...workflow,
          accountant: { ...workflow.accountant, status: 'failed', lastError: safeMessage },
          updatedAt: failedAt,
        },
        updatedAt: new Date(failedAt),
        updatedBy: 'system:vacation-workflow',
      });
      transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
        vacationId,
        type: 'VACATION_ACCOUNTANT_SEND_FAILED',
        message: safeMessage,
        at: failedAt,
        actorId: 'system:vacation-workflow',
        actorEmail: null,
        actorName: 'Sistema',
        data: { errorCode: error instanceof AppError ? error.code : 'UNEXPECTED_ERROR' },
      });
    });
    return { sent: false, idempotent: false, recipientEmail: null, error: safeMessage };
  }
}

function workflowForStoredVacation(
  current: Record<string, unknown>,
  now: string,
  asOfDate: string,
) {
  return (current.workflow as DPVacationWorkflow | undefined)
    ?? createInitialVacationWorkflow({
      status: current.status as DPVacationRecord['status'],
      startDate: String(current.startDate ?? ''),
      endDate: String(current.endDate ?? ''),
      now,
      asOfDate,
    });
}

function participantStatus(
  signature: AutentiqueCreatedDocument['signatures'][number],
): DPVacationSignatureParticipant['status'] {
  if (signature.signed?.created_at) return 'signed';
  if (signature.rejected?.created_at) return 'rejected';
  if (signature.viewed?.created_at) return 'viewed';
  if (signature.email_events?.refused) return 'delivery_failed';
  return 'sent';
}

function deliveryFailureReason(value: unknown) {
  const reason = typeof value === 'string' ? value.trim() : '';
  return reason
    ? reason.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').slice(0, 300)
    : null;
}

type VacationNoticeSigner = {
  party: DPVacationSignatureParticipant['party'];
  name: string;
  email: string;
  avatarUrl?: string | null;
};

function participantsFromProvider(input: {
  signatures: AutentiqueCreatedDocument['signatures'];
  signers: VacationNoticeSigner[];
  invitedAt: string;
}) {
  return input.signatures.flatMap((signature): DPVacationSignatureParticipant[] => {
    const providerSignatureId = String(signature.public_id ?? '').trim();
    const email = String(signature.email ?? signature.user?.email ?? '').trim().toLowerCase();
    const signer = input.signers.find((candidate) => candidate.email.toLowerCase() === email);
    if (!providerSignatureId || !signer) return [];
    const networkEvent = signature.signed ?? signature.rejected ?? signature.viewed;
    return [{
      party: signer.party,
      providerSignatureId,
      name: String(signature.name ?? signature.user?.name ?? signer.name).trim() || signer.name,
      email: email || signer.email,
      avatarUrl: signer.avatarUrl ?? null,
      status: participantStatus(signature),
      invitedAt: input.invitedAt,
      emailSentAt: signature.email_events?.sent ?? null,
      emailDeliveredAt: signature.email_events?.delivered ?? null,
      deliveryFailureReason: signature.email_events?.refused
        ? deliveryFailureReason(signature.email_events.reason)
        : null,
      emailOpenedAt: signature.email_events?.opened ?? null,
      viewedAt: signature.viewed?.created_at ?? null,
      signedAt: signature.signed?.created_at ?? null,
      rejectedAt: signature.rejected?.created_at ?? null,
      lastIp: networkEvent?.ip ?? null,
      lastPort: networkEvent?.port ?? null,
    }];
  });
}

function participantMap(participants: DPVacationSignatureParticipant[]) {
  return Object.fromEntries(participants.map((participant) => [participant.providerSignatureId, participant]));
}

function participantsFromRequest(value: unknown): DPVacationSignatureParticipant[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value as Record<string, unknown>).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const participant = entry as Record<string, unknown>;
    const providerSignatureId = typeof participant.providerSignatureId === 'string'
      ? participant.providerSignatureId.trim()
      : '';
    const party = participant.party === 'company' ? 'company' : participant.party === 'employee' ? 'employee' : null;
    const email = typeof participant.email === 'string' ? participant.email.trim().toLowerCase() : '';
    const name = typeof participant.name === 'string' ? participant.name.trim() : '';
    const status = ['sent', 'viewed', 'signed', 'rejected', 'delivery_failed'].includes(String(participant.status))
      ? participant.status as DPVacationSignatureParticipant['status']
      : 'sent';
    if (!providerSignatureId || !party || !email || !name) return [];
    return [{
      ...participant,
      providerSignatureId,
      party,
      email,
      name,
      status,
    } as DPVacationSignatureParticipant];
  });
}

export async function createVacation(request: NextRequest, input: CreateVacationInput) {
  const context = await requireUser(request);
  if (!canManageVacation(context, 'request')) throw forbidden();
  if (input.status === 'APPROVED' && !canManageVacation(context, 'approve')) throw forbidden();

  const core = cleanedCore(input.vacation);
  const now = new Date().toISOString();
  const asOfDate = belemDateOnly();
  const vacationRef = dbAdmin.collection('dp_vacations').doc();
  const eventRef = dbAdmin.collection('dp_vacationEvents').doc();
  let created: Record<string, unknown> = {};

  await dbAdmin.runTransaction(async (transaction) => {
    await assertTargetAccess(transaction, context, input.userId);
    const history = await relatedVacations(transaction, input.userId);
    validateAgainstHistory(history, core);
    const workflow = core.recordType === 'gozo'
      ? createInitialVacationWorkflow({
          status: input.status,
          startDate: core.startDate,
          endDate: core.endDate,
          now,
          asOfDate,
          actorId: context.decoded.uid,
        })
      : undefined;
    const warnings = workflow?.legalAnalysis.checks
      .filter((check) => check.status === 'warning')
      .map((check) => check.message) ?? [];
    created = {
      userId: input.userId,
      ...core,
      status: input.status,
      warnings,
      ...(workflow ? { workflow } : {}),
      createdAt: new Date(now),
      updatedAt: new Date(now),
      createdBy: context.decoded.uid,
      updatedBy: context.decoded.uid,
    };
    transaction.create(vacationRef, created);
    transaction.create(eventRef, vacationEvent(
      context,
      vacationRef.id,
      'VACATION_CREATED',
      core.recordType === 'gozo' ? 'Agendamento de férias registrado.' : 'Abono de férias registrado.',
      now,
      { cycleId: core.cycleId, status: input.status },
    ));
  });

  return { id: vacationRef.id, ...serialize(created) as Record<string, unknown> };
}

export async function generateVacationNotice(request: NextRequest, vacationId: string) {
  const context = await requireUser(request);
  if (!canManageVacation(context, 'approve')) throw forbidden();

  const now = new Date().toISOString();
  const asOfDate = belemDateOnly();
  const operationId = randomUUID();
  const documentId = randomUUID();
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  const requestedEventRef = dbAdmin.collection('dp_vacationEvents').doc();

  const source = await dbAdmin.runTransaction(async (transaction): Promise<{
    current: Record<string, unknown>;
    user: User;
    workflow: DPVacationWorkflow;
  }> => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    const user = await assertTargetAccess(transaction, context, String(current.userId ?? ''));
    if (current.recordType !== 'gozo' || current.status !== 'APPROVED') {
      throw conflict('DP_VACATION_NOTICE_NOT_READY', 'Aprove o agendamento antes de gerar o aviso.');
    }
    const workflow = workflowForStoredVacation(current, now, asOfDate);
    if (!['not_generated', 'failed'].includes(workflow.notice.status)) {
      throw conflict(
        'DP_VACATION_NOTICE_GENERATION_STATE',
        workflow.notice.status === 'generating'
          ? 'O aviso já está sendo gerado.'
          : 'O aviso já foi gerado. Abra o documento para validá-lo.',
      );
    }
    if (workflow.legalAnalysis.checks.some((check) => check.blocking)) {
      throw conflict('DP_VACATION_LEGAL_BLOCK', 'Corrija os impedimentos antes de gerar o aviso.');
    }
    const nextWorkflow: DPVacationWorkflow = {
      ...workflow,
      currentStage: 'notice',
      notice: {
        status: 'generating',
        documentId,
        generationOperationId: operationId,
        generationRequestedAt: now,
        generationErrorCode: null,
      },
      updatedAt: now,
    };
    transaction.update(vacationRef, {
      workflow: nextWorkflow,
      updatedAt: new Date(now),
      updatedBy: context.decoded.uid,
    });
    transaction.create(requestedEventRef, vacationEvent(
      context,
      vacationId,
      'VACATION_NOTICE_GENERATION_REQUESTED',
      'Geração do aviso de férias iniciada.',
      now,
      { operationId, documentId },
    ));
    return { current, user, workflow: nextWorkflow };
  });

  try {
    const current = source.current;
    const employeeName = requiredText(
      source.user.username,
      'DP_VACATION_EMPLOYEE_NAME_REQUIRED',
      'Informe o nome da colaboradora antes de gerar o aviso.',
    );
    const employeeEmail = requiredText(
      source.user.email,
      'DP_VACATION_EMPLOYEE_EMAIL_REQUIRED',
      'Informe o e-mail da colaboradora antes de gerar o aviso.',
    );
    const startDate = requiredText(current.startDate, 'DP_VACATION_START_REQUIRED', 'Informe o início das férias.');
    const endDate = requiredText(current.endDate, 'DP_VACATION_END_REQUIRED', 'Informe o término das férias.');
    const expectedReturnDate = requiredText(current.returnDate, 'DP_VACATION_RETURN_REQUIRED', 'Informe a data de retorno.');
    const cycleId = requiredText(current.cycleId, 'DP_VACATION_CYCLE_REQUIRED', 'Informe o período aquisitivo.');
    const employer = await resolveVacationEmployer(source.user);
    const fingerprintInput = {
      vacationId,
      userId: source.user.id,
      cycleId,
      startDate,
      endDate,
      returnDate: expectedReturnDate,
      days: Number(current.days),
      employeeName,
      employeeEmail,
      companyLegalName: employer.legalName,
      companyCnpj: employer.cnpj,
      companyAddress: employer.address,
    };
    const sourceFingerprint = vacationSourceFingerprint(fingerprintInput);
    const rawPdf = await buildVacationNoticePdf({
      documentId,
      companyLegalName: employer.legalName,
      companyCnpj: employer.cnpj,
      companyAddress: employer.address,
      employeeName,
      employeeEmail,
      acquisitionCycle: cycleId,
      startDate,
      endDate,
      returnDate: expectedReturnDate,
      days: Number(current.days),
      communicationDate: asOfDate,
      paymentDeadline: source.workflow.legalAnalysis.paymentDeadline ?? startDate,
    });
    const buffer = await applyCoalaLetterheadToPdf(rawPdf);
    const hashSha256 = createHash('sha256').update(buffer).digest('hex');
    const fileName = `aviso-de-ferias-${safeFilePart(employeeName)}.pdf`;
    const storagePath = `hr/vacations/${vacationId}/notice/${operationId}.pdf`;
    await getStorage(adminApp)
      .bucket(firebaseClientConfig.storageBucket)
      .file(storagePath)
      .save(buffer, {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: 'application/pdf',
          cacheControl: 'private, max-age=0, no-store',
          metadata: { vacationId, operationId, documentId, hashSha256, sourceFingerprint },
        },
      });

    const generatedAt = new Date().toISOString();
    const generatedEventRef = dbAdmin.collection('dp_vacationEvents').doc();
    let generatedWorkflow: DPVacationWorkflow | null = null;
    await dbAdmin.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(vacationRef);
      if (!snapshot.exists) throw notFound();
      const stored = snapshot.data() ?? {};
      await assertTargetAccess(transaction, context, String(stored.userId ?? ''));
      const workflow = workflowForStoredVacation(stored, generatedAt, asOfDate);
      if (workflow.notice.generationOperationId !== operationId || workflow.notice.status !== 'generating') {
        throw conflict('DP_VACATION_NOTICE_GENERATION_SUPERSEDED', 'A geração do aviso foi substituída por uma operação mais recente.');
      }
      generatedWorkflow = {
        ...workflow,
        notice: {
          status: 'draft',
          documentId,
          templateVersion: '1.0',
          fileName,
          storagePath,
          hashSha256,
          sourceFingerprint,
          generationOperationId: operationId,
          generationRequestedAt: workflow.notice.generationRequestedAt ?? now,
          generatedAt,
          generatedBy: context.decoded.uid,
          generationErrorCode: null,
        },
        updatedAt: generatedAt,
      };
      transaction.update(vacationRef, {
        workflow: generatedWorkflow,
        updatedAt: new Date(generatedAt),
        updatedBy: context.decoded.uid,
      });
      transaction.create(generatedEventRef, vacationEvent(
        context,
        vacationId,
        'VACATION_NOTICE_GENERATED',
        'Aviso de férias gerado e aguardando validação do RH.',
        generatedAt,
        { documentId, hashSha256, sourceFingerprint, templateVersion: '1.0' },
      ));
    });
    return { id: vacationId, workflow: generatedWorkflow };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const errorCode = error instanceof AppError ? error.code : 'DP_VACATION_NOTICE_GENERATION_FAILED';
    await dbAdmin.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(vacationRef);
      if (!snapshot.exists) return;
      const stored = snapshot.data() ?? {};
      const workflow = workflowForStoredVacation(stored, failedAt, asOfDate);
      if (workflow.notice.generationOperationId !== operationId || workflow.notice.status !== 'generating') return;
      transaction.update(vacationRef, {
        workflow: {
          ...workflow,
          notice: {
            ...workflow.notice,
            status: 'failed',
            generationErrorCode: errorCode,
          },
          updatedAt: failedAt,
        },
        updatedAt: new Date(failedAt),
        updatedBy: context.decoded.uid,
      });
      transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), vacationEvent(
        context,
        vacationId,
        'VACATION_NOTICE_GENERATION_FAILED',
        'A geração do aviso de férias falhou.',
        failedAt,
        { operationId, errorCode },
      ));
    }).catch(() => undefined);
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: 'DP_VACATION_NOTICE_GENERATION_FAILED',
      kind: 'UNEXPECTED_APPLICATION',
      safeMessage: 'Não foi possível gerar o aviso de férias.',
      cause: error,
      metadata: { vacationId, operationId },
    });
  }
}

export async function getVacationNoticeAsset(request: NextRequest, vacationId: string) {
  const context = await requireUser(request);
  if (!canManageVacation(context, 'view') && !canManageVacation(context, 'approve')) throw forbidden();
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  const asset = await dbAdmin.runTransaction(async (transaction): Promise<{
    storagePath: string;
    fileName: string;
    hashSha256: string;
  }> => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    await assertTargetAccess(transaction, context, String(current.userId ?? ''));
    const notice = (current.workflow as DPVacationWorkflow | undefined)?.notice;
    const useSigned = notice?.status === 'signed'
      && Boolean(notice.signedStoragePath)
      && Boolean(notice.signedHashSha256);
    const storagePath = useSigned ? notice?.signedStoragePath : notice?.storagePath;
    const hashSha256 = useSigned ? notice?.signedHashSha256 : notice?.hashSha256;
    if (!storagePath || !notice?.fileName || !hashSha256) {
      throw new AppError({
        code: 'DP_VACATION_NOTICE_NOT_FOUND',
        kind: 'NOT_FOUND',
        safeMessage: 'O aviso ainda não está disponível.',
        httpStatus: 404,
      });
    }
    return {
      storagePath,
      fileName: useSigned
        ? notice.fileName.replace(/\.pdf$/i, '-assinado.pdf')
        : notice.fileName,
      hashSha256,
    };
  });
  const [buffer] = await getStorage(adminApp)
    .bucket(firebaseClientConfig.storageBucket)
    .file(asset.storagePath)
    .download();
  const actualHash = createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== asset.hashSha256) {
    throw new AppError({
      code: 'DP_VACATION_NOTICE_INTEGRITY',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'O arquivo do aviso falhou na conferência de integridade.',
      metadata: { vacationId },
    });
  }
  return { buffer, fileName: asset.fileName, hashSha256: actualHash };
}

export async function validateVacationNotice(request: NextRequest, vacationId: string) {
  const context = await requireUser(request);
  if (!canManageVacation(context, 'approve')) throw forbidden();
  const asOfDate = belemDateOnly();
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);

  const draft = await dbAdmin.runTransaction(async (transaction): Promise<{
    storagePath: string;
    hashSha256: string;
    operationId: string;
  }> => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    await assertTargetAccess(transaction, context, String(current.userId ?? ''));
    const workflow = workflowForStoredVacation(current, new Date().toISOString(), asOfDate);
    if (workflow.notice.status !== 'draft'
      || !workflow.notice.storagePath
      || !workflow.notice.hashSha256
      || !workflow.notice.generationOperationId) {
      throw conflict('DP_VACATION_NOTICE_NOT_DRAFT', 'Gere e abra o aviso antes de validá-lo.');
    }
    return {
      storagePath: workflow.notice.storagePath,
      hashSha256: workflow.notice.hashSha256,
      operationId: workflow.notice.generationOperationId,
    };
  });

  const [buffer] = await getStorage(adminApp)
    .bucket(firebaseClientConfig.storageBucket)
    .file(draft.storagePath)
    .download();
  const actualHash = createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== draft.hashSha256) {
    throw new AppError({
      code: 'DP_VACATION_NOTICE_INTEGRITY',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'O arquivo do aviso falhou na conferência de integridade.',
      metadata: { vacationId },
    });
  }

  const validatedAt = new Date().toISOString();
  const eventRef = dbAdmin.collection('dp_vacationEvents').doc();
  let validatedWorkflow: DPVacationWorkflow | null = null;
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    await assertTargetAccess(transaction, context, String(current.userId ?? ''));
    const workflow = workflowForStoredVacation(current, validatedAt, asOfDate);
    if (workflow.notice.status !== 'draft'
      || workflow.notice.generationOperationId !== draft!.operationId
      || workflow.notice.hashSha256 !== actualHash) {
      throw conflict('DP_VACATION_NOTICE_CHANGED', 'O aviso foi alterado durante a conferência. Abra-o novamente.');
    }
    validatedWorkflow = {
      ...workflow,
      notice: {
        ...workflow.notice,
        status: 'validated',
        validatedAt,
        validatedBy: context.decoded.uid,
      },
      updatedAt: validatedAt,
    };
    transaction.update(vacationRef, {
      workflow: validatedWorkflow,
      updatedAt: new Date(validatedAt),
      updatedBy: context.decoded.uid,
    });
    transaction.create(eventRef, vacationEvent(
      context,
      vacationId,
      'VACATION_NOTICE_VALIDATED',
      'Aviso de férias validado pelo RH e liberado para envio.',
      validatedAt,
      { documentId: workflow.notice.documentId, hashSha256: actualHash },
    ));
  });
  return { id: vacationId, workflow: validatedWorkflow };
}

export async function sendVacationNotice(request: NextRequest, vacationId: string) {
  const context = await requireUser(request);
  if (!canManageVacation(context, 'approve')) throw forbidden();
  const asOfDate = belemDateOnly();
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  const prepared = await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    const user = await assertTargetAccess(transaction, context, String(current.userId ?? ''));
    const workflow = workflowForStoredVacation(current, new Date().toISOString(), asOfDate);
    if (workflow.notice.status !== 'validated'
      || !workflow.notice.storagePath
      || !workflow.notice.fileName
      || !workflow.notice.hashSha256
      || !workflow.notice.documentId) {
      throw conflict('DP_VACATION_NOTICE_NOT_VALIDATED', 'Valide o aviso antes de enviá-lo.');
    }
    return { current, user, workflow };
  });

  const employer = await resolveVacationEmployer(prepared.user);
  const companySignatory = await resolveCompanyDocumentSignatory({
    entityId: employer.entityId,
    cnpj: employer.cnpj,
  });
  if (!companySignatory) {
    throw conflict(
      'DP_VACATION_COMPANY_SIGNATORY_REQUIRED',
      `Defina o signatário documental da empresa ${employer.legalName} antes do envio.`,
    );
  }
  const employeeEmail = requiredText(
    prepared.user.email,
    'DP_VACATION_EMPLOYEE_EMAIL_REQUIRED',
    'Informe o e-mail da colaboradora antes do envio.',
  ).toLowerCase();
  if (employeeEmail === companySignatory.email.toLowerCase()) {
    throw conflict(
      'DP_VACATION_SIGNERS_MUST_DIFFER',
      'O signatário da empresa precisa ser diferente da colaboradora.',
    );
  }
  const employeeName = requiredText(
    prepared.user.username,
    'DP_VACATION_EMPLOYEE_NAME_REQUIRED',
    'Informe o nome da colaboradora antes do envio.',
  );
  const [buffer] = await getStorage(adminApp)
    .bucket(firebaseClientConfig.storageBucket)
    .file(prepared.workflow.notice.storagePath!)
    .download();
  const actualHash = createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== prepared.workflow.notice.hashSha256) {
    throw new AppError({
      code: 'DP_VACATION_NOTICE_INTEGRITY',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'O arquivo do aviso falhou na conferência de integridade.',
      metadata: { vacationId },
    });
  }

  const signers: VacationNoticeSigner[] = [
    {
      party: 'company',
      name: companySignatory.name,
      email: companySignatory.email.toLowerCase(),
      avatarUrl: companySignatory.avatarUrl,
    },
    {
      party: 'employee',
      name: employeeName,
      email: employeeEmail,
      avatarUrl: prepared.user.avatarUrl ?? null,
    },
  ];
  const requestedAt = new Date().toISOString();
  const signatureRequestRef = hrDbAdmin.collection('hrSignatureRequests').doc(
    `vacation_notice_${vacationId}_${prepared.workflow.notice.documentId}`,
  );
  const eventRef = dbAdmin.collection('dp_vacationEvents').doc();
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    await assertTargetAccess(transaction, context, String(current.userId ?? ''));
    const workflow = workflowForStoredVacation(current, requestedAt, asOfDate);
    if (workflow.notice.status !== 'validated'
      || workflow.notice.documentId !== prepared.workflow.notice.documentId
      || workflow.notice.hashSha256 !== actualHash) {
      throw conflict('DP_VACATION_NOTICE_CHANGED', 'O aviso mudou antes do envio. Abra-o novamente.');
    }
    transaction.update(vacationRef, {
      workflow: {
        ...workflow,
        notice: {
          ...workflow.notice,
          status: 'sending',
          signatureRequestId: signatureRequestRef.id,
          sendErrorCode: null,
        },
        updatedAt: requestedAt,
      },
      updatedAt: new Date(requestedAt),
      updatedBy: context.decoded.uid,
    });
    transaction.create(eventRef, vacationEvent(
      context,
      vacationId,
      'VACATION_NOTICE_SEND_REQUESTED',
      'Envio do aviso de férias solicitado.',
      requestedAt,
      { signatureRequestId: signatureRequestRef.id, documentId: workflow.notice.documentId },
    ));
  });
  await signatureRequestRef.set({
    type: 'vacation_notice_signature',
    purpose: 'vacation_notice',
    status: 'sending',
    provider: 'autentique',
    vacationId,
    employeeId: prepared.user.id,
    documentId: prepared.workflow.notice.documentId,
    documentStoragePath: prepared.workflow.notice.storagePath,
    documentHash: actualHash,
    documentName: `Coala Shakes - RH | Férias - ${employeeName}`,
    signers,
    requestedAt,
    requestedBy: context.decoded.uid,
    requestedByName: actorName(context),
    updatedAt: requestedAt,
  });

  let createdProviderDocumentId: string | null = null;
  try {
    const created = await createAutentiqueDocument({
      buffer,
      fileName: prepared.workflow.notice.fileName!,
      documentName: `Coala Shakes - RH | Férias - ${employeeName}`,
      message: 'Confira o período informado e assine eletronicamente o aviso de férias.',
      signers: [
        {
          email: signers[0].email,
          name: signers[0].name,
          action: 'SIGN',
          positions: [{ x: '16.0', y: '56.0', z: 1, element: 'SIGNATURE' }],
        },
        {
          email: signers[1].email,
          name: signers[1].name,
          action: 'SIGN',
          positions: [{ x: '62.0', y: '56.0', z: 1, element: 'SIGNATURE' }],
        },
      ],
    });
    createdProviderDocumentId = created.document.id;
    const sentAt = new Date().toISOString();
    const participants = participantsFromProvider({
      signatures: created.document.signatures,
      signers,
      invitedAt: sentAt,
    });
    await signatureRequestRef.set({
      status: 'sent',
      sandbox: created.sandbox,
      providerDocumentId: created.document.id,
      providerCreatedAt: created.document.created_at,
      providerSignatures: created.document.signatures,
      participants: participantMap(participants),
      sentAt,
      updatedAt: sentAt,
    }, { merge: true });
    let sentWorkflow: DPVacationWorkflow | null = null;
    await dbAdmin.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(vacationRef);
      if (!snapshot.exists) throw notFound();
      const current = snapshot.data() ?? {};
      const workflow = workflowForStoredVacation(current, sentAt, asOfDate);
      if (workflow.notice.signatureRequestId !== signatureRequestRef.id
        || !['sending', 'sent'].includes(workflow.notice.status)) {
        throw conflict('DP_VACATION_NOTICE_SEND_SUPERSEDED', 'O envio foi substituído por outra operação.');
      }
      sentWorkflow = {
        ...workflow,
        notice: {
          ...workflow.notice,
          status: 'sent',
          providerDocumentId: created.document.id,
          participants,
          sentAt,
          sentBy: context.decoded.uid,
          sendErrorCode: null,
        },
        updatedAt: sentAt,
      };
      transaction.update(vacationRef, {
        workflow: sentWorkflow,
        updatedAt: new Date(sentAt),
        updatedBy: context.decoded.uid,
      });
      transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), vacationEvent(
        context,
        vacationId,
        'VACATION_NOTICE_SENT',
        'Aviso de férias enviado para assinatura da empresa e da colaboradora.',
        sentAt,
        { signatureRequestId: signatureRequestRef.id, providerDocumentId: created.document.id },
      ));
    });
    return { id: vacationId, workflow: sentWorkflow };
  } catch (error) {
    if (createdProviderDocumentId) {
      await syncVacationNoticeSignatureRequest({
        vacationId,
        signatureRequestId: signatureRequestRef.id,
      }).catch(() => undefined);
      return { id: vacationId, recoveredFromProjectionFailure: true };
    }
    const failedAt = new Date().toISOString();
    const errorCode = error instanceof AppError ? error.code : 'DP_VACATION_NOTICE_SEND_FAILED';
    await Promise.all([
      signatureRequestRef.set({
        status: 'failed',
        errorCode,
        updatedAt: failedAt,
      }, { merge: true }).catch(() => undefined),
      dbAdmin.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(vacationRef);
        if (!snapshot.exists) return;
        const current = snapshot.data() ?? {};
        const workflow = workflowForStoredVacation(current, failedAt, asOfDate);
        if (workflow.notice.signatureRequestId !== signatureRequestRef.id
          || workflow.notice.status !== 'sending') return;
        transaction.update(vacationRef, {
          workflow: {
            ...workflow,
            notice: {
              ...workflow.notice,
              status: 'validated',
              sendErrorCode: errorCode,
            },
            updatedAt: failedAt,
          },
          updatedAt: new Date(failedAt),
          updatedBy: context.decoded.uid,
        });
        transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), vacationEvent(
          context,
          vacationId,
          'VACATION_NOTICE_SEND_FAILED',
          'O envio do aviso de férias falhou.',
          failedAt,
          { signatureRequestId: signatureRequestRef.id, errorCode },
        ));
      }).catch(() => undefined),
    ]);
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: 'DP_VACATION_NOTICE_SEND_FAILED',
      kind: 'TRANSIENT_EXTERNAL',
      safeMessage: 'Não foi possível enviar o aviso para assinatura.',
      cause: error,
      metadata: { vacationId, signatureRequestId: signatureRequestRef.id },
    });
  }
}

export async function syncVacationNoticeSignatureRequest(params: {
  vacationId: string;
  signatureRequestId: string;
}) {
  const requestRef = hrDbAdmin.collection('hrSignatureRequests').doc(params.signatureRequestId);
  const request = await requestRef.get();
  if (!request.exists
    || request.get('vacationId') !== params.vacationId
    || request.get('purpose') !== 'vacation_notice') return null;
  const participants = participantsFromRequest(request.get('participants'));
  const providerStatus = String(request.get('status') ?? 'sent');
  const providerDocumentId = typeof request.get('providerDocumentId') === 'string'
    ? String(request.get('providerDocumentId'))
    : null;
  const signedUrl = typeof request.get('signedFileUrl') === 'string'
    ? String(request.get('signedFileUrl'))
    : '';
  const vacationRef = dbAdmin.collection('dp_vacations').doc(params.vacationId);

  if (providerStatus === 'signed' && signedUrl) {
    const buffer = await downloadVacationAutentiqueSignedPdf(signedUrl);
    const signedHashSha256 = createHash('sha256').update(buffer).digest('hex');
    const signedStoragePath = `hr/vacations/${params.vacationId}/notice/signed/${params.signatureRequestId}.pdf`;
    await getStorage(adminApp)
      .bucket(firebaseClientConfig.storageBucket)
      .file(signedStoragePath)
      .save(buffer, {
        resumable: false,
        metadata: {
          contentType: 'application/pdf',
          cacheControl: 'private, max-age=0, no-store',
          metadata: {
            vacationId: params.vacationId,
            signatureRequestId: params.signatureRequestId,
            signedHashSha256,
          },
        },
      });
    const signedAt = typeof request.get('signedAt') === 'string'
      ? String(request.get('signedAt'))
      : new Date().toISOString();
    let changed = false;
    await dbAdmin.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(vacationRef);
      if (!snapshot.exists) throw notFound();
      const current = snapshot.data() ?? {};
      const workflow = workflowForStoredVacation(current, signedAt, belemDateOnly());
      if (workflow.notice.signatureRequestId !== params.signatureRequestId) return;
      if (workflow.notice.status === 'signed' && workflow.notice.signedHashSha256 === signedHashSha256) return;
      const nextWorkflow: DPVacationWorkflow = {
        ...workflow,
        currentStage: 'accountant',
        steps: workflow.steps.map((step) => {
          if (step.id === 'notice') {
            return { ...step, status: 'completed', completedAt: signedAt, completedBy: 'system:autentique' };
          }
          if (step.id === 'accountant') {
            return { ...step, status: 'in_progress', startedAt: step.startedAt ?? signedAt };
          }
          return step;
        }),
        notice: {
          ...workflow.notice,
          status: 'signed',
          providerDocumentId,
          participants,
          signedAt,
          signedStoragePath,
          signedHashSha256,
        },
        accountant: {
          ...workflow.accountant,
          status: workflow.accountant.status === 'not_started' ? 'ready_to_send' : workflow.accountant.status,
        },
        updatedAt: signedAt,
      };
      transaction.update(vacationRef, {
        workflow: nextWorkflow,
        updatedAt: new Date(signedAt),
        updatedBy: 'system:autentique',
      });
      transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
        vacationId: params.vacationId,
        type: 'VACATION_NOTICE_SIGNED',
        message: 'Aviso de férias assinado e arquivado.',
        at: signedAt,
        actorId: 'system:autentique',
        actorEmail: null,
        actorName: 'Autentique',
        data: { signatureRequestId: params.signatureRequestId, signedHashSha256 },
      });
      changed = true;
    });
    await requestRef.set({
      archiveStatus: 'completed',
      signedStoragePath,
      signedHashSha256,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    const accountantDispatch = await attemptVacationAccountantDispatch(params.vacationId);
    return { changed, signed: true, accountantDispatch };
  }

  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    const workflow = workflowForStoredVacation(current, new Date().toISOString(), belemDateOnly());
    if (workflow.notice.signatureRequestId !== params.signatureRequestId) return;
    transaction.update(vacationRef, {
      workflow: {
        ...workflow,
        notice: {
          ...workflow.notice,
          status: workflow.notice.status === 'sending' ? 'sent' : workflow.notice.status,
          providerDocumentId: workflow.notice.providerDocumentId ?? providerDocumentId,
          participants,
        },
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
      updatedBy: 'system:autentique',
    });
  });
  return { changed: true, signed: false };
}

export async function syncVacationNotice(request: NextRequest, vacationId: string) {
  const context = await requireUser(request);
  if (!canManageVacation(context, 'view') && !canManageVacation(context, 'approve')) throw forbidden();
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  const signature = await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    await assertTargetAccess(transaction, context, String(current.userId ?? ''));
    const notice = (current.workflow as DPVacationWorkflow | undefined)?.notice;
    if (!notice?.signatureRequestId || !notice.providerDocumentId) {
      throw conflict('DP_VACATION_NOTICE_NOT_SENT', 'O aviso ainda não foi enviado para assinatura.');
    }
    return {
      signatureRequestId: notice.signatureRequestId,
      providerDocumentId: notice.providerDocumentId,
      signers: notice.participants?.map((participant) => ({
        party: participant.party,
        name: participant.name,
        email: participant.email,
        avatarUrl: participant.avatarUrl,
      })) ?? [],
      invitedAt: notice.sentAt ?? new Date().toISOString(),
    };
  });
  const provider = await getAutentiqueDocumentSignatures(signature.providerDocumentId);
  const participants = participantsFromProvider({
    signatures: provider.signatures,
    signers: signature.signers,
    invitedAt: signature.invitedAt,
  });
  const now = new Date().toISOString();
  await hrDbAdmin.collection('hrSignatureRequests').doc(signature.signatureRequestId).set({
    status: provider.completed ? 'signed' : 'sent',
    participants: participantMap(participants),
    ...(provider.signedUrl ? { signedFileUrl: provider.signedUrl } : {}),
    ...(provider.completed ? { signedAt: now } : {}),
    updatedAt: now,
  }, { merge: true });
  await syncVacationNoticeSignatureRequest({
    vacationId,
    signatureRequestId: signature.signatureRequestId,
  });
  return { id: vacationId, synchronizedAt: now, completed: provider.completed };
}

export async function sendVacationToAccountant(request: NextRequest, vacationId: string) {
  const context = await requireUser(request);
  if (!canManageVacation(context, 'approve')) throw forbidden();
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    await assertTargetAccess(transaction, context, String(snapshot.get('userId') ?? ''));
  });
  return { id: vacationId, ...(await ensureVacationAccountantRequestSent(vacationId)) };
}

async function requireVacationApprovalAccess(request: NextRequest, vacationId: string) {
  const context = await requireUser(request);
  if (!canManageVacation(context, 'approve')) throw forbidden();
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  const result = await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    const user = await assertTargetAccess(transaction, context, String(current.userId ?? ''));
    return { current, user };
  });
  return { context, vacationRef, ...result };
}

function vacationPaymentStatus(status: string): DPVacationWorkflow['payment']['status'] {
  if (status === 'awaiting_financial_authorization') return 'awaiting_financial_authorization';
  if (status === 'ready_to_submit') return 'ready_to_submit';
  if (status === 'awaiting_bank_approval') return 'awaiting_bank_approval';
  if (status === 'scheduled') return 'scheduled';
  if (status === 'paid') return 'paid';
  if (['failed', 'rejected', 'approval_expired'].includes(status)) return 'failed';
  return 'processing';
}

function dateTimestamp(value: string) {
  return Timestamp.fromDate(new Date(`${value}T12:00:00-03:00`));
}

async function prepareVacationPaymentControl(
  vacationId: string,
  context: ServerUserContext,
) {
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  const now = new Date().toISOString();
  const prepared = await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    const user = await assertTargetAccess(transaction, context, String(current.userId ?? ''));
    const workflow = current.workflow as DPVacationWorkflow | undefined;
    if (!workflow || workflow.receipt.status !== 'approved' || !workflow.receipt.reviewedValues) {
      throw conflict('DP_VACATION_RECEIPT_NOT_APPROVED', 'Aprove o recibo e os valores antes de preparar o pagamento.');
    }
    if (workflow.payment.paymentRequestId) {
      return { current, user, workflow, idempotent: true };
    }
    if (workflow.payment.status === 'preparing') {
      throw conflict('DP_VACATION_PAYMENT_PREPARING', 'A preparação do pagamento já está em andamento.');
    }
    const nextWorkflow: DPVacationWorkflow = {
      ...workflow,
      currentStage: 'payment',
      steps: workflow.steps.map((step) => {
        if (step.id === 'receipt_review') {
          return { ...step, status: 'completed', completedAt: workflow.receipt.approvedAt ?? now, completedBy: workflow.receipt.approvedBy ?? context.decoded.uid };
        }
        if (step.id === 'payment') return { ...step, status: 'in_progress', startedAt: step.startedAt ?? now };
        return step;
      }),
      payment: { ...workflow.payment, status: 'preparing', amount: workflow.receipt.reviewedValues.netAmount, lastError: null },
      updatedAt: now,
    };
    transaction.update(vacationRef, {
      workflow: nextWorkflow,
      updatedAt: new Date(now),
      updatedBy: context.decoded.uid,
    });
    transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), vacationEvent(
      context,
      vacationId,
      'VACATION_PAYMENT_PREPARATION_STARTED',
      'Criação da despesa e da solicitação de pagamento iniciada.',
      now,
      { amount: workflow.receipt.reviewedValues.netAmount },
    ));
    return { current, user, workflow: nextWorkflow, idempotent: false };
  });

  if (prepared.idempotent && prepared.workflow.payment.paymentRequestId) {
    return getPaymentRequest(prepared.workflow.payment.paymentRequestId);
  }

  try {
    const amount = Number(prepared.workflow.receipt.reviewedValues?.netAmount ?? 0);
    const dueAt = requiredText(
      prepared.workflow.payment.dueAt,
      'DP_VACATION_PAYMENT_DUE_REQUIRED',
      'O prazo legal do pagamento não foi calculado.',
    );
    const scheduledFor = dueAt < belemDateOnly() ? belemDateOnly() : dueAt;
    const employer = await resolveVacationEmployer(prepared.user);
    const employeeName = requiredText(prepared.user.username, 'DP_VACATION_EMPLOYEE_NAME_REQUIRED', 'Informe o nome da colaboradora.');
    const employeeId = getHrEmployeeId(prepared.user);
    if (!employeeId) {
      throw conflict('DP_VACATION_HR_EMPLOYEE_REQUIRED', 'Vincule a colaboradora ao cadastro do RH antes de preparar o pagamento.');
    }
    const financialUnit = prepared.user.unitId
      ? await dbAdmin.collection('dp_units').doc(prepared.user.unitId).get()
      : null;
    const resultCenter = String(financialUnit?.get('name') ?? '').trim() || null;
    const expenseId = `vacation_${vacationId}`;
    const expenseRef = financialDbAdmin.collection('expenses').doc(expenseId);
    await financialDbAdmin.runTransaction(async (transaction) => {
      const existing = await transaction.get(expenseRef);
      if (existing.exists) {
        if (existing.get('sourceType') !== 'vacation'
          || existing.get('sourceId') !== vacationId
          || Math.abs(Number(existing.get('totalValue') ?? 0) - amount) > 0.01) {
          throw conflict('DP_VACATION_EXPENSE_CONFLICT', 'A despesa existente diverge do recibo aprovado.');
        }
        return;
      }
      const dueDate = dateTimestamp(dueAt);
      const competenceDate = dateTimestamp(String(prepared.current.startDate ?? dueAt));
      transaction.create(expenseRef, {
        workspaceId: context.workspace_id,
        sourceType: 'vacation',
        sourceId: vacationId,
        originModule: 'hr_vacation',
        originStatus: 'approved',
        description: `Férias — ${employeeName}`,
        supplier: employeeName,
        employeeId,
        employeeName,
        accountPlan: null,
        accountId: null,
        accountPlanName: 'Férias',
        resultCenter,
        totalValue: amount,
        competenceDate,
        dueDate,
        paymentMethod: 'single',
        plannedPaymentMethodType: 'pix',
        installments: [{ number: 1, dueDate, value: amount, status: 'pending' }],
        status: 'pending',
        createdAt: Timestamp.now(),
        createdBy: context.decoded.uid,
        updatedAt: Timestamp.now(),
        updatedBy: context.decoded.uid,
      });
    });

    const payment = await createPaymentRequest({
      sourceType: 'vacation',
      sourceId: vacationId,
      expenseId,
      beneficiaryReference: { sourceType: 'employee', sourceId: employeeId },
      legalEntitySnapshot: {
        entityId: employer.entityId,
        legalName: employer.legalName,
        cnpj: employer.cnpj,
      },
      amount,
      description: `Férias — ${employeeName}`,
      scheduledFor,
    }, {
      uid: context.decoded.uid,
      email: context.decoded.email,
      name: actorName(context),
    });
    const paymentStatus = vacationPaymentStatus(payment.status);
    const completedAt = new Date().toISOString();
    await dbAdmin.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(vacationRef);
      if (!snapshot.exists) throw notFound();
      const workflow = snapshot.get('workflow') as DPVacationWorkflow;
      transaction.update(vacationRef, {
        workflow: {
          ...workflow,
          currentStage: 'payment',
          steps: workflow.steps.map((step) => step.id === 'payment'
            ? { ...step, status: 'waiting_external', dueAt, note: 'Aguardando autorização do Financeiro.' }
            : step),
          payment: {
            ...workflow.payment,
            status: paymentStatus,
            dueAt,
            scheduledFor,
            amount: payment.amount,
            expenseId,
            paymentRequestId: payment.id,
            lastError: null,
          },
          updatedAt: completedAt,
        },
        updatedAt: new Date(completedAt),
        updatedBy: context.decoded.uid,
      });
      transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), vacationEvent(
        context,
        vacationId,
        'VACATION_PAYMENT_PREPARED',
        'Despesa criada e pagamento encaminhado para autorização do Financeiro.',
        completedAt,
        { paymentRequestId: payment.id, expenseId, amount: payment.amount, dueAt, scheduledFor },
      ));
    });
    await hrDbAdmin.collection('hrNotifications').doc(`vacation_payment_${vacationId}`).set({
      type: 'vacation_payment_authorization',
      status: 'pending',
      vacationId,
      employeeId,
      title: `Pagamento de férias — ${employeeName}`,
      message: `Autorize o pagamento de ${payment.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, programado para ${scheduledFor}.`,
      channels: ['in_app'],
      recipient: { strategy: 'financial_pool' },
      paymentRequestId: payment.id,
      createdAt: completedAt,
      updatedAt: completedAt,
    }, { merge: true });
    return payment;
  } catch (error) {
    const failedAt = new Date().toISOString();
    const safeMessage = error instanceof AppError
      ? error.safeMessage
      : 'Não foi possível preparar o pagamento. Confira o vínculo, o CPF e a chave Pix da colaboradora.';
    const reference = reportSystemError({
      error,
      source: 'server_action',
      operation: 'prepare-vacation-payment',
      routeOrJob: '/api/dp/vacations/[vacationId]',
      metadata: { vacationId },
    });
    await dbAdmin.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(vacationRef);
      if (!snapshot.exists) return;
      const workflow = snapshot.get('workflow') as DPVacationWorkflow;
      if (workflow.payment.paymentRequestId) return;
      transaction.update(vacationRef, {
        workflow: {
          ...workflow,
          payment: { ...workflow.payment, status: 'failed', lastError: safeMessage },
          steps: workflow.steps.map((step) => step.id === 'payment'
            ? { ...step, status: 'blocked', note: safeMessage }
            : step),
          updatedAt: failedAt,
        },
        updatedAt: new Date(failedAt),
        updatedBy: context.decoded.uid,
      });
      transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), vacationEvent(
        context,
        vacationId,
        'VACATION_PAYMENT_PREPARATION_FAILED',
        safeMessage,
        failedAt,
        { eventId: reference.eventId },
      ));
    });
    return null;
  }
}

export async function reviewVacationReceipt(
  request: NextRequest,
  vacationId: string,
  input: ReviewVacationReceiptInput,
) {
  const { context, vacationRef } = await requireVacationApprovalAccess(request, vacationId);
  const now = new Date().toISOString();
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    await assertTargetAccess(transaction, context, String(current.userId ?? ''));
    const workflow = current.workflow as DPVacationWorkflow | undefined;
    if (!workflow || workflow.receipt.status !== 'review_pending' || !workflow.receipt.originalDocumentId) {
      throw conflict('DP_VACATION_RECEIPT_NOT_READY', 'O recibo ainda não está disponível para auditoria.');
    }
    if (input.decision === 'correction_required') {
      const reason = requiredText(input.reason, 'DP_VACATION_RECEIPT_CORRECTION_REASON', 'Informe o que precisa ser corrigido.');
      const nextWorkflow: DPVacationWorkflow = {
        ...workflow,
        currentStage: 'accountant',
        steps: workflow.steps.map((step) => {
          if (step.id === 'accountant') return { ...step, status: 'waiting_external', completedAt: null, completedBy: null, note: 'Correção solicitada ao contador.' };
          if (step.id === 'receipt_review') return { ...step, status: 'blocked', note: reason };
          return step;
        }),
        accountant: { ...workflow.accountant, status: 'correction_requested', lastError: null },
        receipt: { ...workflow.receipt, status: 'correction_requested', correctionReason: reason, reviewNotes: input.notes ?? null },
        updatedAt: now,
      };
      transaction.update(vacationRef, { workflow: nextWorkflow, updatedAt: new Date(now), updatedBy: context.decoded.uid });
      transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), vacationEvent(
        context,
        vacationId,
        'VACATION_RECEIPT_CORRECTION_REQUESTED',
        'O RH solicitou correção do recibo à contabilidade.',
        now,
        { reason },
      ));
      return;
    }
    const values = input.values!;
    const nextWorkflow: DPVacationWorkflow = {
      ...workflow,
      currentStage: 'payment',
      steps: workflow.steps.map((step) => {
        if (step.id === 'receipt_review') return { ...step, status: 'completed', completedAt: now, completedBy: context.decoded.uid };
        if (step.id === 'payment') return { ...step, status: 'in_progress', startedAt: step.startedAt ?? now };
        return step;
      }),
      accountant: { ...workflow.accountant, status: 'completed' },
      receipt: {
        ...workflow.receipt,
        status: 'approved',
        reviewedValues: {
          grossAmount: Number(values.grossAmount.toFixed(2)),
          discountAmount: Number(values.discountAmount.toFixed(2)),
          netAmount: Number(values.netAmount.toFixed(2)),
          paymentDate: values.paymentDate ?? null,
        },
        reviewNotes: input.notes ?? null,
        correctionReason: null,
        approvedAt: now,
        approvedBy: context.decoded.uid,
      },
      payment: { ...workflow.payment, amount: Number(values.netAmount.toFixed(2)), lastError: null },
      updatedAt: now,
    };
    transaction.update(vacationRef, { workflow: nextWorkflow, updatedAt: new Date(now), updatedBy: context.decoded.uid });
    transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), vacationEvent(
      context,
      vacationId,
      'VACATION_RECEIPT_APPROVED',
      'O recibo original e os valores processados foram aprovados pelo RH.',
      now,
      { reviewedValues: nextWorkflow.receipt.reviewedValues },
    ));
  });
  if (input.decision === 'correction_required') {
    return { id: vacationId, accountantDispatch: await attemptVacationAccountantDispatch(vacationId) };
  }
  const payment = await prepareVacationPaymentControl(vacationId, context);
  return { id: vacationId, paymentPrepared: Boolean(payment), paymentRequestId: payment?.id ?? null };
}

export async function prepareVacationPayment(request: NextRequest, vacationId: string) {
  const { context } = await requireVacationApprovalAccess(request, vacationId);
  const payment = await prepareVacationPaymentControl(vacationId, context);
  return { id: vacationId, paymentPrepared: Boolean(payment), paymentRequestId: payment?.id ?? null };
}

export async function syncVacationPayment(request: NextRequest, vacationId: string) {
  const { context, vacationRef } = await requireVacationApprovalAccess(request, vacationId);
  const snapshot = await vacationRef.get();
  const workflow = snapshot.get('workflow') as DPVacationWorkflow | undefined;
  const paymentRequestId = workflow?.payment.paymentRequestId;
  if (!paymentRequestId) throw conflict('DP_VACATION_PAYMENT_NOT_PREPARED', 'O pagamento ainda não foi preparado.');
  let payment = await getPaymentRequest(paymentRequestId);
  if (['awaiting_bank_approval', 'scheduled', 'processing', 'failed', 'rejected', 'approval_expired', 'paid'].includes(payment.status)) {
    payment = await refreshPaymentRequest(payment.id, {
      uid: context.decoded.uid,
      email: context.decoded.email,
      name: actorName(context),
    });
  }
  const syncedAt = new Date().toISOString();
  await dbAdmin.runTransaction(async (transaction) => {
    const fresh = await transaction.get(vacationRef);
    if (!fresh.exists) throw notFound();
    const currentWorkflow = fresh.get('workflow') as DPVacationWorkflow;
    if (currentWorkflow.payment.paymentRequestId !== payment.id) return;
    const status = vacationPaymentStatus(payment.status);
    transaction.update(vacationRef, {
      workflow: {
        ...currentWorkflow,
        payment: {
          ...currentWorkflow.payment,
          status,
          scheduledFor: payment.scheduledFor ?? currentWorkflow.payment.scheduledFor ?? null,
          paidAt: payment.paidAt ?? currentWorkflow.payment.paidAt ?? null,
          proofStoragePath: payment.proofStoragePath ?? currentWorkflow.payment.proofStoragePath ?? null,
          lastError: payment.lastError?.safeMessage ?? currentWorkflow.payment.lastError ?? null,
        },
        updatedAt: syncedAt,
      },
      updatedAt: new Date(syncedAt),
      updatedBy: context.decoded.uid,
    });
  });
  return { id: vacationId, paymentStatus: payment.status };
}

export async function retryVacationReceiptSignatureAction(request: NextRequest, vacationId: string) {
  await requireVacationApprovalAccess(request, vacationId);
  return { id: vacationId, ...(await retryVacationReceiptSignature(vacationId)) };
}

export async function syncVacationReceiptSignatureAction(request: NextRequest, vacationId: string) {
  const { vacationRef } = await requireVacationApprovalAccess(request, vacationId);
  const snapshot = await vacationRef.get();
  const workflow = snapshot.get('workflow') as DPVacationWorkflow | undefined;
  if (!workflow?.receiptSignature.signatureRequestId) {
    throw conflict('DP_VACATION_RECEIPT_SIGNATURE_NOT_SENT', 'O recibo ainda não foi enviado para assinatura.');
  }
  const result = await syncVacationReceiptSignatureRequest({
    vacationId,
    signatureRequestId: workflow.receiptSignature.signatureRequestId,
  });
  return { id: vacationId, result };
}

export async function finalizeVacationWorkflow(request: NextRequest, vacationId: string) {
  const { context, vacationRef } = await requireVacationApprovalAccess(request, vacationId);
  const now = new Date().toISOString();
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    await assertTargetAccess(transaction, context, String(current.userId ?? ''));
    const workflow = current.workflow as DPVacationWorkflow | undefined;
    if (!workflow || workflow.receiptSignature.status !== 'signed' || workflow.closure.status !== 'ready') {
      throw conflict('DP_VACATION_CLOSURE_NOT_READY', 'A assinatura do recibo precisa estar concluída antes da finalização.');
    }
    const nextWorkflow: DPVacationWorkflow = {
      ...workflow,
      status: 'completed',
      currentStage: 'closure',
      steps: workflow.steps.map((step) => step.id === 'closure'
        ? { ...step, status: 'completed', completedAt: now, completedBy: context.decoded.uid }
        : step),
      closure: { status: 'completed', completedAt: now, completedBy: context.decoded.uid },
      updatedAt: now,
    };
    transaction.update(vacationRef, { workflow: nextWorkflow, updatedAt: new Date(now), updatedBy: context.decoded.uid });
    transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), vacationEvent(
      context,
      vacationId,
      'VACATION_WORKFLOW_COMPLETED',
      'Trilha de férias finalizada pelo RH após a assinatura do recibo.',
      now,
    ));
  });
  return { id: vacationId, completed: true };
}

export async function getVacationWorkflowAsset(
  request: NextRequest,
  vacationId: string,
  kind: 'receipt-original' | 'receipt-signed',
) {
  const context = await requireUser(request);
  if (!canManageVacation(context, 'view') && !canManageVacation(context, 'approve')) throw forbidden();
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  const asset = await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    await assertTargetAccess(transaction, context, String(current.userId ?? ''));
    const workflow = current.workflow as DPVacationWorkflow | undefined;
    const storagePath = kind === 'receipt-original'
      ? workflow?.receipt.originalStoragePath
      : workflow?.receiptSignature.signedStoragePath;
    const hashSha256 = kind === 'receipt-original'
      ? workflow?.receipt.originalHashSha256
      : workflow?.receiptSignature.signedHashSha256;
    const fileName = kind === 'receipt-original'
      ? workflow?.receipt.originalFileName ?? `recibo-ferias-${vacationId}.pdf`
      : `recibo-ferias-assinado-${vacationId}.pdf`;
    if (!storagePath || !hashSha256) {
      throw new AppError({
        code: 'DP_VACATION_ASSET_NOT_FOUND',
        kind: 'NOT_FOUND',
        safeMessage: 'O documento ainda não está disponível.',
        httpStatus: 404,
      });
    }
    return { storagePath, hashSha256, fileName };
  });
  const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(asset.storagePath).download();
  const actualHash = createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== asset.hashSha256) {
    throw new AppError({
      code: 'DP_VACATION_ASSET_INTEGRITY',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'O documento falhou na conferência de integridade.',
      metadata: { vacationId, kind },
    });
  }
  return { buffer, fileName: asset.fileName, hashSha256: actualHash };
}

export async function updateVacation(
  request: NextRequest,
  vacationId: string,
  input: UpdateVacationInput,
) {
  const context = await requireUser(request);
  const needsApproval = input.action === 'approve' || input.action === 'reject';
  if (!canManageVacation(context, needsApproval ? 'approve' : 'request')) throw forbidden();
  const now = new Date().toISOString();
  const asOfDate = belemDateOnly();
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  const eventRef = dbAdmin.collection('dp_vacationEvents').doc();
  let updated: Record<string, unknown> = {};

  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    const userId = String(current.userId ?? '');
    await assertTargetAccess(transaction, context, userId);

    if (input.action === 'update_record') {
      const workflow = current.workflow as DPVacationWorkflow | undefined;
      if (workflow && !['not_generated', 'failed'].includes(workflow.notice.status)) {
        throw conflict(
          'DP_VACATION_NOTICE_ALREADY_STARTED',
          'O período não pode ser alterado depois que o aviso foi gerado.',
        );
      }
      const core = cleanedCore(input.vacation);
      const history = await relatedVacations(transaction, userId);
      validateAgainstHistory(history, core, { ignoreId: vacationId });
      const nextWorkflow = core.recordType === 'gozo'
        ? createInitialVacationWorkflow({
            status: current.status as DPVacationRecord['status'],
            startDate: core.startDate,
            endDate: core.endDate,
            now,
            asOfDate,
            actorId: context.decoded.uid,
          })
        : undefined;
      const warnings = nextWorkflow?.legalAnalysis.checks
        .filter((check) => check.status === 'warning')
        .map((check) => check.message) ?? [];
      updated = {
        ...core,
        warnings,
        workflow: nextWorkflow ?? null,
        updatedAt: new Date(now),
        updatedBy: context.decoded.uid,
      };
      transaction.update(vacationRef, updated);
      transaction.create(eventRef, vacationEvent(
        context,
        vacationId,
        'VACATION_UPDATED',
        'Dados do agendamento atualizados e reanalisados.',
        now,
      ));
      return;
    }

    if (input.action === 'approve') {
      if (current.recordType !== 'gozo') {
        updated = { status: 'APPROVED', updatedAt: new Date(now), updatedBy: context.decoded.uid };
      } else {
        const baseWorkflow = (current.workflow as DPVacationWorkflow | undefined)
          ?? createInitialVacationWorkflow({
            status: current.status as DPVacationRecord['status'],
            startDate: String(current.startDate ?? ''),
            endDate: String(current.endDate ?? ''),
            now,
            asOfDate,
          });
        if (baseWorkflow.legalAnalysis.checks.some((check) => check.blocking)) {
          throw conflict('DP_VACATION_LEGAL_BLOCK', 'Corrija os impedimentos antes de aprovar o agendamento.');
        }
        updated = {
          status: 'APPROVED',
          workflow: advanceVacationWorkflowToNotice(baseWorkflow, {
            now,
            actorId: context.decoded.uid,
          }),
          updatedAt: new Date(now),
          updatedBy: context.decoded.uid,
        };
      }
      transaction.update(vacationRef, updated);
      transaction.create(eventRef, vacationEvent(
        context,
        vacationId,
        'VACATION_APPROVED',
        'Agendamento aprovado. A geração do aviso é a próxima ação.',
        now,
      ));
      return;
    }

    const baseWorkflow = current.recordType === 'gozo'
      ? (current.workflow as DPVacationWorkflow | undefined)
        ?? createInitialVacationWorkflow({
          status: current.status as DPVacationRecord['status'],
          startDate: String(current.startDate ?? ''),
          endDate: String(current.endDate ?? ''),
          now,
          asOfDate,
        })
      : null;
    updated = {
      status: 'REJECTED',
      ...(baseWorkflow ? { workflow: cancelVacationWorkflow(baseWorkflow, now) } : {}),
      updatedAt: new Date(now),
      updatedBy: context.decoded.uid,
    };
    transaction.update(vacationRef, updated);
    transaction.create(eventRef, vacationEvent(
      context,
      vacationId,
      'VACATION_REJECTED',
      'Agendamento rejeitado pelo RH.',
      now,
    ));
  });

  return { id: vacationId, ...serialize(updated) as Record<string, unknown> };
}

export async function deleteVacation(request: NextRequest, vacationId: string) {
  const context = await requireUser(request);
  if (!canManageVacation(context, 'approve')) throw forbidden();
  const now = new Date().toISOString();
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  const eventRef = dbAdmin.collection('dp_vacationEvents').doc();

  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(vacationRef);
    if (!snapshot.exists) throw notFound();
    const current = snapshot.data() ?? {};
    await assertTargetAccess(transaction, context, String(current.userId ?? ''));
    const workflow = current.workflow as DPVacationWorkflow | undefined;
    if (workflow && !['not_generated', 'failed'].includes(workflow.notice.status)) {
      throw conflict(
        'DP_VACATION_DELETE_AFTER_NOTICE',
        'Férias com aviso gerado devem ser canceladas, não excluídas.',
      );
    }
    transaction.delete(vacationRef);
    transaction.create(eventRef, vacationEvent(
      context,
      vacationId,
      'VACATION_DELETED',
      'Registro de férias excluído antes da comunicação.',
      now,
      { snapshot: serialize(current) as Record<string, unknown> },
    ));
  });
}
