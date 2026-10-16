import assert from 'node:assert/strict';
import test from 'node:test';
import { absenceDaySegments, intervalsOverlap, segmentBalances } from '@/features/dp/absences/requests/reservations';
import { absenceActionSchema, createAbsenceDraftSchema } from '@/features/dp/absences/requests/workflow-schemas';
import type { DPAbsencePolicy } from '@/types';

const policy = { calculation: 'calendar_days', limitPeriod: 'month' } as DPAbsencePolicy;
const request = { absenceTypeId: 'public', startDate: '2026-10-31', endDate: '2026-11-02', unit: 'day' as const };

test('criação e ação rejeitam autoria, status, quantidade e campos internos forjados', () => {
  const valid = { idempotencyKey: '3cb741ae-3109-4ad7-927f-9473c96fa456', request, preparationIds: [] };
  assert.equal(createAbsenceDraftSchema.safeParse(valid).success, true);
  assert.equal(createAbsenceDraftSchema.safeParse({ ...valid, beneficiaryUid: 'bob' }).success, true);
  for (const forged of [{ origin: 'system' }, { workspaceId: 'other' }, { status: 'approved' }, { quantity: 5 }]) {
    assert.equal(createAbsenceDraftSchema.safeParse({ ...valid, ...forged }).success, false);
  }
  assert.equal(absenceActionSchema.safeParse({ action: 'approve', expectedVersion: 2, operationId: valid.idempotencyKey, assignedReviewerIds: ['bob'] }).success, false);
  assert.equal(absenceActionSchema.safeParse({ action: 'confirm_profile', expectedVersion: 2, operationId: valid.idempotencyKey, reason: 'curto' }).success, false);
});

test('reservas repartem mês, retorno exclusivo e minutos noturnos sem inventar jornada', () => {
  const inclusive = absenceDaySegments(request, policy);
  assert.deepEqual(inclusive.map((day) => day.date), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual([...segmentBalances(inclusive)], [['2026-10', 1], ['2026-11', 2]]);
  const returnExclusive = absenceDaySegments(request, { ...policy, calculation: 'calendar_days_until_return' });
  assert.deepEqual(returnExclusive.map((day) => day.date), ['2026-10-31', '2026-11-01']);
  const hours = absenceDaySegments({ ...request, unit: 'hour', startDate: '2026-10-31', endDate: '2026-11-01', startTime: '22:30', endTime: '02:00' }, policy);
  assert.deepEqual(hours.map((day) => day.quantityMinor), [90, 120]);
  assert.equal(intervalsOverlap(hours[0], { fromMinute: 1300, toMinute: 1340 }), false);
  assert.equal(intervalsOverlap(hours[0], { fromMinute: 1380, toMinute: 1440 }), true);
  assert.throws(() => absenceDaySegments({ ...request, endDate: '2027-12-31' }, policy));
});
