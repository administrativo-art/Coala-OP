import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReport,
  dateRange,
  renderHtml,
  renderSubject,
  renderText,
  reportWindow,
  weekCoverage,
  type GoalMonth,
  type ReportInput,
  type SalesDay,
} from '../../functions/src/weekly-revenue-goals-report';

const units = [{ id: 'a', name: 'Unidade A' }, { id: 'b', name: 'Unidade B' }];

function day(kioskId: string, date: string, reais: number, coupons = 10): SalesDay {
  return {
    kioskId, date, revenueCents: reais * 100, reconciled: date >= '2026-09-01', coupons: date >= '2026-08-01' ? coupons : null, items: coupons + 2,
    products: { shake: { name: 'SHAKE MORANGO 500ML', qty: coupons, cents: reais * 100 } },
  };
}

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  const days: SalesDay[] = [];
  for (const date of dateRange('2026-04-01', '2026-10-25')) {
    days.push(day('a', date, 1000));
    if (date >= '2026-08-05' && date !== '2026-10-19') days.push(day('b', date, 500));
  }
  const goals: GoalMonth[] = [
    { kioskId: 'a', month: '2026-10', status: 'active', target: 31000, up: 34000, top: 37000, current: 0, dailyProgress: Object.fromEntries(dateRange('2026-10-01', '2026-10-25').map(date => [date, 1000])), distributionDates: dateRange('2026-10-01', '2026-10-31'), distributionSource: 'calendar' },
    { kioskId: 'b', month: '2026-10', status: 'active', target: 31000, up: 34000, top: null, current: 0, dailyProgress: Object.fromEntries(dateRange('2026-10-01', '2026-10-25').filter(date => date !== '2026-10-19').map(date => [date, 500])), distributionDates: dateRange('2026-10-01', '2026-10-31'), distributionSource: 'calendar' },
    { kioskId: 'a', month: '2026-09', status: 'closed', target: 29000, up: 32000, top: 35000, current: 30000, dailyProgress: {}, distributionDates: [], distributionSource: 'calendar' },
  ];
  return {
    now: new Date('2026-10-26T11:00:00Z'), weekStart: '2026-10-19', weekEnd: '2026-10-25', monthStart: '2026-10-01', monthEnd: '2026-10-25',
    units, days, goals, links: { goals: 'https://op.example/goals', analysis: 'https://op.example/analysis' }, thresholds: { onTrack: 100, attention: 95 }, ...overrides,
  };
}

test('janela do envio de segunda cobre a semana anterior e o mês até ontem', () => {
  assert.deepEqual(reportWindow(new Date('2026-10-26T11:00:00Z')), { weekStart: '2026-10-19', weekEnd: '2026-10-25', monthStart: '2026-10-01', monthEnd: '2026-10-25' });
  assert.deepEqual(reportWindow(new Date('2026-06-01T11:00:00Z')), { weekStart: '2026-05-25', weekEnd: '2026-05-31', monthStart: '2026-05-01', monthEnd: '2026-05-31' });
});

test('dia sem relatório fica ausente e reduz a cobertura, sem contar como zero', () => {
  const report = buildReport(input());
  const unitB = report.units.find(unit => unit.id === 'b')!;
  assert.equal(unitB.week.have, 6);
  assert.equal(unitB.week.expected, 7);
  assert.equal(unitB.week.perDay, 50000);
  assert.equal(weekCoverage(report), 13 / 14);
  assert.ok(report.missingDays.includes('Unidade B 19/10'));
});

test('meta usa a Meta Alvo, a distribuição configurada e projeta pelos dias com dado', () => {
  const report = buildReport(input());
  const unitA = report.units.find(unit => unit.id === 'a')!.goal!;
  assert.equal(unitA.realized, 2_500_000);
  assert.equal(unitA.expected, 2_500_000);
  assert.equal(unitA.pace, 100);
  assert.equal(unitA.projection, 3_100_000);
  assert.deepEqual(unitA.next, { label: 'Meta UP', value: 3_400_000 });
  const unitB = report.units.find(unit => unit.id === 'b')!.goal!;
  assert.equal(unitB.projection, 1_200_000 / 24 * 31);
  assert.equal(report.network.goal!.target, 6_200_000);
  assert.equal(report.network.goal!.up, 6_800_000);
  assert.equal(report.network.goal!.top, null);
});

test('histórico parcial e ticket só aparecem quando os dados permitem', () => {
  const report = buildReport(input());
  const unitB = report.units.find(unit => unit.id === 'b')!;
  assert.equal(unitB.partialHistory, true);
  assert.equal(unitB.variation, null);
  assert.equal(report.units.find(unit => unit.id === 'a')!.partialHistory, false);
});

test('e-mail mostra as faixas da meta, os 10 produtos e fica abaixo do corte do Gmail', () => {
  const report = buildReport(input());
  const html = renderHtml(report);
  assert.match(renderSubject(report), /^Placar Coala: R\$ 10,0 mil na semana/);
  assert.match(html, /Meta Alvo[\s\S]*?R\$ 31\.000/);
  assert.match(html, /Meta UP R\$ 34\.000/);
  assert.match(html, /Percentuais, esperado e status usam a Meta Alvo\./);
  assert.match(html, /10 produtos com maior faturamento na semana/);
  assert.match(html, /Shake Morango 500 ml/);
  assert.match(html, /Semana com 13 de 14 dias de dados\./);
  assert.ok(Buffer.byteLength(html) < 95_000);
  assert.match(renderText(report), /Atenção: semana com 13 de 14 dias de dados/);
});

test('nome vindo do cadastro é escapado no HTML', () => {
  const report = buildReport(input({ units: [{ id: 'a', name: 'Unidade <A>' }] }));
  const html = renderHtml(report);
  assert.match(html, /Unidade &lt;A&gt;/);
  assert.doesNotMatch(html, /Unidade <A>/);
});
