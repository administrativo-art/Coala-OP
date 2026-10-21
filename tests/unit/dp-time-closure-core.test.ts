import assert from 'node:assert/strict';
import test from 'node:test';

import { absenceLookback, buildDeclaration, competenceEnded, competenceRange, diffDigests, includeClosureRoster, itemDigests, overlapsCompetence, pendingOf, sha256 } from '../../src/features/dp/time-adjustments/closure-core';

const adjustment = (id: string, employeeUid: string, status: 'in_review' | 'approved' | 'rejected' | 'cancelled', workDate = '2026-09-10') => ({
  id, employeeUid, employeeName: employeeUid === 'u1' ? 'Bia' : 'Ana', workDate, kind: 'include' as const, status, original: null,
  inclusion: { markedAt: `${workDate}T08:00:00-0300` }, reason: 'Esqueci de bater a entrada.', requestedBy: employeeUid, requestedAt: `${workDate}T12:00:00.000Z`,
  decidedBy: status === 'in_review' ? null : 'dp', decidedAt: status === 'in_review' ? null : `${workDate}T15:00:00.000Z`, decisionReason: null,
});
const absence = (id: string, beneficiaryUid: string, status: string) => ({
  id, beneficiaryUid, beneficiaryName: null, typeName: 'Atestado', startDate: '2026-08-30', endDate: '2026-09-02', startTime: null, endTime: null,
  quantity: 4, unit: 'day' as const, status, approval: status === 'approved' ? 'tacit_timeout' as const : null, decidedBy: null, decidedAt: null, attachmentCount: 1,
});
const shiftSwap = (id: string, status: 'pending' | 'accepted' | 'rejected' | 'stale' = 'accepted') => ({
  id, status, date: '2026-09-15', unitId: 'unit', unitName: 'Quiosque', requesterUid: 'u1', requesterName: 'Bia', targetUid: 'u2', targetName: 'Ana',
  offeredShift: { startTime: '08:00', endTime: '16:00', shiftName: 'Manhã' },
  requestedShift: { startTime: '12:00', endTime: '20:00', shiftName: 'Tarde' },
  reason: null, requestedAt: '2026-09-10T12:00:00.000Z', decidedAt: status === 'pending' ? null : '2026-09-10T13:00:00.000Z',
  acts: [{ action: 'submitted' as const, at: '2026-09-10T12:00:00.000Z', actorUid: 'u1', actorName: 'Bia', declaration: 'Solicito a troca.' }],
});

test('competência: intervalo do mês, janela de busca das ausências e sobreposição', () => {
  assert.deepEqual(competenceRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
  assert.equal(absenceLookback('2026-09-01'), '2025-08-31');
  assert.equal(overlapsCompetence({ startDate: '2026-08-30', endDate: '2026-09-02' }, '2026-09'), true);
  assert.equal(overlapsCompetence({ startDate: '2026-08-01', endDate: '2026-08-31' }, '2026-09'), false);
});

test('declaração agrupa por pessoa, ordena de forma estável e conta pendências (rascunho não conta)', () => {
  const people = buildDeclaration([adjustment('b', 'u1', 'approved', '2026-09-12'), adjustment('a', 'u1', 'in_review'), adjustment('c', 'u2', 'rejected')],
    [absence('x', 'u2', 'in_review'), absence('y', 'u1', 'approved')]);
  assert.deepEqual(people.map((person) => person.name), ['Ana', 'Bia']);
  assert.deepEqual(people[1].adjustments.map((item) => item.id), ['a', 'b']);
  assert.equal(people[0].absences[0].id, 'x');
  assert.deepEqual(pendingOf(people), { adjustments: 1, absences: 1, shiftSwaps: 0 });
  // Same input in another order: same declaration and the same stamp.
  const again = buildDeclaration([adjustment('c', 'u2', 'rejected'), adjustment('a', 'u1', 'in_review'), adjustment('b', 'u1', 'approved', '2026-09-12')],
    [absence('y', 'u1', 'approved'), absence('x', 'u2', 'in_review')]);
  assert.equal(sha256(again), sha256(people));
  assert.equal(sha256({ b: 1, a: 2 }), sha256({ a: 2, b: 1 }));
});

test('troca de turno integra a declaração das duas pessoas e a pendência conta uma única vez', () => {
  const people = buildDeclaration([], [], [shiftSwap('swap', 'pending')]);
  assert.deepEqual(people.map((person) => [person.uid, person.shiftSwaps.map((item) => item.id)]), [['u2', ['swap']], ['u1', ['swap']]]);
  assert.deepEqual(pendingOf(people), { adjustments: 0, absences: 0, shiftSwaps: 1 });
  assert.deepEqual(Object.keys(itemDigests(people)), ['shift-swap:swap']);
  assert.equal(pendingOf(buildDeclaration([], [], [shiftSwap('stale', 'stale')])).shiftSwaps, 0);
});

test('fechamento inclui toda a equipe e preserva quem teve ocorrência', () => {
  const declaration = buildDeclaration([adjustment('a', 'u1', 'approved')], []);
  const people = includeClosureRoster(declaration, [{ uid: 'u2', name: 'Ana' }, { uid: 'u1', name: 'Nome atual' }]);
  assert.deepEqual(people.map((person) => [person.uid, person.name, person.adjustments.length]), [
    ['u2', 'Ana', 0],
    ['u1', 'Bia', 1],
  ]);
  assert.deepEqual(includeClosureRoster(declaration, [{ uid: 'u2', name: 'Ana' }]).map((person) => person.uid), ['u2', 'u1']);
});

test('versão reaberta declara o que entrou, mudou e saiu', () => {
  const first = itemDigests(buildDeclaration([adjustment('a', 'u1', 'approved'), adjustment('b', 'u1', 'approved')], []));
  const second = itemDigests(buildDeclaration([adjustment('a', 'u1', 'rejected'), adjustment('c', 'u1', 'approved')], [absence('x', 'u1', 'approved')]));
  assert.equal(diffDigests(null, second), null);
  assert.deepEqual(diffDigests(first, second), { added: ['absence:x', 'adjustment:c'], changed: ['adjustment:a'], removed: ['adjustment:b'] });
});

test('mês só fecha encerrado há um dia no fuso mais a oeste (turno que cruza a meia-noite)', () => {
  // 1º/10 às 02h UTC ainda é 30/09 em Brasília: setembro não fecha.
  assert.equal(competenceEnded('2026-09', '2026-10-01T02:00:00.000Z'), false);
  // 1º/10 às 23h em Brasília: falta a margem de um dia em Rio Branco.
  assert.equal(competenceEnded('2026-09', '2026-10-02T02:00:00.000Z'), false);
  // 2/10 às 06h UTC: 1º/10 já terminou um dia em Rio Branco.
  assert.equal(competenceEnded('2026-09', '2026-10-02T06:00:00.000Z'), true);
  assert.equal(competenceEnded('2026-10', '2026-10-17T12:00:00.000Z'), false);
});
