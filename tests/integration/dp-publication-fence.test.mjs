import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { capturePublicationFence, preparePublicationFenceAdvance, preparePublicationFenceCommit } =
  await import('../../src/features/dp/schedules/publication-fence.server.ts');

test('500 people fit in a bounded pointer fence and an intervening writer invalidates it', async () => {
  const workspaceId = 'publication-fence-test';
  const userIds = Array.from({ length: 500 }, (_, index) => `person-${index}`);
  const captured = await capturePublicationFence(workspaceId, userIds);
  assert.ok(captured.size > 0 && captured.size <= 64);
  await dbAdmin.runTransaction(async (tx) => {
    (await preparePublicationFenceCommit(tx, workspaceId, userIds, captured)).apply();
  });
  const advanced = await capturePublicationFence(workspaceId, userIds);
  assert.equal(advanced.size, captured.size);
  for (const [path, version] of advanced) assert.equal(version, captured.get(path) + 1);
  await dbAdmin.runTransaction(async (tx) => {
    (await preparePublicationFenceAdvance(tx, workspaceId, [userIds[0]])).apply();
  });
  await assert.rejects(dbAdmin.runTransaction(async (tx) => {
    (await preparePublicationFenceCommit(tx, workspaceId, userIds, advanced)).apply();
  }), { code: 'DP_SCHEDULE_PUBLICATION_OCCUPANCY_CHANGED' });
});
