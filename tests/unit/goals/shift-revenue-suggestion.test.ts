import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeShiftSuggestion } from '../../../src/lib/shift-revenue-suggestion';
import type { SalesReport, DPShiftDefinition } from '../../../src/types';

const TIRI = 'unit-tirirical';
const ADM = 'unit-administrativo';

// daysOfWeek aceita número ou texto: o dado bruto do Firestore vem em texto
// (ex.: "sunday") e o dp-provider normaliza para número. O cálculo lida com ambos.
type DefInput = Partial<Omit<DPShiftDefinition, 'daysOfWeek'>> & { daysOfWeek?: Array<number | string> };

function def(partial: DefInput): DPShiftDefinition {
  return {
    id: partial.id ?? 'd',
    code: partial.code ?? 'c',
    name: partial.name ?? 'Turno',
    startTime: partial.startTime ?? '10:00',
    endTime: partial.endTime ?? '16:15',
    daysOfWeek: partial.daysOfWeek ?? [1, 2, 3, 4, 5, 6],
    unitId: partial.unitId,
    createdAt: undefined as never,
  } as unknown as DPShiftDefinition;
}

// Relatório de um dia: receita concentrada por hora via productHourlySales × preço.
function report(dateISO: { y: number; m: number; d: number }, hourQty: Record<string, number>): SalesReport {
  const sim = 'sim-1';
  const productHourlySales: Record<string, Record<string, number>> = { [sim]: {} };
  for (const [h, q] of Object.entries(hourQty)) productHourlySales[sim][h] = q;
  return {
    id: `sales_sync_tirirical_${dateISO.y}_${String(dateISO.m).padStart(2, '0')}_${String(dateISO.d).padStart(2, '0')}`,
    year: dateISO.y,
    month: dateISO.m,
    day: dateISO.d,
    items: [{ sku: '1', productName: 'X', quantity: 1, simulationId: sim, unitPrice: 1, timestamp: '10:00' }],
    productHourlySales,
    hourlySales: {},
  } as unknown as SalesReport;
}

test('atribui receita pela janela real do turno, não por corte fixo às 14h', () => {
  // Uma quarta-feira (2026-07-01). 15h e 16h têm receita.
  // Manhã 10:00–16:15 cobre 15h inteira + 16h só até 16:15; Tarde 15:45–22:00 cobre 15h só a partir 15:45 + 16h inteira.
  const manha = { id: 'manha', def: def({ id: 'manha', startTime: '10:00', endTime: '16:15', unitId: TIRI }) };
  const tarde = { id: 'tarde', def: def({ id: 'tarde', startTime: '15:45', endTime: '22:00', unitId: TIRI }) };
  const reports = [report({ y: 2026, m: 7, d: 1 }, { '15': 100, '16': 100 })];

  const s = computeShiftSuggestion(reports, [manha, tarde], { kioskUnitId: TIRI })!;
  // 15h: manhã 60min, tarde 15min → manhã 80/tarde 20. 16h: manhã 15min, tarde 60min → manhã 20/tarde 80.
  // Total manhã = 80+20 = 100; tarde = 20+80 = 100 → 50/50.
  assert.ok(Math.abs(s.manha - 50) < 0.5, `manha=${s.manha}`);
  assert.ok(Math.abs(s.tarde - 50) < 0.5, `tarde=${s.tarde}`);
});

test('exclui turno de outra unidade (liderança ADM) do rateio de venda', () => {
  const manha = { id: 'manha', def: def({ id: 'manha', startTime: '10:00', endTime: '16:15', unitId: TIRI }) };
  const tarde = { id: 'tarde', def: def({ id: 'tarde', startTime: '15:45', endTime: '22:00', unitId: TIRI }) };
  const lider = { id: 'lider', def: def({ id: 'lider', startTime: '09:00', endTime: '18:00', unitId: ADM }) };
  const reports = [report({ y: 2026, m: 7, d: 1 }, { '11': 100, '19': 100 })];

  const s = computeShiftSuggestion(reports, [manha, tarde, lider], { kioskUnitId: TIRI })!;
  assert.equal(s.lider, 0, 'líder de outra unidade não recebe meta');
  assert.ok(Math.abs(s.manha + s.tarde - 100) < 0.001, 'demais somam 100%');
});

test('normaliza daysOfWeek em texto (domingo só recebe receita de domingo)', () => {
  const domingo = { id: 'dom', def: def({ id: 'dom', startTime: '08:45', endTime: '15:00', daysOfWeek: ['sunday'], unitId: TIRI }) };
  const manha = { id: 'manha', def: def({ id: 'manha', startTime: '10:00', endTime: '16:15', daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'], unitId: TIRI }) };
  // 2026-07-05 é domingo; 2026-07-06 é segunda.
  const reports = [
    report({ y: 2026, m: 7, d: 5 }, { '11': 50 }), // domingo
    report({ y: 2026, m: 7, d: 6 }, { '11': 50 }), // segunda
  ];
  const s = computeShiftSuggestion(reports, [domingo, manha], { kioskUnitId: TIRI })!;
  assert.ok(Math.abs(s.dom - 50) < 0.5, `dom=${s.dom}`);
  assert.ok(Math.abs(s.manha - 50) < 0.5, `manha=${s.manha}`);
});

test('não exclui nada se o mapeamento de unidade não bater (fallback seguro)', () => {
  const manha = { id: 'manha', def: def({ id: 'manha', startTime: '10:00', endTime: '16:15', unitId: ADM }) };
  const tarde = { id: 'tarde', def: def({ id: 'tarde', startTime: '15:45', endTime: '22:00', unitId: ADM }) };
  const reports = [report({ y: 2026, m: 7, d: 1 }, { '11': 100, '19': 100 })];
  // kioskUnitId não bate com nenhum → todos seriam "de outra unidade"; deve manter todos.
  const s = computeShiftSuggestion(reports, [manha, tarde], { kioskUnitId: 'unit-inexistente' })!;
  assert.ok(s.manha > 0 && s.tarde > 0, 'não zera tudo quando unidade não bate');
});
