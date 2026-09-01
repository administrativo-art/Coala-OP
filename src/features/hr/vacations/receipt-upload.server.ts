import 'server-only';

import { createHash } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';

import { analyzeEmployeeDocumentWithAi } from '@/lib/hr/employee-document-ai';
import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { AppError, reportSystemError } from '@/lib/observability';
import type { DPVacationReceiptAnalysis, DPVacationWorkflow } from '@/types';

const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;

function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function text(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validPdf(buffer: Buffer) {
  return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

function stepPatch(
  workflow: DPVacationWorkflow,
  id: DPVacationWorkflow['steps'][number]['id'],
  patch: Partial<DPVacationWorkflow['steps'][number]>,
) {
  return workflow.steps.map((step) => step.id === id ? { ...step, ...patch } : step);
}

function publicError(message: string, status: number) {
  const kind = status === 404 ? 'NOT_FOUND' : status === 409 || status === 410 ? 'CONFLICT' : 'VALIDATION';
  return new AppError({
    code: status === 404
      ? 'DP_VACATION_RECEIPT_LINK_NOT_FOUND'
      : status === 410
        ? 'DP_VACATION_RECEIPT_LINK_EXPIRED'
        : status === 409
          ? 'DP_VACATION_RECEIPT_UPLOAD_CONFLICT'
          : 'DP_VACATION_RECEIPT_UPLOAD_INVALID',
    kind,
    httpStatus: status,
    safeMessage: message,
  });
}

async function findVacationByToken(token: string) {
  if (!token || token.length > 256) return null;
  const snapshot = await dbAdmin.collection('dp_vacations')
    .where('workflow.accountant.tokenHash', '==', hashToken(token))
    .limit(1)
    .get();
  return snapshot.docs[0] ?? null;
}

export async function getVacationReceiptPortal(token: string) {
  const snapshot = await findVacationByToken(token);
  if (!snapshot) throw publicError('Link inválido.', 404);
  const vacation = snapshot.data();
  const workflow = vacation.workflow as DPVacationWorkflow | undefined;
  const expiresAt = workflow?.accountant.tokenExpiresAt ?? null;
  if (!workflow || !expiresAt || expiresAt <= new Date().toISOString()) {
    throw publicError('Este link expirou. Solicite um novo acesso ao RH.', 410);
  }
  const userSnapshot = await dbAdmin.collection('users').doc(String(vacation.userId ?? '')).get();
  const user = userSnapshot.data() ?? {};
  return {
    vacationId: snapshot.id,
    employeeName: text(user.username, 180) || 'Colaborador(a)',
    companyName: text(user.employerUnitName, 180) || 'Coala Shakes',
    acquisitionCycle: text(vacation.cycleId, 20),
    startDate: text(vacation.startDate, 10),
    endDate: text(vacation.endDate, 10),
    status: workflow.accountant.status,
    receiptStatus: workflow.receipt.status,
    correctionReason: workflow.receipt.correctionReason ?? null,
    alreadyUploaded: Boolean(workflow.receipt.originalDocumentId)
      && !['correction_requested'].includes(workflow.receipt.status),
    expiresAt,
  };
}

export async function uploadVacationReceipt(params: {
  token: string;
  file: File;
  ip?: string | null;
  userAgent?: string | null;
}) {
  if (!(params.file instanceof File)) throw publicError('Selecione o recibo de férias.', 400);
  if (params.file.type !== 'application/pdf') throw publicError('Envie o recibo em PDF.', 400);
  if (params.file.size <= 0 || params.file.size > MAX_RECEIPT_BYTES) {
    throw publicError('O arquivo deve ter até 15 MB.', 400);
  }
  const buffer = Buffer.from(await params.file.arrayBuffer());
  if (!validPdf(buffer)) throw publicError('O arquivo enviado não é um PDF válido.', 400);
  const hashSha256 = createHash('sha256').update(buffer).digest('hex');
  const snapshot = await findVacationByToken(params.token);
  if (!snapshot) throw publicError('Link inválido.', 404);
  const vacationRef = snapshot.ref;
  const versionId = `receipt_${hashSha256.slice(0, 32)}`;
  const storagePath = `hr/vacations/${snapshot.id}/receipt/original/${versionId}.pdf`;
  const now = new Date().toISOString();

  const duplicate = await vacationRef.collection('receiptVersions')
    .where('hashSha256', '==', hashSha256)
    .limit(1)
    .get();
  if (!duplicate.empty) throw publicError('Este mesmo arquivo já foi enviado.', 409);

  await dbAdmin.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(vacationRef);
    if (!currentSnapshot.exists) throw publicError('Link inválido.', 404);
    const workflow = currentSnapshot.get('workflow') as DPVacationWorkflow | undefined;
    if (!workflow || workflow.accountant.tokenHash !== hashToken(params.token)) {
      throw publicError('Link inválido.', 404);
    }
    if (!workflow.accountant.tokenExpiresAt || workflow.accountant.tokenExpiresAt <= now) {
      throw publicError('Este link expirou. Solicite um novo acesso ao RH.', 410);
    }
    if (!['sent', 'correction_requested', 'receipt_received'].includes(workflow.accountant.status)) {
      throw publicError('Este recibo não pode ser enviado nesta etapa.', 409);
    }
    if (workflow.receipt.originalDocumentId && workflow.receipt.status !== 'correction_requested') {
      throw publicError('O recibo já foi enviado e está em conferência.', 409);
    }
  });

  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: {
      contentType: 'application/pdf',
      cacheControl: 'private, max-age=0, no-store',
      metadata: { vacationId: snapshot.id, versionId, hashSha256, source: 'accountant_public_link' },
    },
  });

  await dbAdmin.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(vacationRef);
    if (!currentSnapshot.exists) throw publicError('Link inválido.', 404);
    const workflow = currentSnapshot.get('workflow') as DPVacationWorkflow;
    if (!['sent', 'correction_requested', 'receipt_received'].includes(workflow.accountant.status)) {
      throw publicError('A etapa mudou durante o envio. Atualize a página.', 409);
    }
    const stepsAfterAccountant = stepPatch(workflow, 'accountant', {
      status: 'completed',
      completedAt: now,
      completedBy: 'external:accountant',
      note: 'Recibo original recebido pelo portal seguro.',
    });
    const steps = stepsAfterAccountant.map((step) => step.id === 'receipt_review'
      ? { ...step, status: 'in_progress' as const, startedAt: step.startedAt ?? now }
      : step);
    const nextWorkflow: DPVacationWorkflow = {
      ...workflow,
      currentStage: 'receipt_review',
      steps,
      accountant: { ...workflow.accountant, status: 'receipt_received', lastError: null },
      receipt: {
        status: 'processing',
        originalDocumentId: versionId,
        originalFileName: params.file.name.slice(0, 240),
        originalMimeType: 'application/pdf',
        originalStoragePath: storagePath,
        originalHashSha256: hashSha256,
        originalSize: buffer.length,
        originalUploadedAt: now,
        originalUploadedBy: 'external:accountant',
        analysis: null,
        reviewedValues: null,
        reviewNotes: null,
        correctionReason: null,
      },
      updatedAt: now,
    };
    transaction.update(vacationRef, { workflow: nextWorkflow, updatedAt: new Date(now) });
    const supersedesId = workflow.receipt.status === 'correction_requested'
      ? workflow.receipt.originalDocumentId ?? null
      : null;
    if (supersedesId && supersedesId !== versionId) {
      transaction.set(vacationRef.collection('receiptVersions').doc(supersedesId), {
        status: 'superseded',
        supersededAt: now,
        supersededByVersionId: versionId,
      }, { merge: true });
    }
    transaction.create(vacationRef.collection('receiptVersions').doc(versionId), {
      versionId,
      storagePath,
      originalFileName: params.file.name.slice(0, 240),
      mimeType: 'application/pdf',
      size: buffer.length,
      hashSha256,
      uploadedAt: now,
      uploadedBy: 'external:accountant',
      supersedesId,
      ip: params.ip ?? null,
      userAgent: params.userAgent?.slice(0, 500) ?? null,
      status: 'processing',
    });
    transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
      vacationId: snapshot.id,
      type: 'VACATION_RECEIPT_UPLOADED',
      message: 'A contabilidade enviou o recibo original de férias.',
      at: now,
      actorId: 'external:accountant',
      actorEmail: workflow.accountant.recipientEmail ?? null,
      actorName: 'Contabilidade',
      data: { versionId, hashSha256, size: buffer.length },
    });
  });

  let ai: Awaited<ReturnType<typeof analyzeEmployeeDocumentWithAi>>;
  try {
    ai = await analyzeEmployeeDocumentWithAi({
      file: params.file,
      expectedEmployeeName: (await getVacationReceiptPortal(params.token)).employeeName,
    });
  } catch (error) {
    const analyzedAt = new Date().toISOString();
    const reference = reportSystemError({
      error,
      source: 'api',
      operation: 'analyze-vacation-receipt',
      routeOrJob: '/api/hr/vacation-accountant/[token]',
      metadata: { vacationId: snapshot.id, versionId },
    });
    await dbAdmin.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(vacationRef);
      if (!currentSnapshot.exists) return;
      const workflow = currentSnapshot.get('workflow') as DPVacationWorkflow;
      if (workflow.receipt.originalDocumentId !== versionId || workflow.receipt.status !== 'processing') return;
      transaction.update(vacationRef, {
        workflow: {
          ...workflow,
          receipt: { ...workflow.receipt, status: 'review_pending', analysis: null },
          updatedAt: analyzedAt,
        },
        updatedAt: new Date(analyzedAt),
      });
      transaction.update(vacationRef.collection('receiptVersions').doc(versionId), {
        status: 'review_pending',
        analysis: null,
        analysisEventId: reference.eventId,
        analyzedAt,
      });
      transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
        vacationId: snapshot.id,
        type: 'VACATION_RECEIPT_ANALYSIS_FAILED',
        message: 'O recibo original foi preservado, mas a leitura automática não terminou. A auditoria manual foi liberada.',
        at: analyzedAt,
        actorId: 'system:document-analysis',
        actorEmail: null,
        actorName: 'Sistema',
        data: { versionId, eventId: reference.eventId },
      });
    });
    return { ok: true, versionId, analysisAvailable: false };
  }
  const analyzedAt = new Date().toISOString();
  const analysis: DPVacationReceiptAnalysis = {
    provider: ai.provider,
    model: ai.model,
    documentTypeCode: ai.documentTypeCode,
    documentTypeConfidence: ai.documentTypeConfidence,
    employeeMatchStatus: ai.employeeMatchStatus,
    identifiedEmployeeName: ai.identifiedEmployeeName ?? null,
    extractedFields: {
      employeeName: typeof ai.extractedFields.employeeName === 'string' ? ai.extractedFields.employeeName : null,
      employer: typeof ai.extractedFields.employer === 'string' ? ai.extractedFields.employer : null,
      cnpj: typeof ai.extractedFields.cnpj === 'string' ? ai.extractedFields.cnpj : null,
      acquisitionPeriodStart: typeof ai.extractedFields.acquisitionPeriodStart === 'string' ? ai.extractedFields.acquisitionPeriodStart : null,
      acquisitionPeriodEnd: typeof ai.extractedFields.acquisitionPeriodEnd === 'string' ? ai.extractedFields.acquisitionPeriodEnd : null,
      vacationStartDate: typeof ai.extractedFields.vacationStartDate === 'string' ? ai.extractedFields.vacationStartDate : null,
      vacationEndDate: typeof ai.extractedFields.vacationEndDate === 'string' ? ai.extractedFields.vacationEndDate : null,
      numberOfDays: typeof ai.extractedFields.numberOfDays === 'number' ? ai.extractedFields.numberOfDays : null,
      amountGross: typeof ai.extractedFields.amountGross === 'number' ? ai.extractedFields.amountGross : null,
      amountDiscounts: typeof ai.extractedFields.amountDiscounts === 'number' ? ai.extractedFields.amountDiscounts : null,
      amountNet: typeof ai.extractedFields.amountNet === 'number' ? ai.extractedFields.amountNet : null,
      paymentDate: typeof ai.extractedFields.paymentDate === 'string' ? ai.extractedFields.paymentDate : null,
      signatureDetected: typeof ai.extractedFields.signatureDetected === 'boolean' ? ai.extractedFields.signatureDetected : null,
    },
    fieldConfidences: ai.fieldConfidences,
    issues: ai.issues,
    warnings: ai.documentTypeCode === 'VACATION_RECEIPT'
      ? ai.warnings
      : [`O arquivo foi classificado como ${ai.documentTypeCode || 'desconhecido'}; confirme se é o recibo de férias.`, ...ai.warnings],
    analyzedAt,
  };

  await dbAdmin.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(vacationRef);
    if (!currentSnapshot.exists) return;
    const workflow = currentSnapshot.get('workflow') as DPVacationWorkflow;
    if (workflow.receipt.originalDocumentId !== versionId || workflow.receipt.status !== 'processing') return;
    transaction.update(vacationRef, {
      workflow: {
        ...workflow,
        receipt: { ...workflow.receipt, status: 'review_pending', analysis },
        updatedAt: analyzedAt,
      },
      updatedAt: new Date(analyzedAt),
    });
    transaction.update(vacationRef.collection('receiptVersions').doc(versionId), {
      status: 'review_pending',
      analysis,
      analyzedAt,
    });
    transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
      vacationId: snapshot.id,
      type: 'VACATION_RECEIPT_PROCESSED',
      message: 'O recibo foi processado e está disponível para auditoria do RH.',
      at: analyzedAt,
      actorId: 'system:document-analysis',
      actorEmail: null,
      actorName: 'Sistema',
      data: { versionId, provider: analysis.provider, documentTypeCode: analysis.documentTypeCode },
    });
  });
  return { ok: true, versionId };
}
