import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEarningsCsv } from '../../../src/lib/goals-earnings-csv';
import type { EmployeeEarningsRow } from '../../../src/lib/goals-earnings';

const row = (employeeId: string, prize: number): EmployeeEarningsRow => ({
  employeeId, periodCount: 2, prizedPeriodCount: 2, revenue: 1234.5, target: 1000, prize,
  avgAttainment: 123.456, bestAttainment: 130, role: 'fixed', kioskIds: ['k1', 'k2'], trend: null,
});

test('gera CSV com BOM, separador ; e vírgula decimal', () => {
  const csv = buildEarningsCsv([row('a', 100), row('b', 50.5)], { user: id => (id === 'a' ? 'Ana; "A"' : 'Bia'), kiosk: id => `Q ${id}` });
  const lines = csv.replace('﻿', '').split('\r\n');
  assert.ok(csv.startsWith('﻿'));
  assert.equal(lines[0], 'Colaborador;Quiosque(s);Metas;Faturamento (R$);Atingimento (%);Premiação (R$)');
  assert.equal(lines[1], '"Ana; ""A""";Q k1 / Q k2;2;1234,50;123,46;100,00');
  assert.equal(lines[3], 'Total;;;;;150,50');
});
