import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { repPOfficialMarkingEnabled, repPOfficialStartDate, repPOfficialStartReached,
  repPPilotWorkDateAllowed } from '../../src/features/dp/rep-p/runtime-config';

describe('configuração de rollout do REP-P', () => {
  it('mantém o modo oficial bloqueado antes de 01/11/2026', () => {
    const environment = { REP_P_MARKING_ENABLED: 'true', REP_P_OFFICIAL_START_DATE: '2026-11-01' };
    assert.equal(repPOfficialStartReached(new Date('2026-10-31T23:59:59-03:00'), environment), false);
    assert.equal(repPOfficialMarkingEnabled(new Date('2026-10-31T23:59:59-03:00'), environment), false);
    assert.equal(repPOfficialStartReached(new Date('2026-11-01T00:00:00-03:00'), environment), true);
    assert.equal(repPOfficialMarkingEnabled(new Date('2026-11-01T00:00:00-03:00'), environment), true);
  });

  it('falha fechado para uma data inválida e usa a data operacional padrão', () => {
    const environment = { REP_P_OFFICIAL_MARKING_ENABLED: 'true', REP_P_OFFICIAL_START_DATE: 'data-invalida' };
    assert.equal(repPOfficialStartDate(environment), '2026-10-31');
    assert.equal(repPOfficialMarkingEnabled(new Date('2026-10-31T12:00:00-03:00'), environment), false);
  });

  it('separa os dias do ensaio e do oficial por uma fronteira civil sem sobreposição', () => {
    assert.equal(repPPilotWorkDateAllowed('2026-10-31', '2026-11-01'), true);
    assert.equal(repPPilotWorkDateAllowed('2026-11-01', '2026-11-01'), false);
    assert.equal(repPPilotWorkDateAllowed('2026-11-02', '2026-11-01'), false);
  });
});
