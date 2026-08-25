import assert from 'node:assert/strict';
import test from 'node:test';

import {
  maritalStatusIsInformed,
  ONBOARDING_MARITAL_STATUSES,
} from '../../../src/features/hr/onboarding/marital-status';

test('estado civil do formulário inicial usa opções canônicas', () => {
  assert.deepEqual(ONBOARDING_MARITAL_STATUSES, [
    'Solteiro(a)',
    'Casado(a)',
    'Divorciado(a)',
    'Viúvo(a)',
    'União estável',
  ]);
});

test('não permite gerar o formulário contábil com estado civil ausente', () => {
  assert.equal(maritalStatusIsInformed(''), false);
  assert.equal(maritalStatusIsInformed('Não informado'), false);
  assert.equal(maritalStatusIsInformed('Casado(a)'), true);
});
