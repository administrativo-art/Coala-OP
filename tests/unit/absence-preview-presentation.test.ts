import assert from 'node:assert/strict';
import test from 'node:test';

import { formatAbsenceQuantity } from '../../src/features/dp/absences/requests/preview-panel';
import type { AbsenceRequestPreview } from '../../src/features/dp/absences/requests/types';

const base = { quantity: { value: 3, unit: 'day', calculation: 'calendar_days' } } as AbsenceRequestPreview;

test('quantidade da prévia usa unidade e separador brasileiros ou informa dependência da escala', () => {
  assert.equal(formatAbsenceQuantity(base), '3 dias');
  assert.equal(formatAbsenceQuantity({ ...base, quantity: { value: 1.5, unit: 'hour', calculation: 'calendar_days' } }), '1,5 horas');
  assert.equal(formatAbsenceQuantity({ ...base, quantity: { value: null, unit: 'day', calculation: 'scheduled_workdays' } }), 'Depende da escala');
});
