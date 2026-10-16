import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAbsenceOperationalAdminWriteAllowed } from '../../scripts/absence-operational-admin-gate.mjs';
import { runTerminatedUserProfile, TerminationOccupancyGuardPending,
  terminationOccupancyGuardPending } from '../../functions/src/user-termination-effects';

const db = (state?: string) => ({ collection: () => ({ doc: () => ({ get: async () => ({
  exists: Boolean(state), get: () => state,
}) }) }) });

test('bootstrap/ready suspendem writes legados; OFF sem recibo preserva legado', async () => {
  assert.equal(await terminationOccupancyGuardPending(db() as never, 'coala', 'off'), false);
  assert.equal(await terminationOccupancyGuardPending(db('bootstrapping') as never, 'coala', 'off'), true);
  assert.equal(await terminationOccupancyGuardPending(db('ready') as never, 'coala', 'off'), true);
  assert.equal(await terminationOccupancyGuardPending(db() as never, 'coala', 'on'), true);
  await assertAbsenceOperationalAdminWriteAllowed(db() as never, 'coala', 'off');
  await assert.rejects(assertAbsenceOperationalAdminWriteAllowed(db('bootstrapping') as never, 'coala', 'off'));
  await assert.rejects(assertAbsenceOperationalAdminWriteAllowed(db('ready') as never, 'coala', 'off'));
  await assert.rejects(assertAbsenceOperationalAdminWriteAllowed(db() as never, 'coala', 'on'));
});

test('desligamento revoga antes dos efeitos e pending não equivale a versão concluída', async () => {
  const events: string[] = [];
  const steps = { revoke: async () => { events.push('revoke'); },
    apply: async () => { events.push('apply'); throw new TerminationOccupancyGuardPending(); },
    pending: async () => { events.push('pending'); },
    applied: async () => { events.push('version1'); } };
  assert.equal(await runTerminatedUserProfile(steps), 'pending_occupancy_guard');
  assert.deepEqual(events, ['revoke', 'apply', 'pending']);
  events.length = 0;
  await assert.rejects(runTerminatedUserProfile({ ...steps, revoke: async () => { throw Error('auth failed'); } }), /auth failed/);
  assert.deepEqual(events, []);
});
