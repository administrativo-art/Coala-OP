import assert from 'node:assert/strict';
import test from 'node:test';

import { dateRange, type GoalMonth, type ReportInput, type SalesDay } from '../../functions/src/weekly-revenue-goals-report';
import {
  buildClosingReport, closingCoverage, closingSubject, closingWindow, renderClosingHtml, renderClosingText,
} from '../../functions/src/monthly-revenue-closing-report';

const units = [{ id: 'a', name: 'Unidade A' }, { id: 'b', name: 'Unidade B' }];

function day(kioskId: string, date: string, reais: number, coupons = 10): SalesDay {
  return {
    kioskId, date, revenueCents: reais * 100, reconciled: true, coupons, items: coupons + 2,
    products: { shake: { name: 'SHAKE MORANGO 500ML', qty: coupons, cents: reais * 100 } },
  };
}

function input(overrides: Partial<ReportInput> = {}, closed = true): ReportInput {
  const days: SalesDay[] = [];
  for (const date of dateRange('2026-04-01', '2026-10-31')) {
    days.push(day('a', date, 1000));
    if (date !== '2026-10-19') days.push(day('b', date, 500));
  }
  const goal = (kioskId: string, daily: number, target: number, up: number, top: number | null, current: number): GoalMonth => ({
    kioskId, month: '2026-10', status: closed ? 'closed' : 'active', target, up, top, current: closed ? current : 0,
    dailyProgress: Object.fromEntries(dateRange('2026-10-01', '2026-10-31').map(date => [date, daily])),
    distributionDates: dateRange('2026-10-01', '2026-10-31'), distributionSource: 'calendar',
  });
  const goals: GoalMonth[] = [
    goal('a', 1000, 30000, 34000, 37000, 31000),
    goal('b', 500, 16000, 18000, null, 15500),
    { kioskId: 'a', month: '2026-09', status: 'closed', target: 29000, up: 32000, top: 35000, current: 30000, dailyProgress: {}, distributionDates: [], distributionSource: 'calendar' },
  ];
  return {
    now: new Date('2026-11-02T12:00:00Z'), ...closingWindow(new Date('2026-11-02T12:00:00Z')), units, days, goals,
    links: { goals: 'https://op.example/goals', analysis: 'https://op.example/analysis' }, thresholds: { onTrack: 100, attention: 95 }, ...overrides,
  };
}

test('qualquer envio em novembro fecha outubro completo, inclusive no dia 1', () => {
  const expected = { weekStart: '2026-10-25', weekEnd: '2026-10-31', monthStart: '2026-10-01', monthEnd: '2026-10-31' };
  assert.deepEqual(closingWindow(new Date('2026-11-01T12:00:00Z')), expected);
  assert.deepEqual(closingWindow(new Date('2026-11-02T12:00:00Z')), expected);
  assert.equal(closingWindow(new Date('2027-01-01T12:00:00Z')).monthStart, '2026-12-01');
});

test('dia sem relatório fica ausente e reduz a cobertura, sem contar como zero', () => {
  const report = buildClosingReport(input());
  const unitB = report.units.find(unit => unit.id === 'b')!;
  assert.equal(unitB.current.have, 30);
  assert.equal(unitB.current.expected, 31);
  assert.equal(unitB.current.perDay, 50000);
  assert.equal(closingCoverage(report), 61 / 62);
  assert.ok(report.missingDays.includes('Unidade B 19/10'));
});

test('meta encerrada usa o valor final e identifica a faixa atingida', () => {
  const report = buildClosingReport(input());
  const a = report.units.find(unit => unit.id === 'a')!.goal!;
  const b = report.units.find(unit => unit.id === 'b')!.goal!;
  assert.equal(a.realized, 3_100_000);
  assert.equal(a.tier, 'Meta Alvo');
  assert.equal(a.hit, true);
  assert.equal(a.streak, 1);
  assert.equal(b.realized, 1_550_000);
  assert.equal(b.tier, null);
  assert.equal(b.hit, false);
  assert.equal(report.network.goal!.hit, 1);
  assert.equal(report.network.goal!.allClosed, true);
  assert.equal(report.network.goal!.target, 4_600_000);
  assert.equal(report.network.goal!.top, null);
});

test('meta ainda aberta é sinalizada como em apuração e não declara veredito', () => {
  const report = buildClosingReport(input({}, false));
  assert.equal(report.network.goal!.allClosed, false);
  const html = renderClosingHtml(report);
  assert.match(html, /Metas ainda não encerradas no sistema/);
  assert.match(html, /Em apuração/);
  assert.match(closingSubject(report), /apuração aberta/);
  assert.match(renderClosingText(report), /metas ainda não encerradas/);
});

test('o e-mail traz consolidado, cada unidade, faixas e fica abaixo do corte do Gmail', () => {
  const report = buildClosingReport(input());
  const html = renderClosingHtml(report);
  assert.match(closingSubject(report), /^Placar Coala — Fechamento de outubro\/2026: R\$ 46,0 mil/);
  assert.match(html, /Fechamento do mês/);
  assert.match(html, /Resultado da rede/);
  assert.match(html, /Unidade A/);
  assert.match(html, /Unidade B/);
  assert.match(html, /Meta UP R\$ 34\.000/);
  assert.match(html, /61\/62 dias/);
  assert.match(html, /Shake Morango 500 ml/);
  assert.ok(Buffer.byteLength(html) < 95_000);
  assert.match(renderClosingText(report), /RESULTADO DA REDE/);
});

test('nome vindo do cadastro é escapado no HTML', () => {
  const report = buildClosingReport(input({ units: [{ id: 'a', name: 'Unidade <A>' }] }));
  const html = renderClosingHtml(report);
  assert.match(html, /Unidade &lt;A&gt;/);
  assert.doesNotMatch(html, /Unidade <A>/);
});
