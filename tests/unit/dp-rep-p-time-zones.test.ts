import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isBrazilTimeZone, repPDateInZone, repPInstantMs, repPMarkingTimeZone } from '../../src/features/dp/rep-p/time-zones';

describe('Fuso da batida por unidade', () => {
  it('usa o fuso da unidade quando válido e volta ao do estabelecimento sem cadastro', () => {
    assert.equal(repPMarkingTimeZone('America/Manaus', 'America/Fortaleza'), 'America/Manaus');
    assert.equal(repPMarkingTimeZone(null, 'America/Fortaleza'), 'America/Fortaleza');
    assert.equal(repPMarkingTimeZone('Europe/Lisbon', 'America/Fortaleza'), 'America/Fortaleza');
    assert.equal(isBrazilTimeZone('America/Rio_Branco'), true);
  });

  it('data da batida na fronteira da meia-noite segue o fuso da unidade', () => {
    const instant = new Date('2026-10-19T03:50:00.000Z');
    assert.equal(repPDateInZone('America/Manaus', instant), '2026-10-18');
    assert.equal(repPDateInZone('America/Fortaleza', instant), '2026-10-19');
  });

  it('ordena timestamps fiscais de fusos diferentes pelo instante', () => {
    assert.ok(repPInstantMs('2026-10-18T23:20:00-0400') > repPInstantMs('2026-10-19T00:10:00-0300'));
  });
});
