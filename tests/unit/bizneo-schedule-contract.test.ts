import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPublishedBizneoSchedulePayload,
  pushBizneoScheduleSchema,
} from '../../src/lib/integrations/bizneo-schedule-contract';

const morningShift = {
  bizneoUserId: 17044767,
  date: '2026-09-02',
  userName: 'Carliane Sousa Ramos',
  name: 'CS - 02 TR | Manhã',
  taxonId: 16098415,
  timeRanges: [
    { start_at: '10:00', end_at: '12:00' },
    { start_at: '12:15', end_at: '16:15' },
  ],
};

test('monta a escrita do Bizneo sempre como publicada', () => {
  const payload = buildPublishedBizneoSchedulePayload(morningShift);

  assert.equal(payload.one_time_schedule.state, 'published');
  assert.equal(payload.one_time_schedule.date, '2026-09-02');
  assert.equal(payload.one_time_schedule.taxon_id, 16098415);
  assert.deepEqual(payload.one_time_schedule.time_ranges, morningShift.timeRanges);
  assert.equal(JSON.stringify(payload).includes('draft'), false);
});

test('valida o lote em dry-run sem alterar os alvos', () => {
  const parsed = pushBizneoScheduleSchema.parse({ dryRun: true, shifts: [morningShift] });

  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.shifts.length, 1);
  assert.equal(parsed.shifts[0]?.bizneoUserId, 17044767);
});

test('rejeita mais de um turno para o mesmo colaborador e data', () => {
  const parsed = pushBizneoScheduleSchema.safeParse({
    shifts: [morningShift, { ...morningShift, name: 'Outro turno' }],
  });

  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.match(parsed.error.issues.map((issue) => issue.message).join(' '), /mesmo colaborador e data/i);
  }
});

test('rejeita datas inexistentes e intervalos sobrepostos', () => {
  const invalidDate = pushBizneoScheduleSchema.safeParse({
    shifts: [{ ...morningShift, date: '2026-02-30' }],
  });
  const overlappingRanges = pushBizneoScheduleSchema.safeParse({
    shifts: [{
      ...morningShift,
      timeRanges: [
        { start_at: '10:00', end_at: '12:30' },
        { start_at: '12:15', end_at: '16:15' },
      ],
    }],
  });

  assert.equal(invalidDate.success, false);
  assert.equal(overlappingRanges.success, false);
});
