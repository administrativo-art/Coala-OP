import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNatashaSnapshotFromCoala, NatashaCollectError, type CoalaSnapshotSources } from '../../scripts/natasha/coala-snapshot';
import { createNatashaFirestoreReader, validateNatashaReadPlan } from '../../scripts/natasha/firestore-reader';

function source(changes: Partial<CoalaSnapshotSources> = {}): CoalaSnapshotSources {
  return {
    period: '2026-10', unitIds: ['tirirical'],
    units: [{ id: 'tirirical', data: { isArchived: false, operatingHours: { '4': { isOpen: true, startTime: '09:00', endTime: '21:00' } } } }],
    schedules: [
      { id: 'sep', data: { year: 2026, month: 9, unitId: 'tirirical' } },
      { id: 'oct', data: { year: 2026, month: 10, unitId: 'tirirical' } },
    ],
    shiftsBySchedule: {
      sep: [{ id: 'prior', data: { userId: 'edna', userName: 'Edna', unitId: 'tirirical', date: '2026-09-24', startTime: '09:00', endTime: '15:00', type: 'work' } }],
      oct: [
        { id: 'target', data: { userId: 'edna', userName: 'Edna', unitId: 'tirirical', date: '2026-10-01', startTime: '15:00', endTime: '21:00', type: 'work' } },
        { id: 'off', data: { userId: 'sara', unitId: 'tirirical', date: '2026-10-02', type: 'day_off' } },
      ],
    },
    vacations: [{ id: 'vac', data: { userId: 'edna', startDate: '2026-10-01', endDate: '2026-10-05', status: 'APPROVED', recordType: 'gozo' } }],
    historyConfirmed: true, allUnitsConfirmed: true,
    ...changes,
  };
}

test('normaliza mês e histórico com férias, folga e classificação nominal do turno', () => {
  const result = buildNatashaSnapshotFromCoala(source());
  assert.equal(result.snapshot.history?.from, '2026-09-17');
  assert.equal(result.snapshot.history?.complete, true);
  assert.equal(result.snapshot.shifts.length, 2);
  assert.equal(result.snapshot.shifts.find((shift) => shift.id === 'oct:target')?.slot, 'closing');
  assert.deepEqual(result.snapshot.dayOffs, [{ employeeId: 'sara', date: '2026-10-02' }]);
  assert.deepEqual(result.snapshot.vacations, [{ employeeId: 'edna', startDate: '2026-10-01', endDate: '2026-10-05', status: 'approved', recordType: 'gozo' }]);
  assert.equal(result.snapshot.fridayMatrix, null);
  assert.equal(result.evidence.readIsAtomic, false);
});

test('não declara histórico completo sem escala anterior ou confirmação de abrangência', () => {
  const missing = source({ schedules: source().schedules.slice(1), shiftsBySchedule: { oct: source().shiftsBySchedule.oct } });
  const result = buildNatashaSnapshotFromCoala(missing);
  assert.equal(result.snapshot.history?.complete, false);
  assert.deepEqual(result.evidence.missingPriorUnitIds, ['tirirical']);
  assert.equal(buildNatashaSnapshotFromCoala(source({ allUnitsConfirmed: false })).snapshot.history?.complete, false);
});

test('não rotula como abertura um turno fora do funcionamento nominal', () => {
  const input = source();
  input.shiftsBySchedule.oct[0].data.startTime = '06:00';
  input.shiftsBySchedule.oct[0].data.endTime = '08:00';
  assert.equal(buildNatashaSnapshotFromCoala(input).snapshot.shifts.find((shift) => shift.id === 'oct:target')?.slot, undefined);
});

test('interrompe diante de fonte inconsistente, em vez de devolver snapshot parcial', () => {
  assert.throws(() => buildNatashaSnapshotFromCoala(source({ shiftsBySchedule: { sep: [] } })), NatashaCollectError);
  assert.throws(() => buildNatashaSnapshotFromCoala(source({ schedules: [...source().schedules, source().schedules[1]] })), NatashaCollectError);
  assert.throws(() => buildNatashaSnapshotFromCoala(source({ units: [] })), NatashaCollectError);
  assert.throws(() => validateNatashaReadPlan({ period: '2026-10', unitIds: ['a', 'a'], historyConfirmed: true, allUnitsConfirmed: true }), NatashaCollectError);
});

function firestoreDocument(path: string, fields: Record<string, unknown>) {
  function encode(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'number') return { integerValue: String(value) };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (value && typeof value === 'object') {
      return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, encode(nested)])) } };
    }
    return { nullValue: null };
  }
  return { name: `projects/project-test/databases/coala/documents/${path}`, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)])) };
}

test('leitor usa somente GET e runQuery com token do usuário e filtros limitados', async () => {
  const calls: Array<{ url: string; method: string; headers: Headers; body?: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ url, method, headers, body });
    if (method === 'GET') return Response.json(firestoreDocument('dp_units/tirirical', { isArchived: false, operatingHours: {} }));
    const query = body?.structuredQuery as Record<string, unknown>;
    const from = query.from as Array<{ collectionId: string }>;
    if (from[0]?.collectionId === 'dp_schedules') {
      const where = query.where as { compositeFilter: { filters: Array<{ fieldFilter: { field: { fieldPath: string }; value: Record<string, string> } }> } };
      const monthFilter = where.compositeFilter.filters.find((filter) => filter.fieldFilter.field.fieldPath === 'month');
      const month = monthFilter?.fieldFilter.value.integerValue;
      if (month === '9') return Response.json([{ document: firestoreDocument('dp_schedules/sep', { year: 2026, month: 9, unitId: 'tirirical' }) }]);
      if (month === '10') return Response.json([{ document: firestoreDocument('dp_schedules/oct', { year: 2026, month: 10, unitId: 'tirirical' }) }]);
    }
    if (from[0]?.collectionId === 'shifts' && url.includes('/dp_schedules/oct:runQuery')) {
      return Response.json([{ document: firestoreDocument('dp_schedules/oct/shifts/one', {
        userId: 'edna', userName: 'Edna', unitId: 'tirirical', date: '2026-10-01', startTime: '09:00', endTime: '15:00', type: 'work',
      }) }]);
    }
    if (from[0]?.collectionId === 'dp_vacations') {
      return Response.json([{ document: firestoreDocument('dp_vacations/vac', {
        userId: 'edna', startDate: '2026-10-01', endDate: '2026-10-05', status: 'APPROVED', recordType: 'gozo',
      }) }]);
    }
    return Response.json([]);
  };
  const result = await createNatashaFirestoreReader({ token: 'fake-token', projectId: 'project-test', fetcher }).collect({
    period: '2026-10', unitIds: ['tirirical'], historyConfirmed: true, allUnitsConfirmed: true,
  });
  assert.equal(result.schedules.length, 2);
  assert.equal(result.vacations.length, 1);
  assert.deepEqual(Object.keys(result.shiftsBySchedule).sort(), ['oct', 'sep']);
  assert.equal(calls.length, 14);
  assert.ok(calls.every((call) => ['GET', 'POST'].includes(call.method)));
  assert.ok(calls.every((call) => call.headers.get('authorization') === 'Bearer fake-token'));
  assert.ok(calls.some((call) => call.url.endsWith('/dp_schedules/sep:runQuery')));
  assert.equal(calls.filter((call) => call.body && JSON.stringify(call.body).includes('dp_vacations')).length, 1);
  assert.ok(calls.every((call) => call.method !== 'POST' || (call.body?.structuredQuery as { limit: number }).limit <= 301));
});

test('leitor falha fechado quando Firestore nega a leitura', async () => {
  const fetcher: typeof fetch = async () => Response.json({ error: 'denied' }, { status: 403 });
  await assert.rejects(createNatashaFirestoreReader({ token: 'fake-token', projectId: 'project-test', fetcher }).collect({
    period: '2026-10', unitIds: ['tirirical'], historyConfirmed: true, allUnitsConfirmed: true,
  }), NatashaCollectError);
});
