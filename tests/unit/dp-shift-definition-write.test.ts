import assert from 'node:assert/strict';
import test from 'node:test';

import { buildShiftDefinitionUpdatePayload } from '../../src/lib/dp-shift-definition-write';

test('PATCH de turno ignora metadados legados e converte somente opcionais removíveis em null', () => {
  const payload = buildShiftDefinitionUpdatePayload({
    id: 'turno-1',
    code: '29447060',
    name: 'CS - 00 AT | Domingo',
    startTime: '09:00',
    endTime: '15:00',
    daysOfWeek: [0],
    journeyIds: ['jornada-v2'],
    breakStart: undefined,
    description: undefined,
    synchronizedSource: 'bizneo',
    synchronizedAt: { seconds: 1 },
    createdAt: { seconds: 1 },
  });

  assert.deepEqual(payload, {
    code: '29447060',
    name: 'CS - 00 AT | Domingo',
    startTime: '09:00',
    endTime: '15:00',
    breakStart: null,
    daysOfWeek: [0],
    journeyIds: ['jornada-v2'],
    description: null,
  });
});
