import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { defaultAdminPermissions, defaultGuestPermissions } = await import('../../src/types/index.ts');
const { publishEmploymentReference, readEmploymentHistory, readEmploymentReference } = await import('../../src/features/dp/employment-reference/service.server.ts');

const hash = (value) => createHash('sha256').update(value).digest('hex');

test('publica revisões privadas por CAS, preserva users e resolve lacuna e transferência', async () => {
  const prefix = 'employment-reference-integration';
  const workspaceId = 'coala-one';
  const userId = `${prefix}-user`;
  const employerId = `${prefix}-employer`;
  const originId = `${prefix}-origin`;
  const coverageId = `${prefix}-coverage`;
  const headId = hash(JSON.stringify([workspaceId, userId]));
  const headRef = dbAdmin.collection('dp_employmentReferenceHeads').doc(headId);
  const userRef = dbAdmin.collection('users').doc(userId);
  const units = [employerId, originId, coverageId].map((id) => dbAdmin.collection('dp_units').doc(id));
  const role = hrDbAdmin.collection('jobRoles').doc(`${prefix}-role`);
  const jobFunction = hrDbAdmin.collection('jobFunctions').doc(`${prefix}-function`);
  const requestRef = (id) => dbAdmin.collection('dp_employmentReferenceRequests').doc(hash(JSON.stringify([headId, id])));
  const historyRef = (revision) => dbAdmin.collection('dp_employmentReferenceHistories').doc(`${headId}_r${revision}`);
  const admin = { decoded: { uid: prefix }, userDoc: { id: prefix }, profileId: null,
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: workspaceId };
  const period = (from, to, unitId) => ({ validFrom: from, ...(to ? { validTo: to } : {}),
    employmentRelationshipType: 'clt', employerUnitId: employerId, unitId,
    unitIds: [...new Set([unitId, coverageId])], jobFunctionIds: [],
    sourceDocumentId: 'admission-1', sourceReason: 'Instrumento de admissão conferido',
  });
  const firstPeriods = [period('2026-01-01', '2026-01-31', originId)];
  const revisedPeriods = [...firstPeriods, period('2026-02-02', undefined, coverageId)];
  try {
    await Promise.all([
      units[0].set({ name: 'Empregadora', address: 'Rua de teste, 1', cnpj: 'invalid' }),
      units[1].set({ name: 'Origem' }), units[2].set({ name: 'Cobertura' }),
      userRef.set({ unitId: originId, unitIds: [originId, coverageId], isActive: true, employmentCycleVersion: 7 }),
    ]);
    await assert.rejects(publishEmploymentReference(admin, { userId, expectedRevision: 0, requestId: 'bad-fiscal', periods: firstPeriods }),
      (error) => error.code === 'DP_EMPLOYMENT_FISCAL_PENDING');
    await units[0].update({ cnpj: '14276603000125' });
    const first = await publishEmploymentReference(admin, { userId, expectedRevision: 0, requestId: 'publish-1', periods: firstPeriods });
    assert.equal(first.revision, 1);
    assert.equal(first.replayed, false);
    const firstTimeline = await readEmploymentHistory(admin, { userId });
    assert.equal(firstTimeline.status, 'found');
    assert.equal(firstTimeline.periods.length, 1);
    assert.equal('actorId' in firstTimeline, false);
    assert.deepEqual((await headRef.get()).data(), { revision: 1, historyId: first.historyId });
    const frozen = (await historyRef(1).get()).data();
    assert.equal(frozen.periods[0].employer.cnpj, '14276603000125');
    assert.equal(frozen.observedEmploymentCycleVersion, 7);
    assert.equal((await userRef.get()).get('employmentCycleVersion'), 7);
    await assert.rejects(publishEmploymentReference(admin, { userId, expectedRevision: 1, requestId: 'missing-role',
      periods: [{ ...firstPeriods[0], jobRoleId: role.id }] }),
    (error) => error.code === 'DP_EMPLOYMENT_ROLE_INVALID');
    await Promise.all([role.set({ name: 'Cargo' }), jobFunction.set({ name: 'Função', compatibleRoleIds: ['other-role'] })]);
    await assert.rejects(publishEmploymentReference(admin, { userId, expectedRevision: 1, requestId: 'incompatible',
      periods: [{ ...firstPeriods[0], jobRoleId: role.id, jobFunctionIds: [jobFunction.id] }] }),
    (error) => error.code === 'DP_EMPLOYMENT_FUNCTION_ROLE_MISMATCH');
    const replay = await publishEmploymentReference(admin, { userId, expectedRevision: 0, requestId: 'publish-1', periods: firstPeriods });
    assert.deepEqual(replay, { ...first, replayed: true });
    await assert.rejects(publishEmploymentReference(admin, { userId, expectedRevision: 0, requestId: 'publish-1', periods: revisedPeriods }),
      (error) => error.code === 'DP_EMPLOYMENT_REQUEST_REUSED');
    await assert.rejects(publishEmploymentReference(admin, { userId, expectedRevision: 0, requestId: 'stale', periods: revisedPeriods }),
      (error) => error.code === 'DP_EMPLOYMENT_REVISION_CONFLICT');
    const second = await publishEmploymentReference(admin, { userId, expectedRevision: 1, requestId: 'publish-2', periods: revisedPeriods });
    assert.equal(second.revision, 2);
    assert.deepEqual((await historyRef(1).get()).data(), frozen);
    assert.equal((await readEmploymentHistory(admin, { userId })).periods.length, 2);
    assert.equal((await readEmploymentHistory(admin, { userId, revision: 1 })).periods.length, 1);
    assert.equal((await readEmploymentReference(admin, { userId, date: '2026-02-01' })).status, 'gap');
    const transfer = await readEmploymentReference(admin, { userId, date: '2026-02-02' });
    assert.equal(transfer.status, 'matched');
    assert.equal(transfer.period.unitId, coverageId);
    assert.equal(transfer.period.employer.unitId, employerId);
    assert.equal((await readEmploymentReference(admin, { userId, date: '2026-02-02', revision: 1 })).status, 'gap');
    assert.equal((await userRef.get()).get('employmentCycleVersion'), 7);
    const oldScope = { ...admin, isDefaultAdmin: false,
      userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: [employerId, coverageId] },
      permissions: structuredClone(defaultGuestPermissions) };
    oldScope.permissions.dp.collaborators.edit = true;
    oldScope.permissions.dp.collaborators.view = true;
    await assert.rejects(publishEmploymentReference(oldScope, { userId, expectedRevision: 2, requestId: 'erase-old',
      periods: [period('2026-02-02', undefined, coverageId)] }),
    (error) => error.code === 'DP_EMPLOYMENT_UNIT_SCOPE');
    const noView = { ...oldScope, permissions: structuredClone(defaultGuestPermissions) };
    await assert.rejects(readEmploymentReference(noView, { userId, date: '2026-02-02' }),
      (error) => error.code === 'DP_EMPLOYMENT_READ_FORBIDDEN');
    const originOnly = { ...oldScope, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: [originId] } };
    await assert.rejects(readEmploymentReference(originOnly, { userId, date: '2026-02-02' }),
      (error) => error.code === 'DP_EMPLOYMENT_UNIT_SCOPE');
    assert.equal((await readEmploymentReference({ ...admin, workspace_id: 'other-workspace' },
      { userId, date: '2026-02-02', revision: 1 })).status, 'missing');
    await userRef.update({ absenceDocumentDeletionFence: { state: 'executing' } });
    await assert.rejects(publishEmploymentReference(admin, { userId, expectedRevision: 2, requestId: 'fenced', periods: revisedPeriods }),
      (error) => error.code === 'DP_EMPLOYMENT_FENCE_ACTIVE');
    assert.equal((await userRef.get()).get('absenceDocumentDeletionFence').state, 'executing');
    const limited = { ...admin, isDefaultAdmin: false, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: [originId] },
      permissions: structuredClone(defaultGuestPermissions) };
    limited.permissions.dp.collaborators.edit = true;
    limited.permissions.dp.collaborators.view = true;
    await assert.rejects(publishEmploymentReference(limited, { userId, expectedRevision: 2, requestId: 'limited', periods: revisedPeriods }),
      (error) => error.code === 'DP_EMPLOYMENT_UNIT_SCOPE');
    limited.permissions.dp.collaborators.ownProfileOnly = true;
    await assert.rejects(publishEmploymentReference(limited, { userId, expectedRevision: 2, requestId: 'own-only', periods: revisedPeriods }),
      (error) => error.code === 'DP_EMPLOYMENT_WRITE_FORBIDDEN');
  } finally {
    await Promise.all([requestRef('publish-1'), requestRef('publish-2'), historyRef(1), historyRef(2), headRef, userRef, ...units, role, jobFunction]
      .map((ref) => ref.delete()));
  }
});
