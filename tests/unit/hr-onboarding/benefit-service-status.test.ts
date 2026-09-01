import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTransportVoucherServiceStatus } from '../../../src/features/hr/onboarding/benefit-service-status';

test('vale-transporte recusado fica informado como não solicitado', () => {
  assert.deepEqual(resolveTransportVoucherServiceStatus({
    needsTransportVoucher: false,
    publicAnswer: 'no',
    recordedCompleted: false,
  }), {
    completed: true,
    notApplicable: true,
    description: 'Não solicitado pela colaboradora.',
  });
});

test('decisão final salva prevalece sobre a resposta original', () => {
  assert.equal(resolveTransportVoucherServiceStatus({
    needsTransportVoucher: true,
    publicAnswer: 'no',
    recordedCompleted: false,
  }).notApplicable, false);
});

test('cadastro solicitado continua dependendo da confirmação operacional', () => {
  const pending = resolveTransportVoucherServiceStatus({
    needsTransportVoucher: true,
    publicAnswer: 'yes',
    recordedCompleted: false,
  });
  const completed = resolveTransportVoucherServiceStatus({
    needsTransportVoucher: true,
    publicAnswer: 'yes',
    recordedCompleted: true,
  });

  assert.equal(pending.completed, false);
  assert.equal(completed.completed, true);
});
