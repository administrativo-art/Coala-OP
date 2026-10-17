import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { absenceGuardEnvironmentAccepted } from '../../src/features/dp/absences/operational/guard-environment';
import { occupancyClockId, occupancyMode, periodDays, shiftDays } from '../../functions/src/absence-occupancy-clock';
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

test('guard ON só em demo+emuladores ou no projeto de produção sem emulador', () => {
  const emu = { firestoreEmulatorHost: '127.0.0.1:8080', authEmulatorHost: '127.0.0.1:9099' };
  assert.equal(absenceGuardEnvironmentAccepted({ ...emu, projectId: 'demo-coala-repository' }), true);
  assert.equal(absenceGuardEnvironmentAccepted({ projectId: 'smart-converter-752gf', nodeEnv: 'production' }), true);
  // Misturas falham fechadas.
  assert.equal(absenceGuardEnvironmentAccepted({ ...emu, projectId: 'smart-converter-752gf' }), false);
  assert.equal(absenceGuardEnvironmentAccepted({ firestoreEmulatorHost: '127.0.0.1:8080', projectId: 'smart-converter-752gf' }), false);
  assert.equal(absenceGuardEnvironmentAccepted({ projectId: 'demo-coala-repository' }), false);
  assert.equal(absenceGuardEnvironmentAccepted({ ...emu, projectId: 'demo-coala-repository', nodeEnv: 'production' }), false);
  assert.equal(absenceGuardEnvironmentAccepted({ projectId: 'outro-projeto' }), false);
  assert.equal(absenceGuardEnvironmentAccepted({ ...emu, firestoreEmulatorHost: '10.0.0.5:8080', projectId: 'demo-x' }), false);
});

const readyReceipt = { workspaceId: 'coala', state: 'ready', bootstrapComplete: true,
  coverageHash: 'absence-occupancy-writers-v1', scopeKind: 'workspace_all', scopeHash: 'a'.repeat(64),
  epoch: '0f8fad5b-d9cb-469f-a165-70867728950e' };
const receiptDb = (receipt?: Record<string, unknown>) => ({ collection: () => ({ doc: () => ({ get: async () => ({
  exists: Boolean(receipt), get: (field: string) => receipt?.[field],
}) }) }) });

test('desligamento: sem recibo é legado, bootstrapping/inválido pendente, ready válido protegido', async () => {
  assert.deepEqual(await occupancyMode(receiptDb() as never, 'coala', 'off'), { kind: 'legacy' });
  assert.deepEqual(await occupancyMode(receiptDb() as never, 'coala', 'on'), { kind: 'pending' });
  assert.deepEqual(await occupancyMode(receiptDb({ ...readyReceipt, state: 'bootstrapping' }) as never, 'coala', 'off'), { kind: 'pending' });
  assert.deepEqual(await occupancyMode(receiptDb({ ...readyReceipt, bootstrapComplete: false }) as never, 'coala', 'off'), { kind: 'pending' });
  assert.deepEqual(await occupancyMode(receiptDb({ ...readyReceipt, workspaceId: 'outro' }) as never, 'coala', 'off'), { kind: 'pending' });
  assert.deepEqual(await occupancyMode(receiptDb(readyReceipt) as never, 'coala', 'off'), { kind: 'guarded', epoch: readyReceipt.epoch });
  assert.equal(await terminationOccupancyGuardPending(receiptDb(readyReceipt) as never, 'coala', 'off'), false);
});

test('dias de ocupação: turno noturno toca dois dias, férias cobrem o período inclusive', () => {
  assert.deepEqual(shiftDays('2026-10-31', '22:00', '06:00'), ['2026-10-31', '2026-11-01']);
  assert.deepEqual(shiftDays('2026-10-31', '22:00', '00:00'), ['2026-10-31']);
  assert.deepEqual(shiftDays('2026-10-31', '09:00', '17:00'), ['2026-10-31']);
  assert.deepEqual(periodDays('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.equal(occupancyClockId('coala', 'u1', '2026-10-31'),
    createHash('sha256').update('coala:u1:2026-10-31').digest('hex'));
});
