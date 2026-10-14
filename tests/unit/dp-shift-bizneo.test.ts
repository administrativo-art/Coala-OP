import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBizneoShiftIdentity, resolveBizneoShiftId } from '../../src/lib/dp-shift-bizneo';

test('prioriza o ID Bizneo explícito', () => {
  assert.deepEqual(
    resolveBizneoShiftIdentity({ bizneoTemplateId: '#29447060', code: '9337059' }),
    { id: '29447060', source: 'template_id' },
  );
});

test('usa o código numérico legado quando o campo dedicado estiver vazio', () => {
  assert.deepEqual(
    resolveBizneoShiftIdentity({ code: '9337059' }),
    { id: '9337059', source: 'numeric_code' },
  );
  assert.equal(resolveBizneoShiftId({ code: '#9337059' }), '9337059');
});

test('não trata código textual como ID Bizneo', () => {
  assert.deepEqual(
    resolveBizneoShiftIdentity({ code: 'TARDE-TR' }),
    { id: '', source: 'missing' },
  );
});
