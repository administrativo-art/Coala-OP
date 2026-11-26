import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canMarkReviewed, dailyNoticeBody, DP_REVIEW_REASONS, monthlyNoticeBody, previousMonth, reminderWeek, resolutionOf, seriousIncidents,
  triggersFor, weeklyNoticeBody,
} from '../../src/features/dp/time-review/core';

describe('Revisão antecipada do ponto', () => {
  it('só ocorrências graves abrem pedido; leves ficam só na lista', () => {
    assert.deepEqual(seriousIncidents({ incidents: ['late_exit', 'odd', 'long_break', 'coverage_early_exit'] }), ['odd', 'coverage_early_exit']);
    assert.deepEqual(seriousIncidents({ incidents: ['late_exit', 'late_start', 'early_exit', 'other_unit'] }), []);
  });

  it('gatilhos da rotina das 08:00: todo dia; sábado soma a semana; dia 1º soma o mês', () => {
    assert.deepEqual(triggersFor('2026-11-26'), { daily: true, weekly: false, monthly: false });
    assert.deepEqual(triggersFor('2026-11-28'), { daily: true, weekly: true, monthly: false });
    assert.deepEqual(triggersFor('2026-12-01'), { daily: true, weekly: false, monthly: true });
    assert.deepEqual(reminderWeek('2026-11-28'), { start: '2026-11-23', end: '2026-11-27' });
    assert.equal(previousMonth('2026-12-01'), '2026-11');
    assert.equal(previousMonth('2027-01-01'), '2026-12');
  });

  it('resolve com ajuste em análise ou aprovado, com ausência, ou (só da rotina) quando o erro sumiu', () => {
    const clean = { incidents: [], absence: null };
    assert.equal(resolutionOf({ origin: 'system' }, clean, []), 'incident_cleared');
    assert.equal(resolutionOf({ origin: 'dp' }, clean, []), null, 'pedido do DP espera a colaboradora');
    assert.equal(resolutionOf({ origin: 'dp' }, clean, ['rejected', 'in_review']), 'adjustment');
    assert.equal(resolutionOf({ origin: 'system' }, { incidents: ['odd'], absence: { id: 'a', typeName: 'Atestado', status: 'approved', startDate: '', endDate: '' } }, []), 'absence');
    assert.equal(resolutionOf({ origin: 'system' }, { incidents: ['odd'], absence: null }, ['rejected']), null);
  });

  it('"Revisei este dia" não vale para dia ímpar ou sem batidas', () => {
    assert.equal(canMarkReviewed({ incidents: ['odd'] }), false);
    assert.equal(canMarkReviewed({ incidents: ['missing'] }), false);
    assert.equal(canMarkReviewed({ incidents: ['short_break'] }), true);
  });

  it('textos: informativos; dia sem batidas cita o prazo da falta automática, inclusive vencido', () => {
    assert.equal(dailyNoticeBody([{ date: '2026-11-24', incidents: ['missing'], automaticAbsence: { dueAt: '2026-11-26T00:00:00.000Z', expired: false } }]),
      'Não há batidas em 24/11. Se houve motivo, a ausência ou o ajuste pode ser registrado até 25/11/2026, 21:00; depois disso a falta é registrada.');
    assert.match(dailyNoticeBody([{ date: '2026-11-24', incidents: ['missing'], automaticAbsence: { dueAt: '2026-11-25T00:00:00.000Z', expired: true } }]),
      /prazo para justificar já passou/);
    assert.equal(dailyNoticeBody([{ date: '2026-11-24', incidents: ['odd'] }]),
      'Há um dia para revisar no Registro de ponto (24/11). A revisão pode ser feita em horário de trabalho.');
    assert.match(weeklyNoticeBody(2), /^Há 2 dias desta semana/);
    assert.match(monthlyNoticeBody(1, '2026-11'), /^Há 1 dia de novembro para revisar antes do fechamento/);
    for (const body of [weeklyNoticeBody(1), monthlyNoticeBody(2, '2026-11')]) assert.doesNotMatch(body, /^Revise|^Você tem/);
  });

  it('motivos do DP não trazem horário nem valor', () => {
    for (const label of Object.values(DP_REVIEW_REASONS)) assert.doesNotMatch(label, /\d/);
  });
});

describe('Prazo único da falta automática', () => {
  it('usa o maior prazo entre os turnos; flexível sem janela vale o dia inteiro; turno noturno vence no dia seguinte', async () => {
    const { automaticAbsenceDayDeadline } = await import('../../src/features/dp/time-adjustments/automatic-absence-core');
    const split = automaticAbsenceDayDeadline('2026-11-24', [
      { startTime: '07:00', endTime: '09:30', overnight: false, windowless: false },
      { startTime: '10:00', endTime: '16:30', overnight: false, windowless: false },
    ], 'America/Fortaleza');
    assert.equal(split?.dueAt, '2026-11-25T19:30:00.000Z');
    const night = automaticAbsenceDayDeadline('2026-11-24', [{ startTime: '22:00', endTime: '02:00', overnight: true, windowless: false }], 'America/Fortaleza');
    assert.equal(night?.dueAt, '2026-11-26T05:00:00.000Z');
    const flexible = automaticAbsenceDayDeadline('2026-11-24', [{ startTime: '', endTime: '', overnight: false, windowless: true }], 'America/Fortaleza');
    assert.equal(flexible?.dueAt, '2026-11-26T02:59:00.000Z');
    assert.equal(automaticAbsenceDayDeadline('2026-11-24', [], 'America/Fortaleza'), null);
  });
});
