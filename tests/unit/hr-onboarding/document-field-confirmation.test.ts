import assert from 'node:assert/strict';
import test from 'node:test';

import {
  confirmExtractedDocumentField,
  correctExtractedDocumentField,
} from '@/features/hr/onboarding/document-field-confirmation';
import type { OnboardingDocument } from '@/types';

const baseDocument = {
  id: 'identity',
  label: 'Documento de identidade',
  required: true,
  status: 'review_required',
  extractedFields: { cpf: '123.456.789-00', name: 'Pessoa Teste' },
} as OnboardingDocument;

test('confirma um campo extraído preservando confirmações anteriores', () => {
  const result = confirmExtractedDocumentField({
    documents: [{ ...baseDocument, confirmedExtractedFields: ['name'] }],
    documentId: 'identity',
    fieldKey: 'cpf',
    now: '2026-08-25T12:00:00.000Z',
    actorId: 'rh-1',
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.documents[0].confirmedExtractedFields, ['name', 'cpf']);
  assert.equal(result.documents[0].extractedFieldsConfirmedBy, 'rh-1');
  assert.equal(result.documents[0].extractedFieldsConfirmedAt, '2026-08-25T12:00:00.000Z');
});

test('a confirmação é idempotente para o mesmo campo', () => {
  const result = confirmExtractedDocumentField({
    documents: [{ ...baseDocument, confirmedExtractedFields: ['cpf'] }],
    documentId: 'identity',
    fieldKey: 'cpf',
    now: '2026-08-25T12:00:00.000Z',
    actorId: 'rh-1',
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.documents[0].confirmedExtractedFields, ['cpf']);
});

test('não confirma documento ou campo inexistente', () => {
  assert.deepEqual(confirmExtractedDocumentField({
    documents: [baseDocument], documentId: 'missing', fieldKey: 'cpf', now: 'now', actorId: 'rh-1',
  }), { ok: false, reason: 'document_not_found' });
  assert.deepEqual(confirmExtractedDocumentField({
    documents: [baseDocument], documentId: 'identity', fieldKey: 'rg', now: 'now', actorId: 'rh-1',
  }), { ok: false, reason: 'field_not_found' });
});

test('corrige e confirma um campo escalar com rastreabilidade', () => {
  const result = correctExtractedDocumentField({
    documents: [baseDocument],
    documentId: 'identity',
    fieldKey: 'cpf',
    value: '987.654.321-00',
    now: '2026-08-25T12:30:00.000Z',
    actorId: 'rh-2',
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.documents[0].extractedFields?.cpf, '987.654.321-00');
  assert.deepEqual(result.documents[0].confirmedExtractedFields, ['cpf']);
  assert.deepEqual(result.documents[0].correctedExtractedFields, ['cpf']);
  assert.equal(result.documents[0].extractedFieldsCorrectedBy, 'rh-2');
});

test('não permite corrigir campo composto pela ação escalar', () => {
  const result = correctExtractedDocumentField({
    documents: [{ ...baseDocument, extractedFields: { dependents: [{ name: 'Filho' }] } }],
    documentId: 'identity',
    fieldKey: 'dependents',
    value: 'texto',
    now: 'now',
    actorId: 'rh-1',
  });
  assert.deepEqual(result, { ok: false, reason: 'unsupported_value' });
});
