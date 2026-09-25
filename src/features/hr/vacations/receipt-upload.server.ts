import 'server-only';

import { createHash } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';

import {
  suggestVacationReceiptDocument,
  vacationReceiptDocuments,
} from '@/features/hr/vacations/receipt-documents';
import { analyzeEmployeeDocumentWithAi } from '@/lib/hr/employee-document-ai';
import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { AppError, reportSystemError } from '@/lib/observability';
import type {
  DPVacationReceiptAnalysis,
  DPVacationReceiptDocument,
  DPVacationWorkflow,
} from '@/types';

const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;
const MAX_RECEIPT_BATCH_BYTES = 25 * 1024 * 1024;
const MAX_RECEIPT_FILES = 20;
const MAX_RECEIPT_DOCUMENTS = 40;
const ALLOWED_RECEIPT_MIME_TYPES = new Set<DPVacationReceiptDocument['mimeType']>([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function text(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validFileSignature(buffer: Buffer, mimeType: DPVacationReceiptDocument['mimeType']) {
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte);
}

function fileExtension(mimeType: DPVacationReceiptDocument['mimeType']) {
  if (mimeType === 'application/pdf') return 'pdf';
  return mimeType === 'image/png' ? 'png' : 'jpg';
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

function portalIsActive(workflow: DPVacationWorkflow | undefined, now: string) {
  return Boolean(
    workflow
    && workflow.status === 'active'
    && workflow.accountant.tokenExpiresAt
    && workflow.accountant.tokenExpiresAt > now,
  );
}

function selectionFinalized(receipt: DPVacationWorkflow['receipt']) {
  return receipt.status !== 'correction_requested'
    && Boolean(receipt.selectedDocumentId || receipt.originalDocumentId);
}

function assertUploadAllowed(workflow: DPVacationWorkflow | undefined, token: string, now: string) {
  if (!workflow || workflow.status !== 'active' || workflow.accountant.tokenHash !== hashToken(token)) {
    throw publicError('Link inválido.', 404);
  }
  if (!workflow.accountant.tokenExpiresAt || workflow.accountant.tokenExpiresAt <= now) {
    throw publicError('Este link expirou. Solicite um novo acesso ao RH.', 410);
  }
  if (!['sent', 'correction_requested', 'receipt_received'].includes(workflow.accountant.status)) {
    throw publicError('Os documentos não podem ser enviados nesta etapa.', 409);
  }
  if (workflow.receipt.status === 'approved' || selectionFinalized(workflow.receipt)) {
    throw publicError('O RH já finalizou a escolha do recibo. Solicite uma correção para enviar novos arquivos.', 409);
  }
}

function receiptAnalysis(
  ai: Awaited<ReturnType<typeof analyzeEmployeeDocumentWithAi>>,
  analyzedAt: string,
): DPVacationReceiptAnalysis {
  return {
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
      : [`O arquivo foi classificado como ${ai.documentTypeCode || 'desconhecido'}; confirme manualmente sua finalidade.`, ...ai.warnings],
    analyzedAt,
  };
}

export async function getVacationReceiptPortal(token: string) {
  const snapshot = await findVacationByToken(token);
  if (!snapshot) throw publicError('Link inválido.', 404);
  const vacation = snapshot.data();
  const workflow = vacation.workflow as DPVacationWorkflow | undefined;
  const now = new Date().toISOString();
  if (!portalIsActive(workflow, now)) {
    throw publicError('Este link expirou. Solicite um novo acesso ao RH.', 410);
  }
  const userSnapshot = await dbAdmin.collection('users').doc(String(vacation.userId ?? '')).get();
  const user = userSnapshot.data() ?? {};
  const allDocuments = vacationReceiptDocuments(workflow!.receipt);
  const documents = allDocuments.filter((document) => document.status !== 'superseded');
  const finalized = selectionFinalized(workflow!.receipt);
  const acceptingUploads = !finalized
    && workflow!.receipt.status !== 'approved'
    && ['sent', 'correction_requested', 'receipt_received'].includes(workflow!.accountant.status)
    && allDocuments.length < MAX_RECEIPT_DOCUMENTS;
  return {
    vacationId: snapshot.id,
    employeeName: text(user.username, 180) || 'Colaborador(a)',
    companyName: text(user.employerUnitName, 180) || 'Coala Shakes',
    acquisitionCycle: text(vacation.cycleId, 20),
    startDate: text(vacation.startDate, 10),
    endDate: text(vacation.endDate, 10),
    status: workflow!.accountant.status,
    receiptStatus: workflow!.receipt.status,
    correctionReason: workflow!.receipt.correctionReason ?? null,
    alreadyUploaded: documents.length > 0,
    uploadedCount: documents.length,
    uploadedFiles: documents.map((document) => ({
      fileName: document.fileName,
      mimeType: document.mimeType,
      status: document.status,
    })),
    selectionFinalized: finalized,
    acceptingUploads,
    expiresAt: workflow!.accountant.tokenExpiresAt,
  };
}

export async function uploadVacationReceipt(params: {
  token: string;
  files: File[];
  ip?: string | null;
  userAgent?: string | null;
}) {
  if (!params.files.length) throw publicError('Selecione ao menos um arquivo.', 400);
  if (params.files.length > MAX_RECEIPT_FILES) {
    throw publicError(`Envie no máximo ${MAX_RECEIPT_FILES} arquivos por vez.`, 400);
  }

  const prepared = await Promise.all(params.files.map(async (file) => {
    if (!(file instanceof File)) throw publicError('Selecione arquivos válidos.', 400);
    if (!ALLOWED_RECEIPT_MIME_TYPES.has(file.type as DPVacationReceiptDocument['mimeType'])) {
      throw publicError('Envie somente arquivos PDF, JPG ou PNG.', 400);
    }
    if (file.size <= 0 || file.size > MAX_RECEIPT_BYTES) {
      throw publicError('Cada arquivo deve ter até 15 MB.', 400);
    }
    const mimeType = file.type as DPVacationReceiptDocument['mimeType'];
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!validFileSignature(buffer, mimeType)) throw publicError(`O arquivo ${file.name} não possui um formato válido.`, 400);
    const hashSha256 = createHash('sha256').update(buffer).digest('hex');
    const id = `receipt_${hashSha256.slice(0, 32)}`;
    return { file, buffer, mimeType, hashSha256, id, storagePath: '' };
  }));
  if (prepared.reduce((total, item) => total + item.buffer.length, 0) > MAX_RECEIPT_BATCH_BYTES) {
    throw publicError('O conjunto de arquivos deve ter no máximo 25 MB.', 400);
  }
  if (new Set(prepared.map((item) => item.hashSha256)).size !== prepared.length) {
    throw publicError('O mesmo arquivo foi selecionado mais de uma vez.', 409);
  }

  const snapshot = await findVacationByToken(params.token);
  if (!snapshot) throw publicError('Link inválido.', 404);
  const vacationRef = snapshot.ref;
  const initialWorkflow = snapshot.get('workflow') as DPVacationWorkflow | undefined;
  const now = new Date().toISOString();
  assertUploadAllowed(initialWorkflow, params.token, now);
  const initialDocuments = vacationReceiptDocuments(initialWorkflow!.receipt);
  if (initialDocuments.length + prepared.length > MAX_RECEIPT_DOCUMENTS) {
    throw publicError(`Este processo aceita no máximo ${MAX_RECEIPT_DOCUMENTS} arquivos.`, 409);
  }

  const versionReferences = prepared.map((item) => vacationRef.collection('receiptVersions').doc(item.id));
  const existingVersions = await Promise.all(versionReferences.map((reference) => reference.get()));
  if (existingVersions.some((document) => document.exists)) {
    throw publicError('Um dos arquivos selecionados já foi enviado.', 409);
  }

  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const storedPaths: string[] = [];
  try {
    const storageResults = await Promise.allSettled(prepared.map(async (item) => {
      item.storagePath = `hr/vacations/${snapshot.id}/receipt/original/${item.id}.${fileExtension(item.mimeType)}`;
      await bucket.file(item.storagePath).save(item.buffer, {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: item.mimeType,
          cacheControl: 'private, max-age=0, no-store',
          metadata: {
            vacationId: snapshot.id,
            versionId: item.id,
            hashSha256: item.hashSha256,
            source: 'accountant_public_link',
          },
        },
      });
      return item.storagePath;
    }));
    storageResults.forEach((result) => {
      if (result.status === 'fulfilled') storedPaths.push(result.value);
    });
    const storageFailure = storageResults.find((result) => result.status === 'rejected');
    if (storageFailure?.status === 'rejected') throw storageFailure.reason;

    await dbAdmin.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(vacationRef);
      if (!currentSnapshot.exists) throw publicError('Link inválido.', 404);
      const workflow = currentSnapshot.get('workflow') as DPVacationWorkflow | undefined;
      assertUploadAllowed(workflow, params.token, now);
      const versionSnapshots = [];
      for (const reference of versionReferences) versionSnapshots.push(await transaction.get(reference));
      if (versionSnapshots.some((document) => document.exists)) {
        throw publicError('Um dos arquivos selecionados já foi enviado.', 409);
      }
      const existingDocuments = vacationReceiptDocuments(workflow!.receipt);
      if (existingDocuments.length + prepared.length > MAX_RECEIPT_DOCUMENTS) {
        throw publicError(`Este processo aceita no máximo ${MAX_RECEIPT_DOCUMENTS} arquivos.`, 409);
      }
      const correctionRound = workflow!.accountant.correctionRound ?? 0;
      const previousDocuments = workflow!.receipt.status === 'correction_requested'
        ? existingDocuments.map((document) => document.status === 'superseded' ? document : { ...document, status: 'superseded' as const })
        : existingDocuments;
      const uploadedDocuments: DPVacationReceiptDocument[] = prepared.map((item) => ({
        id: item.id,
        fileName: item.file.name.slice(0, 240),
        mimeType: item.mimeType,
        storagePath: item.storagePath,
        hashSha256: item.hashSha256,
        size: item.buffer.length,
        uploadedAt: now,
        uploadedBy: 'external:accountant',
        correctionRound,
        status: 'processing',
        analysis: null,
        analyzedAt: null,
      }));
      const stepsAfterAccountant = stepPatch(workflow!, 'accountant', {
        status: 'completed',
        completedAt: now,
        completedBy: 'external:accountant',
        note: `${uploadedDocuments.length} arquivo(s) recebido(s) pelo portal seguro.`,
      });
      const steps = stepsAfterAccountant.map((step) => step.id === 'receipt_review'
        ? { ...step, status: 'in_progress' as const, startedAt: step.startedAt ?? now, note: null }
        : step);
      const nextWorkflow: DPVacationWorkflow = {
        ...workflow!,
        currentStage: 'receipt_review',
        steps,
        accountant: { ...workflow!.accountant, status: 'receipt_received', lastError: null },
        receipt: {
          ...workflow!.receipt,
          status: 'processing',
          documents: [...previousDocuments, ...uploadedDocuments],
          suggestedDocumentId: null,
          selectedDocumentId: null,
          selectedAt: null,
          selectedBy: null,
          originalDocumentId: null,
          originalFileName: null,
          originalMimeType: null,
          originalStoragePath: null,
          originalHashSha256: null,
          originalSize: null,
          originalUploadedAt: null,
          originalUploadedBy: null,
          analysis: null,
          reviewedValues: null,
          reviewNotes: null,
          reviewOverrideReason: null,
          identityMismatches: [],
          correctionReason: null,
        },
        updatedAt: now,
      };
      transaction.update(vacationRef, { workflow: nextWorkflow, updatedAt: new Date(now) });
      uploadedDocuments.forEach((document, index) => {
        transaction.create(versionReferences[index], {
          versionId: document.id,
          storagePath: document.storagePath,
          originalFileName: document.fileName,
          mimeType: document.mimeType,
          size: document.size,
          hashSha256: document.hashSha256,
          uploadedAt: now,
          uploadedBy: document.uploadedBy,
          correctionRound,
          ip: params.ip ?? null,
          userAgent: params.userAgent?.slice(0, 500) ?? null,
          status: 'processing',
        });
      });
      transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
        vacationId: snapshot.id,
        type: 'VACATION_RECEIPT_FILES_UPLOADED',
        message: `A contabilidade enviou ${uploadedDocuments.length} arquivo(s) para triagem do recibo de férias.`,
        at: now,
        actorId: 'external:accountant',
        actorEmail: workflow!.accountant.recipientEmail ?? null,
        actorName: 'Contabilidade',
        data: { documentIds: uploadedDocuments.map((document) => document.id), count: uploadedDocuments.length },
      });
    });
  } catch (error) {
    await Promise.all(storedPaths.map((storagePath) => bucket.file(storagePath).delete({ ignoreNotFound: true }).catch(() => undefined)));
    throw error;
  }

  const vacation = snapshot.data();
  const userSnapshot = await dbAdmin.collection('users').doc(String(vacation.userId ?? '')).get();
  const expectedEmployeeName = text(userSnapshot.get('username'), 180) || null;
  const analyzed = await Promise.all(prepared.map(async (item) => {
    const analyzedAt = new Date().toISOString();
    try {
      const ai = await analyzeEmployeeDocumentWithAi({ file: item.file, expectedEmployeeName });
      return { id: item.id, analysis: receiptAnalysis(ai, analyzedAt), analyzedAt, eventId: null as string | null };
    } catch (error) {
      const reference = reportSystemError({
        error,
        source: 'api',
        operation: 'analyze-vacation-receipt-document',
        routeOrJob: '/api/hr/vacation-accountant/[token]',
        metadata: { vacationId: snapshot.id, versionId: item.id },
      });
      return { id: item.id, analysis: null, analyzedAt, eventId: reference.eventId };
    }
  }));

  const completedAt = new Date().toISOString();
  await dbAdmin.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(vacationRef);
    if (!currentSnapshot.exists) return;
    const workflow = currentSnapshot.get('workflow') as DPVacationWorkflow;
    if (workflow.status !== 'active') return;
    const analysisById = new Map(analyzed.map((item) => [item.id, item]));
    const documents = vacationReceiptDocuments(workflow.receipt).map((document) => {
      const result = analysisById.get(document.id);
      if (!result) return document;
      return {
        ...document,
        status: result.analysis ? 'review_pending' as const : 'analysis_failed' as const,
        analysis: result.analysis,
        analyzedAt: result.analyzedAt,
      };
    });
    const stillProcessing = documents.some((document) => document.status === 'processing');
    const suggestion = suggestVacationReceiptDocument(documents.filter((document) => Boolean(document.analysis)), {
      employeeName: expectedEmployeeName,
      startDate: text(currentSnapshot.get('startDate'), 10),
      endDate: text(currentSnapshot.get('endDate'), 10),
      days: Number(currentSnapshot.get('days') ?? 0),
    });
    transaction.update(vacationRef, {
      workflow: {
        ...workflow,
        receipt: {
          ...workflow.receipt,
          status: stillProcessing ? 'processing' : 'review_pending',
          documents,
          suggestedDocumentId: suggestion?.id ?? null,
        },
        updatedAt: completedAt,
      },
      updatedAt: new Date(completedAt),
    });
    analyzed.forEach((result, index) => {
      transaction.update(versionReferences[index], {
        status: result.analysis ? 'review_pending' : 'analysis_failed',
        analysis: result.analysis,
        analysisEventId: result.eventId,
        analyzedAt: result.analyzedAt,
      });
    });
    transaction.create(dbAdmin.collection('dp_vacationEvents').doc(), {
      vacationId: snapshot.id,
      type: 'VACATION_RECEIPT_FILES_PROCESSED',
      message: suggestion
        ? 'Os arquivos foram processados e a Mel sugeriu um recibo para confirmação do RH.'
        : 'Os arquivos foram preservados e estão disponíveis para seleção manual do RH.',
      at: completedAt,
      actorId: 'system:document-analysis',
      actorEmail: null,
      actorName: 'Sistema',
      data: {
        documentIds: analyzed.map((item) => item.id),
        suggestedDocumentId: suggestion?.id ?? null,
        failedAnalysisCount: analyzed.filter((item) => !item.analysis).length,
      },
    });
  });

  return {
    ok: true,
    uploadedCount: prepared.length,
    documentIds: prepared.map((item) => item.id),
  };
}
