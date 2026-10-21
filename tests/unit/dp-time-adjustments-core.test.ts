import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { adjustmentActHash, aejReason, applyTreatments, zonedFiscalTimestamp } from '../../src/features/dp/time-adjustments/core';

describe('Ajuste de ponto: núcleo', () => {
  it('monta o horário fiscal no fuso da unidade', () => {
    assert.equal(zonedFiscalTimestamp('2026-10-19', '16:20', 'America/Fortaleza'), '2026-10-19T16:20:00-0300');
    assert.equal(zonedFiscalTimestamp('2026-10-19', '16:20', 'America/Manaus'), '2026-10-19T16:20:00-0400');
  });

  it('motivo do AEJ: até 150 caracteres, sem o delimitador do leiaute', () => {
    const reason = aejReason(`Saí às 16:20 | celular descarregou ${'x'.repeat(200)}`);
    assert.equal(reason.length, 150);
    assert.ok(!reason.includes('|'));
  });

  it('código de cada ato depende do anterior', () => {
    const act = { action: 'requested' as const, actorUid: 'u', role: 'titular' as const, at: '2026-10-19T19:00:00.000Z', clockSource: 'server' as const };
    const first = adjustmentActHash(null, act, 'p');
    assert.notEqual(adjustmentActHash(first, act, 'p'), first);
  });

  it('desconsiderada continua listada e sai da conta; incluída entra identificada', () => {
    const originals = [{ receiptId: 'a', markedAt: '2026-10-19T10:00:00-0300' }, { receiptId: 'b', markedAt: '2026-10-19T13:14:00-0300' }];
    const result = applyTreatments(originals, [
      { type: 'discard', originalReceiptId: 'b', adjustmentId: 'aj1' },
      { type: 'inclusion', markedAt: '2026-10-19T13:30:00-0300', adjustmentId: 'aj1' },
    ], (item) => ({ receiptId: `inc-${item.adjustmentId}`, markedAt: item.markedAt }));
    assert.deepEqual(result.map((item) => [item.receiptId, item.treatment]), [['a', 'original'], ['b', 'discarded'], ['inc-aj1', 'included']]);
  });
});
