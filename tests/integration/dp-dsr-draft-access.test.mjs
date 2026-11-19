import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository', databaseId: 'coala' });
const { dbAdmin: db } = await import('../../src/lib/firebase-admin.ts');
const { WORKSPACE_ID } = await import('../../src/lib/workspace.ts');
const { stageScheduleDayOff } = await import('../../src/features/dp/schedules/publication-service.server.ts');
const { dayOffOperationRef } = await import('../../src/features/dp/day-offs/service.server.ts');
const refs = [];
test.after(async () => { await Promise.all(refs.map(ref => db.recursiveDelete(ref))); });
async function fixture(key, scope = {}) {
 const unitId = `dsr-access-${key}-unit`, userId = `dsr-access-${key}-person`;
 const schedule = db.collection('dp_schedules').doc(`dsr-access-${key}-schedule`);
 const unit = db.collection('dp_units').doc(unitId), user = db.collection('users').doc(userId);
 refs.push(schedule, unit, user);
 await Promise.all([schedule.set({ unitId, year: 2027, month: 11, shiftCount: 0, publicationStatus: 'draft', publicationVersion: 0, ...scope }),
  unit.set({ name: 'Synthetic Unit', isArchived: false }),
  user.set({ username: 'Synthetic Person', unitId, unitIds: [unitId], isActive: true, registrationIdBizneo: '12345' })]);
 const context = { decoded: { uid: 'dsr-access-editor' }, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: [unitId] },
  permissions: { dp: { schedules: { view: true, edit: true, publishBizneo: true } } }, isDefaultAdmin: false, workspace_id: WORKSPACE_ID };
 const input = { userId, unitId, date: '2027-11-10', action: 'add', expectedDraftVersion: 0 };
 return { schedule, unitId, userId, context, input };
}

test('DSR rascunho: escala legada sem workspace explícito aceita editor da unidade no workspace configurado, sem publicar', async () => {
 const f = await fixture('legacy');
 const result = await stageScheduleDayOff(f.context, f.schedule.id, f.input, 'dsr-legacy-add');
 const drafts = await f.schedule.collection('draftEdits').get();
 assert.equal(drafts.size, 1);assert.equal(drafts.docs[0].get('shiftId'), result.shiftId);assert.equal(drafts.docs[0].get('value.dayOffDraft'), true);
 assert.equal((await f.schedule.collection('shifts').get()).size, 0);
 assert.equal((await dayOffOperationRef(WORKSPACE_ID, f.userId, f.input.date).get()).exists, false);
 assert.equal((await f.schedule.get()).get('workspaceId'), undefined);
 await stageScheduleDayOff(f.context, f.schedule.id, { ...f.input, action: 'remove', expectedDraftVersion: 1 }, 'dsr-legacy-remove');
 assert.equal((await f.schedule.collection('draftEdits').get()).size, 0);
});

test('DSR rascunho: workspace explícito válido permanece suportado', async () => {
 const f = await fixture('explicit', { workspaceId: WORKSPACE_ID });
 await stageScheduleDayOff(f.context, f.schedule.id, f.input, 'dsr-explicit');
 assert.equal((await f.schedule.collection('draftEdits').get()).size, 1);
});

test('DSR rascunho: legado não é aceito em outro workspace e campo explícito estrangeiro/malformado não vira fallback', async () => {
 const f = await fixture('foreign');
 await assert.rejects(stageScheduleDayOff({ ...f.context, workspace_id: `${WORKSPACE_ID}-other` }, f.schedule.id, f.input, 'dsr-other'), { code: 'DP_SCHEDULE_DRAFT_SCOPE_INVALID' });
 for (const workspaceId of [`${WORKSPACE_ID}-other`, '', null, 1]) {
  await f.schedule.update({ workspaceId });
  await assert.rejects(stageScheduleDayOff(f.context, f.schedule.id, f.input, 'dsr-malformed'), { code: 'DP_SCHEDULE_DRAFT_SCOPE_INVALID' });
 }
 assert.equal((await f.schedule.collection('draftEdits').get()).size, 0);
});

test('DSR rascunho: compatibilidade não dispensa permissão nem ACL da unidade', async () => {
 const f = await fixture('acl');
 await assert.rejects(stageScheduleDayOff({ ...f.context, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['another'] } }, f.schedule.id, f.input, 'dsr-unit'), { code: 'DP_SCHEDULE_UNIT_FORBIDDEN' });
 await assert.rejects(stageScheduleDayOff({ ...f.context, permissions: { dp: { schedules: { view: true, edit: false, publishBizneo: true } } } }, f.schedule.id, f.input, 'dsr-permission'), { code: 'DP_DAY_OFF_PUBLISH_FORBIDDEN' });
 assert.equal((await f.schedule.collection('draftEdits').get()).size, 0);
});

test('DSR rascunho: mudança concorrente do workspace é revalidada dentro da transação', async () => {
 const f = await fixture('race');
 const original = db.runTransaction.bind(db);let injected = false;
 db.runTransaction = async (...args) => { injected = true; await f.schedule.update({ workspaceId: `${WORKSPACE_ID}-other` });return original(...args); };
 try { await assert.rejects(stageScheduleDayOff(f.context, f.schedule.id, f.input, 'dsr-race'), { code: 'DP_SCHEDULE_DRAFT_SCOPE_INVALID' }); }
 finally { db.runTransaction = original; }
 assert.equal(injected, true);assert.equal((await f.schedule.collection('draftEdits').get()).size, 0);
});
