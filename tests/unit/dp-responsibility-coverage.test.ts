import assert from 'node:assert/strict';
import test from 'node:test';

import { responsibilityCoverageStatus } from '../../src/features/dp/responsibility-coverage/model';

test('cobertura só fica ativa quando existe pessoa apta', () => {
  assert.equal(responsibilityCoverageStatus({ configured: false, active: false, eligibleCount: 0,
    invalidConfiguredLevelCount: 0 }), 'draft');
  assert.equal(responsibilityCoverageStatus({ configured: true, active: true, eligibleCount: 0,
    invalidConfiguredLevelCount: 2 }), 'uncovered');
  assert.equal(responsibilityCoverageStatus({ configured: true, active: true, eligibleCount: 2,
    invalidConfiguredLevelCount: 0 }), 'covered');
});

test('painel sinaliza níveis anteriores inválidos sem esconder a cobertura efetiva', () => {
  assert.equal(responsibilityCoverageStatus({ configured: true, active: true, eligibleCount: 1,
    invalidConfiguredLevelCount: 1 }), 'warning');
});
