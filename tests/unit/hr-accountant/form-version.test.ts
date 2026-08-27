import assert from 'node:assert/strict';
import test from 'node:test';

import { invalidateAccountantFormVersion } from '../../../src/features/hr/accountant/form-version';

test('alteração salarial invalida a versão gerada e sua validação', () => {
  const next = invalidateAccountantFormVersion({
    latestFormId: 'form-1',
    status: 'form_validated',
    formValidation: { documentId: 'form-1' },
  }, 'monthly_salary_changed', '2026-08-25T04:00:00.000Z');
  assert.equal(next.status, 'form_generated');
  assert.equal(next.formValidation, null);
  assert.equal(next.latestFormRequiresRegeneration, true);
  assert.deepEqual(next.latestFormStaleReasons, ['monthly_salary_changed']);
});

test('processo sem formulário não ganha pendência artificial', () => {
  assert.deepEqual(
    invalidateAccountantFormVersion({ status: 'pending' }, 'expected_admission_date_changed', '2026-08-25T04:00:00.000Z'),
    { status: 'pending' },
  );
});

test('alteração de qualquer campo revisado invalida o PDF anterior', () => {
  const next = invalidateAccountantFormVersion(
    { latestFormId: 'form-2', formValidation: { documentId: 'form-2' } },
    'reviewed_form_data_changed',
    '2026-08-25T05:00:00.000Z',
  );
  assert.equal(next.latestFormRequiresRegeneration, true);
  assert.equal(next.formValidation, null);
  assert.deepEqual(next.latestFormStaleReasons, ['reviewed_form_data_changed']);
});
