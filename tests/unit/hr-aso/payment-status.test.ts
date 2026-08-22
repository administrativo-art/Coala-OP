import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { shouldPollAsoPayment } from '../../../src/features/hr/aso/payment-status';

describe('acompanhamento do pagamento do ASO', () => {
  test('acompanha automaticamente todos os estados transitórios', () => {
    for (const status of [
      'awaiting_financial_authorization',
      'ready_to_submit',
      'submitting',
      'awaiting_bank_approval',
      'processing',
    ] as const) {
      assert.equal(shouldPollAsoPayment('payment-1', status), true, status);
    }
  });

  test('encerra o acompanhamento ao receber um resultado final', () => {
    for (const status of ['paid', 'rejected', 'approval_expired', 'failed', 'cancelled'] as const) {
      assert.equal(shouldPollAsoPayment('payment-1', status), false, status);
    }
    assert.equal(shouldPollAsoPayment(null, 'processing'), false);
  });
});
