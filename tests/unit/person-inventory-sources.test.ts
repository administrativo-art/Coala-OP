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
    assert.ok(['main.users', 'main.entities', 'hr.employees', 'hr.candidates', 'hr.onboardingPersons', 'subjectKeys'].includes(source.namespace));
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
  for (const id of ['financial-inbox-reviewers', 'financial-inbox-archivers', 'financial-inbox-event-actors', 'financial-expense-creators']) {
    const source = sourceById(id);
    assert.equal(source?.database, 'financial');
    assert.equal(source?.role, 'actor');
    assert.equal(source?.namespace, 'main.users');
    assert.equal(source?.coverage, 'live');
    assert.equal(source?.scopePolicy, 'finance-workspace');
  }
  assert.equal(sourceById('financial-inbox-event-actors')?.parentCollection, 'financialInboxMessages');
  assert.equal(sourceById('financial-inbox-event-actors')?.field, 'actorId');
});
test('unknown permission policy denies by default', () => {
  const actor = { isDefaultAdmin: false, permissions: { dp: { collaborators: { view: true } } }, userDoc: { unitAccessScope: 'all' } } as Parameters<typeof canViewPersonSource>[0];
  const source = { ...PERSON_SOURCES[0], permissionPolicy: 'unknown' } as unknown as Parameters<typeof canViewPersonSource>[1];
  assert.equal(canViewPersonSource(actor, source), false);
  assert.equal(canViewPersonSource(actor, PERSON_SOURCES[0]), true);
});

test('entity person sources are exact and keep supplier, request and actor roles separate', () => {
  for (const [id, collection, field] of [
    ['entity-persons', 'entities', '__name__'],
    ['financial-entity-person-expenses', 'expenses', 'supplierId'],
    ['financial-entity-person-pix-requests', 'bankPaymentRequests', 'beneficiaryReference.sourceId'],
    ['supplier-payment-profile-entity-persons', 'supplierPaymentProfiles', '__name__'],
  ]) {
    const source = sourceById(id)!;
    assert.equal(source.collection, collection);
    assert.equal(source.field, field);
    assert.equal(source.namespace, 'main.entities');
    assert.equal(source.role, 'subject');
    assert.equal(source.permissionPolicy, 'financial-counterparty');
    assert.equal(source.coverage, 'live');
  }
  assert.equal(sourceById('financial-expense-creators')?.namespace, 'main.users');
  assert.equal(sourceById('supplier-payment-profile-validators')?.role, 'actor');
  const actor = { isDefaultAdmin: false, workspace_id: 'w', userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['A'] },
    permissions: { financial: { view: true, expenses: { view: true }, paymentRequests: { view: true } } } } as Parameters<typeof canViewPersonRecord>[0];
  const expense = sourceById('financial-entity-person-expenses')!;
  assert.equal(canViewPersonRecord(actor, expense, { workspaceId: 'w', unitId: 'A' }), true);
  assert.equal(canViewPersonRecord(actor, expense, { workspaceId: 'w', unitId: 'B' }), false);
  assert.equal(canViewPersonRecord(actor, expense, { workspaceId: 'other', unitId: 'A' }), false);
  assert.equal(canViewPersonRecord(actor, expense, { unitId: 'A' }), false);
  assert.equal(canViewPersonSource({ ...actor, permissions: { financial: { view: true, expenses: { view: true } } } } as typeof actor, expense), false);
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

test('atores financeiros da cadeia DRE têm fonte exata e não são sujeitos/beneficiários',()=>{
 const fields={"financial-bank-account-creators":["bankAccounts","createdBy"],"financial-stone-mapping-creators":["stoneMerchantMappings","createdBy"],"financial-stone-mapping-editors":["stoneMerchantMappings","updatedBy"],"financial-daily-sales-reviewers":["dailySalesReviews","reviewedBy"],"financial-daily-sales-closers":["dailySalesReviews","closedBy"],"financial-source-settlement-updaters":["financialSourceSettlements","updatedBy"]};
 for(const [id,[collection,field]] of Object.entries(fields)){const source=sourceById(id);assert.equal(source?.collection,collection);assert.equal(source?.field,field);assert.equal(source?.namespace,"main.users");assert.equal(source?.role,"actor");assert.equal(source?.coverage,"live");assert.equal(source?.permissionPolicy,"financial");assert.equal(source?.scopePolicy,"finance-workspace");}
 for(const [id,parent] of [["financial-acquirer-fee-event-actors","financialAcquirerFeeBatches"],["financial-stone-mapping-event-actors","stoneMerchantMappings"]]){const source=sourceById(id);assert.equal(source?.parentCollection,parent);assert.equal(source?.field,"actorId");assert.equal(source?.role,"actor");assert.equal(source?.scopePolicy,"record-workspace");}
});

test('claim financeiro com workspace aninhado prova o tenant sem aceitar root conflitante ou origem ausente',()=>{
 const source=sourceById("financial-source-settlement-updaters")!;const actor={isDefaultAdmin:true,workspace_id:"coala",permissions:{},userDoc:{}} as Parameters<typeof canViewPersonRecord>[0];
 assert.equal(canViewPersonRecord(actor,source,{source:{workspaceId:"coala"},updatedBy:"actor"}),true);
 assert.equal(canViewPersonRecord(actor,source,{source:{workspaceId:"foreign"}}),false);
 assert.equal(canViewPersonRecord(actor,source,{workspaceId:"foreign",source:{workspaceId:"coala"}}),false);
 assert.equal(canViewPersonRecord(actor,source,{workspaceId:"coala"}),false);
});

test('cabeçalho PIX que admite CPF é pessoal com lacuna explícita, sem equivalência por documento',()=>{
 const source=sourceById("stone-pix-file-owner-identity-gap");assert.equal(source?.collection,"stonePixConciliationFiles");assert.equal(source?.field,"document");assert.equal(source?.role,"subject");assert.equal(source?.coverage,"legacy_gap");assert.equal(source?.namespace,"subjectKeys");assert.match(source?.reason??"",/CPF.*não há ID imutável/);assert.equal(source?.permissionPolicy,"financial");
});

test("XML bruto da carteira permanece lacuna explícita sem identidade inventada",()=>{const source=sourceById("stone-portfolio-raw-xml-identity-gap");assert.equal(source?.collection,"stonePortfolioFiles");assert.equal(source?.field,"xml");assert.equal(source?.coverage,"legacy_gap");assert.equal(source?.namespace,"subjectKeys");assert.match(source?.reason??"",/Consulta por pessoa indisponível/);});
