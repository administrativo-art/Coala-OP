import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAccountantDependentAnalysis,
  familyDocumentId,
} from '../../../src/features/hr/accountant/dependent-analysis';
import type { OnboardingDocument } from '../../../src/types';

const approvedDocument = (id: string): OnboardingDocument => ({
  id,
  label: id,
  required: true,
  status: 'approved',
  filePath: `hr/onboarding/${id}.pdf`,
});

test('cruza os documentos dos dependentes com os IDs técnicos usados no onboarding', () => {
  const documents = [
    approvedDocument('child_1_birth_certificate'),
    approvedDocument('child_1_school_attendance'),
    approvedDocument('child_2_birth_certificate'),
    approvedDocument('child_2_vaccination'),
  ];
  const analysis = buildAccountantDependentAnalysis({
    answers: {
      children: [
        { name: 'Maria', birthDate: '2015-01-02' },
        { name: 'Cauã', birthDate: '2025-06-14' },
      ],
    },
    documents,
    monthlySalary: 1_600,
    today: new Date('2026-08-24T12:00:00-03:00'),
  });

  assert.equal(familyDocumentId(0, 'certidão'), 'child_1_birth_certificate');
  assert.equal(familyDocumentId(0, 'frequência escolar'), 'child_1_school_attendance');
  assert.equal(familyDocumentId(1, 'vacinação'), 'child_2_vaccination');
  assert.equal(analysis.conclusion, 'ELEGÍVEL: 2 DEPENDENTES VALIDADOS');
  assert.deepEqual(analysis.dependents.map(dependent => dependent.eligibility), ['Elegível', 'Elegível']);
  assert.ok(analysis.dependents.every(dependent => !dependent.documentDetails.includes('pendente')));
});

test('não considera documento sem arquivo auditável como concluído', () => {
  const analysis = buildAccountantDependentAnalysis({
    answers: { children: [{ name: 'Cauã', birthDate: '2025-06-14' }] },
    documents: [
      approvedDocument('child_1_birth_certificate'),
      { ...approvedDocument('child_1_vaccination'), filePath: null },
    ],
    monthlySalary: 1_600,
    today: new Date('2026-08-24T12:00:00-03:00'),
  });

  assert.equal(analysis.conclusion, 'AGUARDANDO VALIDAÇÃO DOS DEPENDENTES');
  assert.equal(analysis.dependents[0]?.eligibility, 'Pendente de documentação');
  assert.match(analysis.dependents[0]?.documentDetails ?? '', /vacinação: pendente/i);
});
