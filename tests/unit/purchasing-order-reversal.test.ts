import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getPurchaseStageReversalBlockReason,
  purchaseExpenseHasSettlementEvidence,
} from '../../src/lib/purchasing-order-reversal';

describe('retrocesso da etapa do pedido de compra', () => {
  it('permite retroceder enquanto o recebimento ainda aguarda entrega', () => {
    assert.equal(
      getPurchaseStageReversalBlockReason({
        orderStatus: 'confirmed',
        receipts: [{ status: 'awaiting_delivery' }],
        financials: [{ status: 'confirmed' }],
      }),
      null,
    );
  });

  it('bloqueia depois que a conferência foi iniciada', () => {
    assert.match(
      getPurchaseStageReversalBlockReason({
        orderStatus: 'confirmed',
        receipts: [{ status: 'in_conference', conferenceStartedAt: '2026-09-08T12:00:00.000Z' }],
        financials: [{ status: 'confirmed' }],
      }) ?? '',
      /recebimento já foi iniciado/i,
    );
  });

  it('bloqueia pedidos recebidos ou pagos', () => {
    assert.match(
      getPurchaseStageReversalBlockReason({
        orderStatus: 'confirmed',
        orderReceivedAt: '2026-09-08T12:00:00.000Z',
        receipts: [{ status: 'awaiting_delivery' }],
        financials: [{ status: 'confirmed' }],
      }) ?? '',
      /já foi recebido/i,
    );
    assert.match(
      getPurchaseStageReversalBlockReason({
        orderStatus: 'confirmed',
        receipts: [{ status: 'awaiting_delivery' }],
        financials: [{ status: 'paid' }],
      }) ?? '',
      /pagamento registrado/i,
    );
  });

  it('ignora recebimentos antigos já cancelados', () => {
    assert.equal(
      getPurchaseStageReversalBlockReason({
        orderStatus: 'confirmed',
        receipts: [{ status: 'cancelled', conferenceStartedAt: '2026-09-01T12:00:00.000Z' }],
        financials: [{ status: 'confirmed' }],
      }),
      null,
    );
  });

  it('reconhece pagamento parcial, parcela paga e vínculos bancários', () => {
    assert.equal(purchaseExpenseHasSettlementEvidence({ status: 'partially_paid' }), true);
    assert.equal(
      purchaseExpenseHasSettlementEvidence({
        status: 'pending',
        installments: [{ status: 'paid', paidAt: '2026-09-08T12:00:00.000Z' }],
      }),
      true,
    );
    assert.equal(
      purchaseExpenseHasSettlementEvidence({ status: 'pending', paymentRequestId: 'payment-request-1' }),
      true,
    );
    assert.equal(purchaseExpenseHasSettlementEvidence({ status: 'pending' }), false);
  });
});
