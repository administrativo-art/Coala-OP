import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssetHistoryMaintenance } from '../../../src/features/assets/history-pagination';
import { formatMaintenanceDate, maintenanceHistoryDetails, prepareMaintenanceRequest } from '../../../src/features/assets/maintenance-ui';
import { operationalCivilDate } from '../../../src/lib/operational-unit-periods';

const draft = {
  mode: 'completed',
  key: 'intencao-123',
  date: '2026-11-21',
  today: '2026-11-27',
  description: ' Revisão executada ',
  priority: 'high',
  assignee: '',
  components: '',
  user: { id: 'user-id', username: 'Operador' },
} as const;

test('registrar uma manutenção avulsa aceita deixar as peças e a assistência em branco', () => {
  const expected = {
    mode: 'completed',
    idempotencyKey: 'intencao-123',
    performedOn: '2026-11-21',
    description: 'Revisão executada',
    assignee: { type: 'user', id: 'user-id', nameSnapshot: 'Operador' },
    components: [],
  };
  assert.deepEqual(prepareMaintenanceRequest(draft).body, expected);
  assert.deepEqual(prepareMaintenanceRequest({ ...draft }).body, expected);
});

test('preserva quantidades, ordem e repetições das linhas de peças', () => {
  const { body } = prepareMaintenanceRequest({
    ...draft,
    assignee: ' Oficina ',
    components: ' 2 retentores \r\n\r\n 1 correia \r\n2 retentores',
  });
  assert.deepEqual(body && 'assignee' in body ? body.assignee : undefined, { type: 'third_party', nameSnapshot: 'Oficina' });
  assert.deepEqual(body?.components, ['2 retentores', '1 correia', '2 retentores']);
});

test('conclusão vinculada envia a versão da ocorrência e o resultado, mantendo o responsável original', () => {
  assert.deepEqual(prepareMaintenanceRequest({
    ...draft,
    occurrence: { id: 'ocorrencia-real', version: 8 },
    assignee: 'Um novo responsável',
    components: '1 correia',
  }).body, {
    expectedVersion: 8, performedOn: '2026-11-21', result: 'Revisão executada', components: ['1 correia'],
  });
});

test('agendamento conserva o contrato de prazo, prioridade e checklist', () => {
  assert.deepEqual(prepareMaintenanceRequest({ ...draft, mode: 'scheduled', date: '2026-12-10', components: '1 correia' }).body, {
    idempotencyKey: 'intencao-123',
    dueDate: '2026-12-10',
    priority: 'high',
    description: 'Revisão executada',
    assignee: { type: 'user', id: 'user-id', nameSnapshot: 'Operador' },
    components: [],
    checklistSnapshot: [],
  });
});

test('valida data civil, limites individuais e quantidade total de peças', () => {
  const today = operationalCivilDate(new Date('2026-11-28T02:50:00.000Z'));
  const result = prepareMaintenanceRequest({
    ...draft, today, date: '2026-11-28', description: 'x'.repeat(3001), assignee: 'x'.repeat(201),
    components: Array.from({ length: 31 }, () => '1 correia').join('\n'),
  });
  assert.equal(today, '2026-11-27');
  assert.equal(result.body, undefined);
  assert.deepEqual(Object.keys(result.errors ?? {}), ['date', 'description', 'assignee', 'components']);
  assert.ok(prepareMaintenanceRequest({ ...draft, date: '2026-02-30' }).errors?.date);
  assert.ok(prepareMaintenanceRequest({ ...draft, components: 'x'.repeat(201) }).errors?.components);
  assert.ok(prepareMaintenanceRequest({ ...draft, description: '   ' }).errors?.description);
});

test('mostra a data de serviço e interpreta o timestamp legado em Belém', () => {
  const maintenance: AssetHistoryMaintenance = {
    status: 'completed',
    performedOn: '2026-11-21',
    completedAt: '2026-11-28T02:50:00.000Z',
    assigneeLabel: null,
    registeredByLabel: null,
    dueDate: null,
    result: 'Troca executada',
    components: [],
    order: null,
  };
  assert.deepEqual(maintenanceHistoryDetails(maintenance, 'Descrição anterior'), {
    title: 'Manutenção realizada', status: 'Realizada', date: '21/11/2026', dateLabel: 'Realizada em', service: 'Troca executada',
  });
  assert.equal(maintenanceHistoryDetails({ ...maintenance, performedOn: null }, '').date, '27/11/2026');
  assert.match(formatMaintenanceDate(maintenance.completedAt, true), /^27\/11\/2026.*23:50$/);
  assert.deepEqual(maintenanceHistoryDetails({ ...maintenance, status: 'scheduled', dueDate: '2026-11-29', result: null }, 'Descrição anterior'), {
    title: 'Manutenção agendada', status: 'Agendada', date: '29/11/2026', dateLabel: 'Concluir até', service: 'Descrição anterior',
  });
});
