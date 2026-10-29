import assert from 'node:assert/strict';
import test from 'node:test';
import { pdvAccessUnitLabel } from '../../src/features/hr/lib/pdv-access-presentation';
import type { UserPdvAccess } from '../../src/types';

const access: UserPdvAccess = { externalUserId: 'operator', unitId: 'automovel', filialId: '', profileId: '', status: 'active' };
const units = [{ id: 'automovel', name: 'Quiosque Shopping do Automóvel', pdvFilialId: '39033' }];

test('resolve acesso legado pelo vínculo explícito mesmo sem nome ou código da filial no acesso', () => {
  assert.equal(pdvAccessUnitLabel(access, units), 'Quiosque Shopping do Automóvel');
  assert.equal(pdvAccessUnitLabel({ ...access, unitId: null, filialId: '39033' }, units), 'Quiosque Shopping do Automóvel');
});

test('não atribui uma unidade sem vínculo e preserva o nome externo quando disponível', () => {
  assert.equal(pdvAccessUnitLabel({ ...access, unitId: 'outro' }, units), 'Unidade do PDV não sincronizada');
  assert.equal(pdvAccessUnitLabel({ ...access, unitId: null, filialName: 'Filial externa' }, []), 'Filial externa');
});
