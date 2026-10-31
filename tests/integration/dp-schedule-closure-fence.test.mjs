import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
enableServerOnlyTestImports('demo-coala-repository');
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { defaultAdminPermissions } = await import('../../src/types/index.ts');
const { holdRepPCompetenceForSchedulePublication } = await import('../../src/features/dp/rep-p/competence-fence.server.ts');
const { closeCompetence, reopenCompetence } = await import('../../src/features/dp/time-adjustments/closure.server.ts');

test('publicação e fechamento do ponto serializam a competência, inclusive após fechar e reabrir', async () => {
  const workspaceId = `publication-closure-${randomUUID().slice(0, 8)}`;
  const competence = '2026-08';
  const actor = { decoded: { uid: 'admin' }, userDoc: { id: 'admin' }, profileId: null,
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: workspaceId };
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin,
    clock: { async read() { return { instant: new Date('2026-10-17T12:00:00.000Z') }; } },
    readRoster: async () => [] };

  const release = await holdRepPCompetenceForSchedulePublication(hrDbAdmin, workspaceId, competence);
  await assert.rejects(closeCompetence(actor, { competence, expectedVersion: 0 }, deps),
    { code: 'PTRP_CLOSURE_IN_PROGRESS' });
  await release();

  const closed = await closeCompetence(actor, { competence, expectedVersion: 0 }, deps);
  assert.equal(closed.status, 'closed');
  await assert.rejects(holdRepPCompetenceForSchedulePublication(hrDbAdmin, workspaceId, competence),
    { code: 'DP_SCHEDULE_COMPETENCE_CLOSED' });

  await reopenCompetence(actor, competence, { expectedVersion: 1, reason: 'Revisão da escala' }, deps);
  const releaseAfterReopen = await holdRepPCompetenceForSchedulePublication(hrDbAdmin, workspaceId, competence);
  await releaseAfterReopen();
});
