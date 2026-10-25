import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { breakStatus } from '../../src/features/dp/rep-p/break-status';
import type { DayShift } from '../../src/features/dp/rep-p/day-model';

const base: DayShift = { type: 'work', startTime: '10:00', endTime: '16:15', shiftName: 'Manhã', unitName: null, breakType: 'staggered',
  breakStart: null, breakEnd: null, breakDurationMinutes: 15, breakWindowStart: '12:00', breakWindowEnd: '14:00', expectedPunches: 4 };
const at = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const purposes = ['journey_start', 'break_start', 'break_end', 'journey_end'] as const;
const marks = (...times: string[]) => times.map((time, index) => ({ markedAt: `2026-10-19T${time}:00-0300`,
  classification: { purpose: purposes[index], source: 'declared', status: 'confirmed' } }));

describe('Aviso de intervalo na faixa de registro', () => {
  it('janela livre: abre em breve, limite para iniciar = fim da janela − duração, janela fechada', () => {
    assert.equal(breakStatus(base, marks('09:57'), at('11:50'))?.headline, 'Janela 12:00–14:00 abre em 10 min');
    const near = breakStatus(base, marks('09:57'), at('13:38'));
    assert.equal(near?.level, 'warn');
    assert.equal(near?.headline, 'Faça 15 min de intervalo · inicie até 13:45');
    assert.equal(breakStatus(base, marks('09:57'), at('14:10'))?.headline, 'A janela fechou sem o intervalo completo');
  });

  it('livre: limite é o fim do turno menos o que falta; em pausa mostra a volta', () => {
    const free = { ...base, breakType: 'flexible' as const, breakWindowStart: null, breakWindowEnd: null };
    assert.equal(breakStatus(free, marks('09:57'), at('15:55'))?.headline, 'Faça 15 min de intervalo · inicie até 16:00');
    assert.equal(breakStatus(free, marks('09:57', '13:00'), at('13:10'))?.headline, 'Em intervalo · volte às 13:15 (faltam 5 min)');
    assert.equal(breakStatus(free, marks('09:57', '13:00', '13:15'), at('14:00'))?.level, 'ok');
  });

  it('fixo intercalado: cada pausa tem início e fim; pausa perdida vira problema', () => {
    const fixed = { ...base, breakType: 'fixed' as const, breakWindowStart: null, breakWindowEnd: null,
      breakSegments: [{ start: '11:30', end: '11:37' }, { start: '14:30', end: '14:38' }] };
    assert.equal(breakStatus(fixed, marks('09:57', '11:30', '11:37'), at('14:20'))?.headline, '2ª pausa 14:30–14:38 · começa em 10 min');
    assert.equal(breakStatus(fixed, marks('09:57'), at('11:40'))?.level, 'danger');
  });

  it('intercalado livre: progresso e tolerância da jornada', () => {
    const split = { ...base, breakType: 'flexible' as const, breakWindowStart: null, breakWindowEnd: null, breakSplit: 'multiple' as const,
      toleranceMinutes: 5 };
    assert.match(breakStatus(split, marks('09:57', '12:00', '12:05'), at('13:00'))?.detail ?? '', /Usados 5 de 15 min · 1 pausa/);
    assert.equal(breakStatus(split, marks('09:57', '12:00', '12:30'), at('13:00'))?.level, 'danger');
  });

  it('sem intervalo, sem turno ou folga: nada a mostrar', () => {
    assert.equal(breakStatus({ ...base, breakType: 'none' }, [], at('10:00')), null);
    assert.equal(breakStatus(null, [], at('10:00')), null);
    assert.equal(breakStatus({ ...base, type: 'day_off' }, [], at('10:00')), null);
  });

  it('não presume intervalo pela paridade quando falta classificação', () => {
    const status = breakStatus(base, [{ markedAt: '2026-10-19T09:57:00-0300' }], at('13:00'));
    assert.equal(status?.level, 'neutral');
    assert.match(status?.headline ?? '', /Classifique/);
  });

  it('jornada pode terminar sem bloqueio e segue para conferência quando o intervalo ficou incompleto', () => {
    const status = breakStatus(base, [
      { markedAt: '2026-10-19T09:57:00-0300', classification: { purpose: 'journey_start', source: 'declared', status: 'confirmed' } },
      { markedAt: '2026-10-19T16:00:00-0300', classification: { purpose: 'journey_end', source: 'declared', status: 'confirmed' } },
    ], at('16:00'));
    assert.equal(status?.level, 'danger');
    assert.match(status?.headline ?? '', /sem o intervalo completo/);
  });

  it('usa os horários do intervalo fixo quando a duração explícita está ausente', () => {
    const fixed = { ...base, breakType: 'fixed' as const, breakDurationMinutes: null,
      breakWindowStart: null, breakWindowEnd: null, breakStart: '12:00', breakEnd: '12:20' };
    const status = breakStatus(fixed, [
      { markedAt: '2026-10-19T09:57:00-0300', classification: { purpose: 'journey_start' as const, source: 'declared', status: 'confirmed' } },
      { markedAt: '2026-10-19T16:00:00-0300', classification: { purpose: 'journey_end' as const, source: 'declared', status: 'confirmed' } },
    ], at('16:00'));
    assert.equal(status?.totalMinutes, 20);
    assert.equal(status?.level, 'danger');
  });
});
