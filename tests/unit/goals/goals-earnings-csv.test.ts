import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEarningsCsv } from '../../../src/lib/goals-earnings-csv';
import type { EmployeeEarningsRow } from '../../../src/lib/goals-earnings';

const row = (employeeId: string, prize: number): EmployeeEarningsRow => ({
  employeeId, periodCount: 2, prizedPeriodCount: 2, revenue: 1234.5, target: 1000, prize,
  avgAttainment: 123.456, bestAttainment: 130, role: 'fixed', kioskIds: ['k1', 'k2'], trend: null, prizeCalculated: 0, monthKeys: [],
});

test('gera CSV por grupo e unidade, com BOM, separador ; e vírgula decimal', () => {
  const csv = buildEarningsCsv(
    [
      { group: 'Ruas', unit: 'Q k1', row: row('a', 100) },
      { group: 'Ruas', unit: 'Q k2', row: { ...row('b', 50.5), prizeCalculated: 50.5 } },
    ],
    { user: id => (id === 'a' ? 'Ana; "A"' : 'Bia') },
  );
  const lines = csv.replace('\uFEFF', '').split('\r\n');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(lines[0], 'Grupo;Unidade;Colaborador;Metas;Faturamento (R$);Atingimento (%);Premiação (R$);Origem');
  assert.equal(lines[1], 'Ruas;Q k1;"Ana; ""A""";2;1234,50;123,46;100,00;apurada no encerramento');
  assert.equal(lines[2], 'Ruas;Q k2;Bia;2;1234,50;123,46;50,50;calculada pela regra');
  assert.equal(lines[3], 'Total;;;;;;150,50;');
});
