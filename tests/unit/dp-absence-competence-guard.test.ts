import assert from 'node:assert/strict';
import test from 'node:test';

import { absenceCompetences } from '../../src/features/dp/absences/requests/core';

test('ausência confere toda competência civil tocada pelo período', () => {
  assert.deepEqual(absenceCompetences('2026-08-10', '2026-08-12'), ['2026-08']);
  assert.deepEqual(absenceCompetences('2026-08-31', '2026-10-01'), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(absenceCompetences('2026-12-31', '2027-01-01'), ['2026-12', '2027-01']);
});
