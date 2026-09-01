import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('src/features/hr/vacations/schemas.ts', 'utf8');
const server = readFileSync('src/features/hr/vacations/server.ts', 'utf8');
const receiptUpload = readFileSync('src/features/hr/vacations/receipt-upload.server.ts', 'utf8');
const receiptSignature = readFileSync('src/features/hr/vacations/payment-completion.server.ts', 'utf8');
const webhook = readFileSync('src/app/api/webhooks/autentique/route.ts', 'utf8');
const paymentService = readFileSync('src/features/financial/payment-requests/service.server.ts', 'utf8');
const interPix = readFileSync('src/lib/integrations/inter/pix-payments.server.ts', 'utf8');
const workflowUi = readFileSync('src/components/dp/dp-vacation-workflow.tsx', 'utf8');

test('auditoria exige decisão, valores confirmados ou motivo de correção', () => {
  assert.match(schema, /review_receipt/);
  assert.match(schema, /decision: z\.enum\(\['approved', 'correction_required'\]\)/);
  assert.match(schema, /Confirme os valores do recibo antes de aprová-lo/);
  assert.match(schema, /Informe o que a contabilidade precisa corrigir/);
  assert.match(server, /workflow\.receipt\.status !== 'review_pending'/);
  assert.match(server, /VACATION_RECEIPT_APPROVED/);
  assert.match(server, /VACATION_RECEIPT_CORRECTION_REQUESTED/);
});

test('arquivo original é imutável, limitado e conferido por hash antes da auditoria', () => {
  assert.match(receiptUpload, /MAX_RECEIPT_BYTES = 15 \* 1024 \* 1024/);
  assert.match(receiptUpload, /preconditionOpts: \{ ifGenerationMatch: 0 \}/);
  assert.match(receiptUpload, /receiptVersions/);
  assert.match(server, /actualHash !== asset\.hashSha256/);
  assert.match(workflowUi, /Abrir recibo original/);
  assert.match(workflowUi, /Leitura automática/);
  assert.match(workflowUi, /Valores conferidos pelo RH/);
});

test('pagamento nasce no fluxo protegido e nunca é autorizado automaticamente pelo RH', () => {
  assert.match(server, /sourceType: 'vacation'/);
  assert.match(paymentService, /const status: BankPaymentRequestStatus = "awaiting_financial_authorization"/);
  assert.match(server, /recipient: \{ strategy: 'financial_pool' \}/);
  assert.match(paymentService, /return request\.sourceType === "termination" \|\| request\.sourceType === "aso" \? submitPaymentRequest\(id, actor\) : request/);
  assert.match(interPix, /dataPagamento: input\.scheduledFor/);
});

test('recibo somente segue para assinatura depois do pagamento confirmado', () => {
  assert.match(receiptSignature, /workflow\.payment\.status !== 'paid'/);
  assert.match(receiptSignature, /DP_VACATION_PAYMENT_NOT_CONFIRMED/);
  assert.match(receiptSignature, /VACATION_PAYMENT_CONFIRMED/);
  assert.match(webhook, /purpose === "vacation_receipt"/);
  assert.match(webhook, /syncVacationReceiptSignatureRequest/);
});

test('RH só encerra a trilha depois do recibo assinado', () => {
  assert.match(server, /workflow\.receiptSignature\.status !== 'signed'/);
  assert.match(server, /DP_VACATION_CLOSURE_NOT_READY/);
  assert.match(server, /VACATION_WORKFLOW_COMPLETED/);
  assert.match(workflowUi, /Finalizar trilha no RH/);
});
