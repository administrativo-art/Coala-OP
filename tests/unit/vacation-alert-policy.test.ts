import assert from 'node:assert/strict';
import test from 'node:test';

import { vacationWorkflowAlerts } from '../../functions/src/vacation-alert-policy';

test('gera alertas para aviso, pagamento e assinatura do recibo nos marcos definidos', () => {
  const notice = vacationWorkflowAlerts({
    status: 'active',
    updatedAt: '2026-09-01T10:00:00.000Z',
    legalAnalysis: { noticeDeadline: '2026-09-12', paymentDeadline: '2026-10-10' },
    notice: { status: 'validated' },
    accountant: { status: 'not_started' },
    receipt: { status: 'not_received' },
    payment: { status: 'not_started' },
    receiptSignature: { status: 'blocked_until_payment' },
  }, '2026-09-10');
  assert.deepEqual(notice.map((alert) => alert.kind), ['notice_due']);

  const paymentAndReceipt = vacationWorkflowAlerts({
    status: 'active',
    updatedAt: '2026-09-01T10:00:00.000Z',
    legalAnalysis: { noticeDeadline: '2026-08-01', paymentDeadline: '2026-09-11' },
    notice: { status: 'signed' },
    accountant: { status: 'completed' },
    receipt: { status: 'approved' },
    payment: { status: 'paid', paidAt: '2026-09-08T10:00:00.000Z' },
    receiptSignature: { status: 'sent' },
  }, '2026-09-10');
  assert.deepEqual(paymentAndReceipt.map((alert) => alert.kind), ['receipt_signature_due']);
});

test('não alerta trilhas concluídas ou canceladas', () => {
  assert.deepEqual(vacationWorkflowAlerts({ status: 'cancelled' }, '2026-09-10'), []);
  assert.deepEqual(vacationWorkflowAlerts({ status: 'completed' }, '2026-09-10'), []);
});

test('alerta o prazo de pagamento mesmo quando o recibo ainda bloqueia a preparação', () => {
  const alerts = vacationWorkflowAlerts({
    status: 'active',
    updatedAt: '2026-09-01T10:00:00.000Z',
    legalAnalysis: { noticeDeadline: '2026-08-01', paymentDeadline: '2026-09-11' },
    notice: { status: 'signed', signedAt: '2026-09-10T10:00:00.000Z' },
    accountant: { status: 'sent' },
    receipt: { status: 'not_received' },
    payment: { status: 'not_started' },
    receiptSignature: { status: 'blocked_until_payment' },
  }, '2026-09-10');
  assert.deepEqual(alerts.map((alert) => alert.kind), ['payment_due']);
  assert.match(alerts[0].message, /recibo ainda não foi aprovado/);
});
