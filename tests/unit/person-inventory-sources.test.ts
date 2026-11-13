import assert from 'node:assert/strict';
import test from 'node:test';
import { PERSON_SOURCES, sourceById } from '../../src/features/privacy/person-inventory';
import { canViewPersonSource, canViewPersonRecord } from '../../src/features/privacy/person-inventory.server';

test('every registered source declares an exact namespace, field, role and honest coverage', () => {
  assert.equal(new Set(PERSON_SOURCES.map((source) => source.id)).size, PERSON_SOURCES.length);
  for (const source of PERSON_SOURCES) {
    assert.ok(['main', 'hr', 'financial', 'rep-p'].includes(source.database));
    assert.ok(source.collection && source.field && source.namespace);
    assert.ok(source.permissionPolicy && source.scopePolicy);
    assert.ok(['source-policy', 'document-policy', 'rep-p-statutory', 'financial-policy', 'privacy-ttl', 'audit-ttl', 'cursor-ttl'].includes(source.retention));
    assert.ok(['subject', 'owner', 'actor', 'signer', 'participant'].includes(source.role));
    assert.ok(['main.users', 'hr.employees', 'hr.candidates', 'hr.onboardingPersons', 'subjectKeys'].includes(source.namespace));
    assert.ok(source.coverage === 'live' || source.coverage === 'legacy_gap' && source.reason);
    assert.equal(sourceById(source.id), source);
  }
  assert.equal(sourceById('not-registered'), undefined);
  assert.equal(sourceById('generated-document-actors')?.role, 'actor');
  assert.equal(sourceById('signature-signers')?.role, 'signer');
  assert.equal(sourceById('signature-actors')?.role, 'actor');
  assert.equal(sourceById('signature-actors')?.scopePolicy, 'admin-global');
  assert.equal(sourceById('generated-documents')?.role, 'subject');
  assert.equal(sourceById('schedule-shift-subjects')?.field, 'userId');
  assert.equal(sourceById('schedule-shift-subjects')?.parentCollection, 'dp_schedules');
  assert.equal(sourceById('schedule-responsibility-subjects')?.role, 'subject');
  assert.equal(sourceById('schedule-publishers')?.role, 'actor');
});
test('unknown permission policy denies by default', () => {
  const actor = { isDefaultAdmin: false, permissions: { dp: { collaborators: { view: true } } }, userDoc: { unitAccessScope: 'all' } } as Parameters<typeof canViewPersonSource>[0];
  const source = { ...PERSON_SOURCES[0], permissionPolicy: 'unknown' } as unknown as Parameters<typeof canViewPersonSource>[1];
  assert.equal(canViewPersonSource(actor, source), false);
  assert.equal(canViewPersonSource(actor, PERSON_SOURCES[0]), true);
});


test('unknown policy and scope deny even default admin; express location grant precedes admin bypass', () => {
  const admin = { isDefaultAdmin: true, permissions: {}, userDoc: {}, workspace_id: 'w' } as Parameters<typeof canViewPersonSource>[0];
  for (const field of ['permissionPolicy', 'scopePolicy'] as const) {
    const unknown = { ...PERSON_SOURCES[0], [field]: 'unknown' } as unknown as Parameters<typeof canViewPersonSource>[1];
    assert.equal(canViewPersonSource(admin, unknown), false);
    assert.equal(canViewPersonRecord(admin, unknown, { workspaceId: 'w' }), false);
  }
  assert.equal(canViewPersonSource(admin, sourceById('rep-p-journey-location')!), false);
  assert.equal(sourceById('rep-p-journey-location')!.database, 'hr');
});
test('record ACL uses native execution fields, every adjustment unit, and no financial operational unit', () => {
  const actor = { isDefaultAdmin: false, permissions: { dp: { timeRecording: { view: true } }, financial: { view: true, personnelCosts: { view: true } } }, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['A'] }, workspace_id: 'w' } as Parameters<typeof canViewPersonSource>[0];
  const receipt = sourceById('rep-p-receipts')!;
  assert.equal(canViewPersonRecord(actor, receipt, { snapshot: { executionUnitId: 'B' }, unitId: 'A' }), false);
  assert.equal(canViewPersonRecord(actor, receipt, { snapshot: { executionUnitId: 'A' } }), true);
  assert.equal(canViewPersonRecord(actor, receipt, { unitId: 'A' }), false);
  const adjustment = sourceById('rep-p-adjustments')!;
  assert.equal(canViewPersonRecord(actor, adjustment, { unitId: 'A', unitIds: ['A', 'B'] }), false);
  assert.equal(canViewPersonRecord(actor, adjustment, { unitIds: ['A'] }), true);
  assert.equal(canViewPersonSource(actor, sourceById('financial-vacation-payments')!), false);
  const financial = { ...actor, permissions: { financial: { view: true, personnelCosts: { view: true }, paymentRequests: { view: true } } } } as typeof actor;
  assert.equal(canViewPersonRecord(financial, sourceById('financial-vacation-payments')!, { workspaceId: 'w', unitId: 'result-center-B' }), true);
});
