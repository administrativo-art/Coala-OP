import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { resolveEmploymentReferenceForSystem, readEmploymentReference } = await import('../../src/features/dp/employment-reference/service.server.ts');

test('ponto resolve operações pela vigência do cadastro e preserva empregador da referência contratual', async () => {
  const workspaceId = 'coala-one';
  const userId = 'operational-unit-periods-integration';
  const head = createHash('sha256').update(JSON.stringify([workspaceId, userId])).digest('hex');
  const historyId = `${head}_r1`;
  const person = dbAdmin.collection('users').doc(userId);
  const headRef = dbAdmin.collection('dp_employmentReferenceHeads').doc(head);
  const history = dbAdmin.collection('dp_employmentReferenceHistories').doc(historyId);
  try {
    await Promise.all([
      person.set({ unitId: 'tirirical', unitIds: ['tirirical'], assignedKioskIds: ['outra'], operationalUnitPeriods: [
        { validFrom: '2026-10-22', validTo: '2026-10-31', unitIds: ['tirirical', 'matriz'] },
        { validFrom: '2026-11-01', unitIds: ['matriz'] },
      ] }),
      headRef.set({ revision: 1, historyId }),
      history.set({ workspaceId, userId, revision: 1, historyId, periods: [{
        validFrom: '2026-01-01', employmentRelationshipType: 'clt', employerUnitId: 'tirirical', unitId: 'tirirical', unitIds: ['tirirical'],
        jobFunctionIds: [], jobFunctionNames: [], jobRoleName: null,
        sourceDocumentId: 'synthetic-document', sourceReason: 'Documento sintético para emulador',
        employer: { unitId: 'tirirical', unitName: 'Empregadora de teste', cnpj: '14276603000125', address: 'Endereço sintético', identityStatus: 'catalog_identifiers_consistent_unverified' },
      }] }),
    ]);
    const resolve = (date) => resolveEmploymentReferenceForSystem({ workspaceId, userId, date });
    const october = await resolve('2026-10-31');
    assert.equal(october.status, 'matched');
    assert.deepEqual(october.period.unitIds, ['tirirical', 'matriz']);
    assert.equal(october.period.employerUnitId, 'tirirical');
    assert.equal(october.period.unitId, 'tirirical');
    assert.deepEqual((await resolve('2026-11-01')).period.unitIds, ['matriz']);
    assert.deepEqual((await resolve('2026-10-21')).period.unitIds, ['tirirical']);
    assert.equal(october.operationalUnitReference.validFrom, '2026-10-22');
    assert.match(october.operationalUnitReference.hash, /^[a-f0-9]{64}$/);
    const explicit = await readEmploymentReference({ isDefaultAdmin: true, decoded: { uid: 'synthetic-admin' },
      permissions: { dp: { collaborators: {} }, settings: {} }, userDoc: {}, workspace_id: workspaceId },
    { userId, date: '2026-10-31', revision: 1 });
    assert.deepEqual(explicit.period.unitIds, ['tirirical']);
    assert.equal(explicit.operationalUnitReference, undefined);
    await person.update({ contractualDataPeriods: [
      { validFrom: '2026-10-22', validTo: '2026-10-30', changeId: 'applied', fields: { unitId: 'tirirical' } },
      { validFrom: '2026-10-31', changeId: 'pending', fields: { unitId: 'matriz' } },
    ], scheduledContractChange: { id: 'pending', activationStatus: 'conflict' } });
    assert.equal((await resolve('2026-10-31')).period.unitId, 'tirirical');
    await person.update({ scheduledContractChange: null });
    assert.equal((await resolve('2026-10-31')).period.unitId, 'matriz');
    await person.update({ contractualDataPeriods: [{ validFrom: '2026-10-31', changeId: 'empty-financial', fields: { unitId: null } }] });
    assert.equal((await resolve('2026-10-31')).status, 'inconsistent');
    await person.update({ operationalUnitPeriods: [], contractualDataPeriods: [] });
    assert.equal((await resolve('2026-10-31')).status, 'gap');
    assert.deepEqual((await history.get()).get('periods')[0].unitIds, ['tirirical']);
  } finally { await Promise.all([person.delete(), headRef.delete(), history.delete()]); }
});
