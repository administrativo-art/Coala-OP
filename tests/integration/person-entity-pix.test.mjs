import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { financialDbAdmin } = await import('../../src/lib/firebase-financial-admin.ts');
const { collectPersonSource, preparePersonInventory } = await import('../../src/features/privacy/person-inventory.server.ts');
const { resolveStrictPersonRefs } = await import('../../src/features/privacy/person-subject.ts');
const { firestorePersonLookup } = await import('../../src/features/privacy/person-lookup.server.ts');

test('entity PF discovery uses exact ID, separates actors and denies PJ or unrelated scope', async (t) => {
  const id = 'pix-person-entity';
  const actorId = 'pix-person-operator';
  const pfRef = { namespace: 'main.entities', id };
  const actor = { isDefaultAdmin: false, workspace_id: 'coala', userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['unit-a'] },
    permissions: { financial: { view: true, expenses: { view: true }, paymentRequests: { view: true }, personnelCosts: { view: true } } } };
  const admin = { ...actor, isDefaultAdmin: true };
  const indication = { purchaseOrderId: 'demo-order', supplierEntityId: 'demo-fiscal-pj',
    supplierTaxId: '12345678000100', beneficiaryEntityId: id, unitId: 'unit-a',
    amountCents: 1500, invoiceAccessKey: '1'.repeat(44), orderFingerprint: 'demo-fingerprint',
    reason: 'Indicacao autorizada', evidence: 'Nota de demonstracao', confirmedBy: actorId,
    confirmedAt: '2026-11-23T00:00:00.000Z' };
  const indicatedExpense = { workspaceId: 'coala', unitId: 'unit-a', originModule: 'purchasing',
    purchaseExpenseRole: 'goods', purchaseOrderId: 'demo-order', supplierId: 'demo-fiscal-pj',
    billingIdentity: { supplierTaxId: indication.supplierTaxId }, purchaseInvoiceAccessKey: indication.invoiceAccessKey,
    totalValue: 15, purchasePixIndication: indication };
  const indicatedRequest = { workspaceId: 'coala', sourceType: 'expense_supplier_pix',
    sourceId: 'pix-person-indicated-expense', expenseId: 'pix-person-indicated-expense', amount: 15,
    beneficiaryReference: { sourceType: 'entity', sourceId: id }, purchasePixIndication: indication,
    purchasePixSource: { purchaseOrderId: indication.purchaseOrderId, supplierEntityId: indication.supplierEntityId,
      supplierTaxId: indication.supplierTaxId, unitId: indication.unitId, amountCents: indication.amountCents,
      orderFingerprint: indication.orderFingerprint } };
  const docs = [
    [dbAdmin, 'entities', id, { type: 'pessoa_fisica', workspaceId: 'coala', name: 'Mesmo Nome', document: '00000000000', updatedBy: actorId }],
    [dbAdmin, 'entities', 'pix-person-pj', { type: 'pessoa_juridica', workspaceId: 'coala', name: 'Mesmo Nome' }],
    [dbAdmin, 'entities', 'pix-person-foreign', { type: 'pessoa_fisica', workspaceId: 'foreign' }],
    [dbAdmin, 'users', id, { workspaceId: 'coala', unitIds: ['unit-a'], username: 'Mesmo Nome' }],
    [dbAdmin, 'users', 'pix-person-pj', { workspaceId: 'coala', unitIds: ['unit-a'], username: 'Mesmo Nome' }],
    [dbAdmin, 'users', actorId, { workspaceId: 'coala', unitIds: ['unit-a'] }],
    [hrDbAdmin, 'employees', id, { workspaceId: 'coala' }],
    [hrDbAdmin, 'employees', 'pix-person-pj', { workspaceId: 'coala' }],
    [financialDbAdmin, 'supplierPaymentProfiles', id, { entityId: id, validatedBy: actorId }],
    [financialDbAdmin, 'expenses', 'pix-person-good', { workspaceId: 'coala', unitId: 'unit-a', supplierId: id, createdBy: actorId }],
    [financialDbAdmin, 'expenses', 'pix-person-other-unit', { workspaceId: 'coala', unitId: 'unit-b', supplierId: id }],
    [financialDbAdmin, 'expenses', 'pix-person-other-workspace', { workspaceId: 'foreign', unitId: 'unit-a', supplierId: id }],
    [financialDbAdmin, 'expenses', 'pix-person-legacy', { workspaceId: 'coala', unitId: 'unit-a', billingIdentity: { supplierTaxId: '00000000000' } }],
    [financialDbAdmin, 'expenses', 'pix-person-indicated-expense', indicatedExpense],
    [financialDbAdmin, 'expenses', 'pix-person-forged-expense', { ...indicatedExpense, purchaseOrderId: 'other-order' }],
    [financialDbAdmin, 'bankPaymentRequests', 'pix-person-request', { workspaceId: 'coala', sourceType: 'expense_supplier_pix', sourceId: 'pix-person-good', expenseId: 'pix-person-good', beneficiaryReference: { sourceType: 'entity', sourceId: id }, createdBy: actorId }],
    [financialDbAdmin, 'bankPaymentRequests', 'pix-person-wrong-origin', { workspaceId: 'coala', sourceType: 'vacation', sourceId: 'pix-person-good', expenseId: 'pix-person-good', beneficiaryReference: { sourceType: 'entity', sourceId: id } }],
    [financialDbAdmin, 'bankPaymentRequests', 'pix-person-wrong-unit', { workspaceId: 'coala', sourceType: 'expense_supplier_pix', sourceId: 'pix-person-other-unit', expenseId: 'pix-person-other-unit', beneficiaryReference: { sourceType: 'entity', sourceId: id } }],
    [financialDbAdmin, 'bankPaymentRequests', 'pix-person-wrong-workspace', { workspaceId: 'foreign', sourceType: 'expense_supplier_pix', sourceId: 'pix-person-good', expenseId: 'pix-person-good', beneficiaryReference: { sourceType: 'entity', sourceId: id } }],
    [financialDbAdmin, 'bankPaymentRequests', 'pix-person-unrelated', { workspaceId: 'coala', sourceType: 'expense_supplier_pix', sourceId: 'pix-person-good', expenseId: 'pix-person-good', beneficiaryReference: { sourceType: 'employee', sourceId: id } }],
    [financialDbAdmin, 'bankPaymentRequests', 'pix-person-indicated-request', indicatedRequest],
    [financialDbAdmin, 'bankPaymentRequests', 'pix-person-forged-request', { ...indicatedRequest,
      sourceId: 'pix-person-forged-expense', expenseId: 'pix-person-forged-expense' }],
    [financialDbAdmin, 'bankPaymentRequests/pix-person-indicated-request/events', 'pix-person-indicated-event',
      { type: 'PAYMENT_REQUEST_CREATED', purchasePixIndication: indication, actorId }],
  ];
  t.after(async () => { await Promise.all(docs.map(([db, collection, key]) => db.collection(collection).doc(key).delete())); });
  await Promise.all(docs.map(([db, collection, key, value]) => db.collection(collection).doc(key).set(value)));

  const resolved = await resolveStrictPersonRefs(pfRef, firestorePersonLookup);
  assert.deepEqual(resolved, { refs: [pfRef], conflicts: [] });
  assert.deepEqual((await preparePersonInventory(actor, pfRef)).resolution.refs, [pfRef]);
  for (const denied of ['pix-person-pj', 'pix-person-foreign']) {
    await assert.rejects(preparePersonInventory(actor, { namespace: 'main.entities', id: denied }), { code: 'PERSON_SCOPE_UNCONFIRMED' });
  }
  const read = (sourceId, ref = pfRef, context = actor) => collectPersonSource({ actor: context, sourceId, ref, limit: 25 });
  assert.deepEqual((await read('entity-persons')).items.map((item) => item.id), [id]);
  assert.deepEqual((await read('supplier-payment-profile-entity-persons')).items.map((item) => item.id), [id]);
  await financialDbAdmin.collection('supplierPaymentProfiles').doc(id).update({ entityId: 'another-entity' });
  assert.deepEqual((await read('supplier-payment-profile-entity-persons')).items, []);
  assert.deepEqual((await read('financial-entity-person-expenses')).items.map((item) => item.id), ['pix-person-good']);
  assert.deepEqual((await read('financial-purchase-pix-receivers')).items.map((item) => item.id), ['pix-person-indicated-expense']);
  const requests = await read('financial-entity-person-pix-requests');
  assert.deepEqual(requests.items.map((item) => item.id).sort(), ['pix-person-indicated-request', 'pix-person-request'], JSON.stringify({ status: requests.status, reason: requests.reason }));
  assert.equal((await read('financial-expense-creators')).status, 'unlinked');
  assert.deepEqual((await read('financial-expense-creators', { namespace: 'main.users', id: actorId }, admin)).items.map((item) => item.id), ['pix-person-good']);
  for (const [sourceId, expected] of [
    ['financial-purchase-pix-expense-confirmers', 'pix-person-indicated-expense'],
    ['financial-purchase-pix-request-confirmers', 'pix-person-indicated-request'],
    ['financial-purchase-pix-event-confirmers', 'pix-person-indicated-event'],
  ]) {
    assert.deepEqual((await read(sourceId, { namespace: 'main.users', id: actorId }, admin)).items.map((item) => item.id), [expected], sourceId);
  }
  assert.equal((await read('financial-entity-person-expenses', { namespace: 'main.users', id }, admin)).status, 'unlinked');
  assert.equal((await read('financial-entity-person-expenses', { namespace: 'hr.employees', id }, admin)).status, 'unlinked');
});
