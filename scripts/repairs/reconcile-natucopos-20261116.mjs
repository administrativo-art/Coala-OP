import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

// Reparação delimitada: pedido antigo sem pagamento substituído pela NF-e 22.930.
// Executar sem --apply primeiro. O código implantado deve bloquear a ressíncronização
// quando financialSupersededByOrderId estiver preenchido.
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulador não é o alvo desta reparação.');
const apply = process.argv.includes('--apply');
const app = initializeApp({ credential: applicationDefault(), projectId: 'smart-converter-752gf' }, 'natucopos-financial-repair');
const main = getFirestore(app, 'coala');
const financial = getFirestore(app, 'coala-financeiro');
const oldOrderId = 'orcamento-melo-copos-20260915';
const newOrderId = 'qgCnf0qLVdEhXyfAsF6F';
const oldExpenseId = `purchase_goods_${oldOrderId}`;
const newExpenseId = `purchase_goods_${newOrderId}`;
const reason = 'Pedido de orçamento substituído financeiramente pelo pedido da NF-e 22.930; nenhuma parcela antiga foi paga. Estoque preservado após conferência do operador.';
const oldOrderRef = main.collection('purchase_orders').doc(oldOrderId);
const newOrderRef = main.collection('purchase_orders').doc(newOrderId);
const oldExpenseRef = financial.collection('expenses').doc(oldExpenseId);
const newExpenseRef = financial.collection('expenses').doc(newExpenseId);
const [oldOrderSnap, newOrderSnap, oldExpenseSnap, newExpenseSnap, financialsSnap] = await Promise.all([
  oldOrderRef.get(), newOrderRef.get(), oldExpenseRef.get(), newExpenseRef.get(),
  main.collection('purchase_financials').where('purchaseOrderId', '==', oldOrderId).limit(6).get(),
]);
const oldOrder = oldOrderSnap.data();
const newOrder = newOrderSnap.data();
const oldExpense = oldExpenseSnap.data();
const newExpense = newExpenseSnap.data();
if (!oldOrder || !newOrder || !oldExpense || !newExpense) throw new Error('Registro esperado ausente.');
if (financialsSnap.size !== 1) throw new Error(`Esperado um financeiro antigo; encontrados ${financialsSnap.size}.`);
if (oldOrder.status !== 'confirmed' || newOrder.status !== 'confirmed'
  || oldOrder.linkedExpenseId !== oldExpenseId || newOrder.linkedExpenseId !== newExpenseId
  || newOrder.invoiceNumber !== '000022930' || String(newOrder.invoiceAccessKey ?? '').length !== 44
  || Math.round(Number(oldOrder.totalEstimated) * 100) !== 334356
  || Math.round(Number(newOrder.totalEstimated) * 100) !== 334356) {
  throw new Error('Identidade ou valor dos pedidos divergiu.');
}
if (oldOrder.financialSupersededByOrderId && oldOrder.financialSupersededByOrderId !== newOrderId) {
  throw new Error('Pedido antigo já foi substituído por outro pedido.');
}
if (oldExpense.status !== 'pending' && oldExpense.status !== 'cancelled') throw new Error('Situação da despesa antiga mudou.');
if (newExpense.status !== 'pending') throw new Error('Situação da despesa da NF-e mudou.');
if (oldExpense.paidAt || oldExpense.bankReconciledAt || oldExpense.linkedBankTransactionId
  || oldExpense.paymentRequestId || (oldExpense.paymentRequestIds ?? []).length
  || (oldExpense.installments ?? []).some((part) => part.status !== 'pending' && part.status !== 'cancelled')) {
  throw new Error('Há evidência de liquidação na despesa antiga.');
}
const financialRecord = financialsSnap.docs[0];
if (financialRecord.get('paidAt') || !['confirmed', 'cancelled'].includes(financialRecord.get('status'))) {
  throw new Error('O acompanhamento financeiro antigo mudou ou foi pago.');
}
const relationQueries = [
  ['paymentRequests.expenseId', financial.collection('paymentRequests').where('expenseId', '==', oldExpenseId)],
  ['expectedBankDebits.expenseId', financial.collection('expectedBankDebits').where('expenseId', '==', oldExpenseId)],
  ['transactions.expenseId', financial.collection('transactions').where('expenseId', '==', oldExpenseId)],
  ['transactions.linkedExpenseId', financial.collection('transactions').where('linkedExpenseId', '==', oldExpenseId)],
  ['bankStatementEvents.linkedExpenseId', financial.collection('bankStatementEvents').where('linkedExpenseId', '==', oldExpenseId)],
];
for (const [label, query] of relationQueries) {
  const found = await query.limit(1).get();
  if (!found.empty) throw new Error(`Há vínculo bancário em ${label}: ${found.docs[0].id}.`);
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', oldOrderId, newOrderId, oldExpenseId, newExpenseId,
  oldExpenseStatus: oldExpense.status, newExpenseStatus: newExpense.status,
  oldFinancialStatus: financialRecord.get('status'), amountCents: 334356, bankLinks: 0 }));
if (!apply) process.exit(0);

const now = Timestamp.now();
const at = now.toDate().toISOString();
await main.runTransaction(async (tx) => {
  const snapshot = await tx.get(oldOrderRef);
  if (snapshot.get('financialSupersededByOrderId') && snapshot.get('financialSupersededByOrderId') !== newOrderId) {
    throw new Error('Substituição concorrente.');
  }
  tx.update(oldOrderRef, {
    financialSupersededByOrderId: newOrderId,
    financialSupersededAt: snapshot.get('financialSupersededAt') ?? at,
    financialSupersededReason: reason,
    updatedAt: at,
  });
});
await financial.runTransaction(async (tx) => {
  const snapshot = await tx.get(oldExpenseRef);
  const expense = snapshot.data();
  if (!expense || !['pending', 'cancelled'].includes(expense.status) || expense.paidAt || expense.linkedBankTransactionId) {
    throw new Error('Despesa mudou durante a reparação.');
  }
  tx.update(oldExpenseRef, {
    status: 'cancelled', originStatus: 'superseded_by_purchase_order',
    supersededByPurchaseOrderId: newOrderId, supersededByExpenseId: newExpenseId,
    cancelledAt: expense.cancelledAt ?? now, cancelledBy: 'codex-nemo-operator-request-20261116',
    cancelledReason: reason,
    installments: (expense.installments ?? []).map((part) => ({ ...part, status: 'cancelled' })),
    updatedAt: now,
  });
});
await main.runTransaction(async (tx) => {
  const snapshot = await tx.get(financialRecord.ref);
  if (!snapshot.exists || !['confirmed', 'cancelled'].includes(snapshot.get('status')) || snapshot.get('paidAt')) {
    throw new Error('Acompanhamento financeiro mudou durante a reparação.');
  }
  tx.update(financialRecord.ref, {
    status: 'cancelled', cancelledAt: snapshot.get('cancelledAt') ?? at,
    cancelledBy: 'codex-nemo-operator-request-20261116', cancelReason: reason,
    financialSupersededByOrderId: newOrderId, updatedAt: at,
  });
});
const [afterOrder, afterExpense, afterFinancial] = await Promise.all([
  oldOrderRef.get(), oldExpenseRef.get(), financialRecord.ref.get(),
]);
if (afterOrder.get('financialSupersededByOrderId') !== newOrderId
  || afterExpense.get('status') !== 'cancelled'
  || afterFinancial.get('status') !== 'cancelled') {
  throw new Error('Verificação final incompleta.');
}
console.log(JSON.stringify({ verified: true, oldOrderId, oldExpenseStatus: afterExpense.get('status'), oldFinancialStatus: afterFinancial.get('status') }));
