import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeSignaturePersonBinding, historicalSignaturePersonKeys, historicalSignatureEmployeeId, validatedPersonKeys } from '../../src/features/privacy/signature-person-history';

test('frozen signature refs bind request, source, hash/path and survive map key ordering', () => {
  const source = { subjectKeys: ['main.users:original'], partyKeys: ['hr.employees:witness'], employeeId: 'original', generatedDocumentId: 'doc1', sourceGeneratedVersion: 1, storagePath: 'signature-documents/doc1/v1/pre-signature.pdf', packageHash: 'a'.repeat(64) };
  const frozen = freezeSignaturePersonBinding('req1', source);
  assert.equal(frozen.personBinding.bindingHash, '7bc41b6fc3759044b942cc8e0552906ec374930cd12f3dcfbc82435dfc464a5d');
  const reordered = { ...frozen, personBinding: Object.fromEntries(Object.entries(frozen.personBinding).reverse()) };
  assert.deepEqual(historicalSignaturePersonKeys('req1', reordered), { subjectKeys: ['main.users:original'], partyKeys: ['hr.employees:witness'] });
  for (const patch of [{ employeeId: 'changed' }, { subjectKeys: ['main.users:changed'] }, { generatedDocumentId: 'other' }, { sourceGeneratedVersion: 2 }, { storagePath: 'other.pdf' }, { packageHash: 'b'.repeat(64) }]) assert.throws(() => historicalSignaturePersonKeys('req1', { ...frozen, ...patch }), /origem ou versão/);
  assert.throws(() => historicalSignaturePersonKeys('req2', frozen), /origem ou versão/);
  assert.throws(() => historicalSignaturePersonKeys('req1', { ...source, subjectKeys: [] }), /legada/);
  assert.deepEqual(historicalSignaturePersonKeys('req1', source).subjectKeys, ['main.users:original']);
});

test('HR signature bindings reject entity counterparties in both subject and party keys', () => {
  const source = { subjectKeys: ['main.users:owner'], partyKeys: ['hr.employees:party'], storagePath: 'signed-documents/test.pdf', packageHash: 'a'.repeat(64) };
  assert.deepEqual(validatedPersonKeys(['main.users:a', 'hr.employees:b', 'hr.candidates:c', 'hr.onboardingPersons:d']),
    ['main.users:a', 'hr.employees:b', 'hr.candidates:c', 'hr.onboardingPersons:d']);
  for (const field of ['subjectKeys', 'partyKeys'] as const) {
    for (const bad of ['main.entities:entity', 'future.people:entity']) {
      const changed = { ...source, [field]: [bad] };
      assert.throws(() => freezeSignaturePersonBinding('req-entity', changed), /Referência pessoal histórica inválida/);
      assert.throws(() => historicalSignaturePersonKeys('req-entity', changed), /Referência pessoal histórica inválida/);
    }
  }
  const old = freezeSignaturePersonBinding('req-old', source);
  assert.deepEqual(historicalSignaturePersonKeys('req-old', old), { subjectKeys: source.subjectKeys, partyKeys: source.partyKeys });
});

test('stored signature preflight rejects entity keys before any identity lookup', async () => {
  const { confirmedStoredSubjectKeys } = await import('../../src/features/privacy/person-lookup.server');
  await assert.rejects(confirmedStoredSubjectKeys(['main.entities:entity']), /Referência pessoal histórica inválida/);
});


test('frozen null owner stays absent after source gains an employee; participant refs are preserved', () => {
  const request = freezeSignaturePersonBinding('participant-request', { employeeId: null, subjectKeys: [], partyKeys: ['hr.employees:participant'], generatedDocumentId: 'party-document', storagePath: 'signature-documents/party-document/pre-signature.pdf', packageHash: 'a'.repeat(64) });
  const editedSource = { employeeId: 'later-unrelated-account' };
  assert.equal(historicalSignatureEmployeeId(request, editedSource), null);
  assert.deepEqual(historicalSignaturePersonKeys('participant-request', request), { subjectKeys: [], partyKeys: ['hr.employees:participant'] });
});
