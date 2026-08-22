import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  applicableOnboardingDocuments,
  presentOnboardingDocumentForAnswers,
  requiredFamilyDocumentKinds,
} from '../../src/features/hr/onboarding/document-applicability';

const today = new Date('2026-08-21T12:00:00.000Z');

describe('documentos condicionais do onboarding', () => {
  test('oculta a CNH quando a pessoa não possui CNH', () => {
    const documents = applicableOnboardingDocuments(
      [{ id: 'identity_document' }, { id: 'cnh' }],
      { hasCnh: 'no', identityDocumentType: 'identity' },
      today,
    );
    assert.deepEqual(documents.map(document => document.id), ['identity_document']);
  });

  test('oculta a CNH separada quando ela já foi usada como identificação', () => {
    const documents = applicableOnboardingDocuments(
      [{ id: 'identity_document' }, { id: 'cnh' }],
      { hasCnh: 'yes', identityDocumentType: 'cnh' },
      today,
    );
    assert.deepEqual(documents.map(document => document.id), ['identity_document']);
  });

  test('mantém somente os documentos compatíveis com a idade de cada filho', () => {
    const documents = applicableOnboardingDocuments(
      [
        { id: 'child_1_birth_certificate' },
        { id: 'child_1_vaccination' },
        { id: 'child_1_school_attendance' },
        { id: 'child_2_birth_certificate' },
        { id: 'child_2_vaccination' },
        { id: 'child_2_school_attendance' },
      ],
      {
        hasChildren: 'yes',
        children: [{ birthDate: '2015-01-01' }, { birthDate: '2025-06-13' }],
      },
      today,
    );
    assert.deepEqual(documents.map(document => document.id), [
      'child_1_birth_certificate',
      'child_1_school_attendance',
      'child_2_birth_certificate',
      'child_2_vaccination',
    ]);
    assert.deepEqual(requiredFamilyDocumentKinds('2015-01-01', today), ['birth_certificate', 'school_attendance']);
  });

  test('apresenta o anexo alternativo com o documento escolhido', () => {
    const generic = {
      id: 'identity_document',
      label: 'Documento de identidade ou CNH',
      description: 'Envie um documento.',
    };

    assert.equal(presentOnboardingDocumentForAnswers(generic, { hasCnh: 'yes' }).label, 'CNH');
    assert.equal(
      presentOnboardingDocumentForAnswers(generic, { hasCnh: 'no' }).label,
      'Documento de identidade (RG ou CIN)',
    );
    assert.equal(presentOnboardingDocumentForAnswers(generic, {}).label, generic.label);
  });
});
