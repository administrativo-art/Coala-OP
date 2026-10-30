import assert from 'node:assert/strict';
import test from 'node:test';

import {
  supersedeVacationReceiptDocuments,
  activeVacationReceiptDocuments,
  suggestVacationReceiptDocument,
  vacationReceiptCandidateScore,
  vacationReceiptDocuments,
} from '../../src/features/hr/vacations/receipt-documents';
import { updateVacationSchema } from '../../src/features/hr/vacations/schemas';
import type { DPVacationReceiptAnalysis, DPVacationReceiptDocument, DPVacationWorkflow } from '../../src/types';

function analysis(overrides: Partial<DPVacationReceiptAnalysis> = {}): DPVacationReceiptAnalysis {
  return {
    provider: 'openai',
    model: 'test-model',
    documentTypeCode: 'UNKNOWN_DOCUMENT',
    documentTypeConfidence: 0.4,
    employeeMatchStatus: 'UNKNOWN',
    extractedFields: {},
    fieldConfidences: {},
    issues: [],
    warnings: [],
    analyzedAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  };
}

function document(id: string, documentAnalysis: DPVacationReceiptAnalysis): DPVacationReceiptDocument {
  return {
    id,
    fileName: `${id}.pdf`,
    mimeType: 'application/pdf',
    storagePath: `receipts/${id}.pdf`,
    hashSha256: id.padEnd(64, '0').slice(0, 64),
    size: 100,
    uploadedAt: '2026-09-21T12:00:00.000Z',
    uploadedBy: 'external:accountant',
    correctionRound: 0,
    status: 'review_pending',
    analysis: documentAnalysis,
  };
}

test('copiloto prioriza recibo compatível, sem transformá-lo em seleção humana', () => {
  const support = document('support', analysis({
    documentTypeCode: 'UNKNOWN_DOCUMENT',
    documentTypeConfidence: 0.8,
  }));
  const receipt = document('receipt', analysis({
    documentTypeCode: 'VACATION_RECEIPT',
    documentTypeConfidence: 0.92,
    employeeMatchStatus: 'MATCH',
    extractedFields: {
      employeeName: 'Maria Edna Gois Ribeiro',
      vacationStartDate: '2026-10-21',
      vacationEndDate: '2026-10-29',
      numberOfDays: 9,
      amountGross: 2000,
      amountDiscounts: 100,
      amountNet: 1900,
    },
  }));

  const expected = {
    employeeName: 'Maria Edna Gois Ribeiro',
    startDate: '2026-10-21',
    endDate: '2026-10-29',
    days: 9,
  };
  assert.ok(vacationReceiptCandidateScore(receipt, expected) > vacationReceiptCandidateScore(support, expected));
  assert.equal(suggestVacationReceiptDocument([support, receipt], expected)?.id, 'receipt');
  assert.equal(receipt.status, 'review_pending');
});

test('normalização mantém recibo legado disponível e selecionado', () => {
  const receipt = {
    status: 'review_pending',
    originalDocumentId: 'receipt_legacy',
    originalFileName: 'recibo.pdf',
    originalMimeType: 'application/pdf',
    originalStoragePath: 'receipts/legacy.pdf',
    originalHashSha256: 'a'.repeat(64),
    originalSize: 200,
    originalUploadedAt: '2026-09-20T12:00:00.000Z',
    originalUploadedBy: 'external:accountant',
    analysis: analysis({ documentTypeCode: 'VACATION_RECEIPT' }),
  } as DPVacationWorkflow['receipt'];

  const documents = vacationReceiptDocuments(receipt);
  assert.equal(documents.length, 1);
  assert.equal(documents[0].id, 'receipt_legacy');
  assert.equal(documents[0].status, 'selected');
});

test('documentos de rodada anterior não voltam à sugestão após correção', () => {
  const superseded = { ...document('old', analysis({ documentTypeCode: 'VACATION_RECEIPT' })), status: 'superseded' as const };
  const current = document('new', analysis({ documentTypeCode: 'UNKNOWN_DOCUMENT' }));
  assert.equal(suggestVacationReceiptDocument([superseded, current], {})?.id, 'new');
});

test('documento descartado não volta à sugestão do copiloto', () => {
  const discarded = { ...document('old', analysis({ documentTypeCode: 'VACATION_RECEIPT' })), status: 'discarded' as const };
  const current = document('new', analysis({ documentTypeCode: 'UNKNOWN_DOCUMENT' }));
  assert.equal(suggestVacationReceiptDocument([discarded, current], {})?.id, 'new');
});

test('documento descartado é excluído da lista de documentos ativos', () => {
  const active = document('active', analysis({ documentTypeCode: 'UNKNOWN_DOCUMENT' }));
  const discarded = { ...document('gone', analysis({ documentTypeCode: 'VACATION_RECEIPT' })), status: 'discarded' as const };
  const receipt = { documents: [active, discarded] } as unknown as DPVacationWorkflow['receipt'];

  const documents = activeVacationReceiptDocuments(receipt);
  assert.equal(documents.length, 1);
  assert.equal(documents[0].id, 'active');
});

test('quando todos os documentos estão descartados não há sugestão nem documento ativo', () => {
  const first = { ...document('one', analysis({ documentTypeCode: 'VACATION_RECEIPT' })), status: 'discarded' as const };
  const second = { ...document('two', analysis({ documentTypeCode: 'UNKNOWN_DOCUMENT' })), status: 'discarded' as const };
  const receipt = { documents: [first, second] } as unknown as DPVacationWorkflow['receipt'];

  assert.equal(suggestVacationReceiptDocument([first, second], {}), null);
  assert.deepEqual(activeVacationReceiptDocuments(receipt), []);
});

test('correção preserva descarte e original, registrando decisão somente nas versões ativas', () => {
  const discarded = { ...document('discarded', analysis()), status: 'discarded' as const,
    discardedAt: '2026-09-20T10:00:00Z', discardedBy: 'rh-1', discardReason: 'Documento de outra pessoa' };
  const previous = { ...document('previous', analysis()), status: 'superseded' as const,
    supersededReason: 'Correção anterior' };
  const current = document('current', analysis());
  const decision = { at: '2026-09-22T12:00:00Z', by: 'rh-2', reason: 'Corrigir período de gozo' };
  const result = supersedeVacationReceiptDocuments([discarded, previous, current], decision);
  assert.deepEqual(result.slice(0, 2), [discarded, previous]);
  assert.equal(result[2].status, 'superseded');
  assert.equal(result[2].supersededReason, decision.reason);
  assert.equal(result[2].supersededBy, decision.by);
  assert.equal(result[2].supersededAt, decision.at);
  assert.equal(result[2].storagePath, current.storagePath);
  assert.equal(result[2].hashSha256, current.hashSha256);
  assert.equal(current.status, 'review_pending');
  assert.deepEqual(supersedeVacationReceiptDocuments(result, decision), result);
  assert.equal(suggestVacationReceiptDocument(result, {}), null);
});

test('descarte exige motivo limitado e remove campos não permitidos do comando', () => {
  const command = { action: 'discard_receipt_document', documentId: `receipt_${'a'.repeat(32)}` };
  for (const reason of [undefined, '', '   ', 'x'.repeat(2001)]) {
    assert.equal(updateVacationSchema.safeParse({ ...command, reason }).success, false);
  }
  assert.deepEqual(updateVacationSchema.parse({ ...command, reason: ' Documento de outra pessoa ', discardedBy: 'client-forged' }),
    { ...command, reason: 'Documento de outra pessoa' });
});
