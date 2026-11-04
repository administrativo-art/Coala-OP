import assert from 'node:assert/strict';
import test from 'node:test';

import { signaturePersonFields } from '../../src/features/privacy/signature-person-fields';

test('UID owner remains separate from actor and confirmed company signer', () => {
  assert.deepEqual(signaturePersonFields({
    subject: { namespace: 'main.users', id: 'employee-uid' }, employeeSigns: true,
    companySignerUserId: 'company-uid', actorUserId: 'hr-uid',
  }), {
    subjectKeys: ['main.users:employee-uid'],
    signerKeys: ['main.users:employee-uid', 'main.users:company-uid'],
    actorKeys: ['main.users:hr-uid'],
  });
});

test('employee-only and candidate-only origins keep their namespace without inventing a UID', () => {
  for (const namespace of ['hr.employees', 'hr.candidates'] as const) {
    assert.deepEqual(signaturePersonFields({ subject: { namespace, id: 'same-literal' }, employeeSigns: true }), {
      subjectKeys: [`${namespace}:same-literal`], signerKeys: [`${namespace}:same-literal`], actorKeys: [],
    });
  }
  assert.notDeepEqual(
    signaturePersonFields({ subject: { namespace: 'main.users', id: 'same-literal' } }).subjectKeys,
    signaturePersonFields({ subject: { namespace: 'hr.employees', id: 'same-literal' } }).subjectKeys,
  );
});

test('external PJ signers without an immutable ID are not assigned the process owner ID', () => {
  assert.deepEqual(signaturePersonFields({ subject: { namespace: 'main.users', id: 'process-owner' }, actorUserId: 'requester' }), {
    subjectKeys: ['main.users:process-owner'], signerKeys: [], actorKeys: ['main.users:requester'],
  });
});

test('repeated assembly is stable and duplicate owner/company signer is deduplicated', () => {
  const input = { subject: { namespace: 'main.users' as const, id: 'uid' }, employeeSigns: true, companySignerUserId: 'uid' };
  assert.deepEqual(signaturePersonFields(input), signaturePersonFields(input));
  assert.deepEqual(signaturePersonFields(input).signerKeys, ['main.users:uid']);
});

test('invalid namespace or path segment is rejected at runtime', () => {
  assert.throws(() => signaturePersonFields({ subject: { namespace: 'unknown' as 'main.users', id: 'uid' } }), /Namespace/);
  assert.throws(() => signaturePersonFields({ subject: { namespace: 'main.users', id: 'one\/two' } }), /Identificador/);
});
