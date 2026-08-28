import assert from 'node:assert/strict';
import test from 'node:test';

import { redactOnboardingProcess } from '@/features/hr/onboarding/process-redaction.server';
import { defaultGuestPermissions, type PermissionSet } from '@/types';

function accessWith(configure?: (permissions: PermissionSet) => void) {
  const permissions = structuredClone(defaultGuestPermissions) as PermissionSet;
  configure?.(permissions);
  return { permissions, isDefaultAdmin: false } as Parameters<typeof redactOnboardingProcess>[1];
}

test('a leitura pontual aplica a mesma proteção de documentos e dados sensíveis da listagem', () => {
  const result = redactOnboardingProcess({
    id: 'onboarding-1',
    publicToken: 'token-secreto',
    monthlySalary: 1787.3,
    accountantWorkflow: { formData: { monthlySalary: 1787.3 } },
    publicFormAnswers: { cpf: '12345678900', fullName: 'Pessoa Teste' },
    documents: [{
      id: 'identity',
      fileUrl: 'https://storage/document',
      hashSha256: 'hash',
      extractedFields: { cpf: '12345678900' },
      fieldConfidences: { cpf: 0.99 },
      aiAnalysis: { model: 'gpt-5.6-terra' },
    }],
  }, accessWith());

  assert.equal(result.monthlySalaryConfigured, true);
  assert.equal('monthlySalary' in result, false);
  assert.equal('accountantWorkflow' in result, false);
  assert.equal('publicToken' in result, false);
  assert.equal((result.publicFormAnswers as Record<string, unknown>).cpf, undefined);
  assert.equal((result.documents as Array<Record<string, unknown>>)[0].fileUrl, undefined);
  assert.equal((result.documents as Array<Record<string, unknown>>)[0].extractedFields, undefined);
  assert.equal((result.documents as Array<Record<string, unknown>>)[0].aiAnalysis, undefined);
});

test('mantém o arquivo quando o perfil possui visualização documental', () => {
  const result = redactOnboardingProcess({
    documents: [{ id: 'identity', fileUrl: 'https://storage/document' }],
  }, accessWith(permissions => {
    permissions.hr.formalization.documents.view = true;
  }));

  assert.equal((result.documents as Array<Record<string, unknown>>)[0].fileUrl, 'https://storage/document');
});
