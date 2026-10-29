import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { discardedReceiptIds, pilotTreatmentsOf, type PilotTreatmentSource } from '../../src/features/dp/time-adjustments/pilot-treatments';

const unit = 'unit-1';
const correct = (id: string, status: string, receiptId = 'r1', markedAt = '2026-10-26T18:30:00-0300'): PilotTreatmentSource => ({
  id, workDate: '2026-10-26', status, kind: 'correct', target: { receiptId }, inclusion: { markedAt, executionUnitId: unit },
});

describe('Ajuste do ensaio: tratamento derivado', () => {
  it('pedido aprovado desconsidera a original e inclui o novo horário, com a forma do tratamento oficial', () => {
    assert.deepEqual(pilotTreatmentsOf([correct('a1', 'approved')]), [
      { pilot: true, id: 'a1_discard', adjustmentId: 'a1', workDate: '2026-10-26', type: 'discard', originalReceiptId: 'r1', markedAt: null, executionUnitId: null },
      { pilot: true, id: 'a1_inclusion', adjustmentId: 'a1', workDate: '2026-10-26', type: 'inclusion', originalReceiptId: null, markedAt: '2026-10-26T18:30:00-0300', executionUnitId: unit },
    ]);
  });

  it('só o aprovado altera o dia: em análise, recusado e cancelado não geram nada', () => {
    for (const status of ['in_review', 'rejected', 'cancelled']) assert.deepEqual(pilotTreatmentsOf([correct('a1', status)]), []);
  });

  it('incluir não desconsidera nada e desconsiderar não inclui nada', () => {
    const include: PilotTreatmentSource = { id: 'i', workDate: '2026-10-26', status: 'approved', kind: 'include', target: null, inclusion: { markedAt: '2026-10-26T12:00:00-0300', executionUnitId: unit } };
    const discard: PilotTreatmentSource = { id: 'd', workDate: '2026-10-26', status: 'approved', kind: 'discard', target: { receiptId: 'r2' }, inclusion: null };
    assert.deepEqual(pilotTreatmentsOf([include]).map((item) => item.type), ['inclusion']);
    assert.deepEqual(pilotTreatmentsOf([discard]).map((item) => item.type), ['discard']);
  });

  it('pedido com várias operações numera os tratamentos', () => {
    const many: PilotTreatmentSource = { ...correct('m', 'approved'), operations: [
      { kind: 'discard', target: { receiptId: 'r1' }, inclusion: null },
      { kind: 'correct', target: { receiptId: 'r2' }, inclusion: { markedAt: '2026-10-26T19:00:00-0300', executionUnitId: unit } },
    ] };
    assert.deepEqual(pilotTreatmentsOf([many]).map((item) => item.id), ['m_1_discard', 'm_2_discard', 'm_2_inclusion']);
  });

  it('a batida já desconsiderada por outro aprovado é conhecida para recusar a segunda aprovação', () => {
    assert.deepEqual([...discardedReceiptIds(pilotTreatmentsOf([correct('a1', 'approved', 'r1'), correct('a2', 'approved', 'r2')]))].sort(), ['r1', 'r2']);
    assert.equal(discardedReceiptIds(pilotTreatmentsOf([correct('a1', 'in_review', 'r1')])).size, 0);
  });

  it('o tratamento do ensaio é marcado e não chega ao AEJ nem ao fechamento oficial', () => {
    assert.ok(pilotTreatmentsOf([correct('a1', 'approved')]).every((item) => item.pilot === true));
    for (const file of ['aej.server.ts', 'closure.server.ts', 'mirror.server.ts', 'closing-package.server.ts']) {
      let source = '';
      try { source = readFileSync(`src/features/dp/time-adjustments/${file}`, 'utf8'); } catch { continue; }
      assert.ok(!source.includes('pilot-treatments') && !source.includes('PILOT_ADJUSTMENTS'), `${file} não pode ler o tratamento do ensaio`);
    }
  });
});
